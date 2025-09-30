const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { prepareTranslationDocument, assembleHtmlDocument } = require('./helpers/documentParser');
const { persistAssetsAndAnchors } = require('./helpers/assetStore');
const { getTranslationEngine } = require('./helpers/translationEngine');
const { ensureChunkSource, listChunks, updateChunkState, summariseChunks, deleteAllChunks } = require('./helpers/translationStore');
const { sendJobNotification } = require('./helpers/notifications');
const { appendJobLog } = require('./helpers/jobLogs');

const s3 = new S3Client({});
const ddb = new DynamoDBClient({});

const RAW_BUCKET = process.env.RAW_BUCKET;
const DOCS_TABLE = process.env.DOCS_TABLE;

function now() {
  return new Date().toISOString();
}

async function readObject(bucket, key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buffer = Buffer.from(await res.Body.transformToByteArray());
  const contentType = res.ContentType || undefined;
  return { buffer, contentType };
}

async function putObject(bucket, key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

async function failTranslation({ translationId, ownerId, errorMessage, context, fileName, attempt }) {
  console.error('translationWorker failure', { translationId, ownerId, errorMessage, context });
  try {
    await updateTranslationItem(translationId, ownerId, {
      status: 'FAILED',
      errorMessage: errorMessage?.slice(0, 2000) || 'Translation failed',
      errorContext: context ? JSON.stringify(context).slice(0, 4000) : undefined
    });
    await sendJobNotification({
      jobType: 'translation',
      status: 'failed',
      fileName,
      jobId: translationId,
      ownerId
    });
    await recordLog({
      translationId,
      ownerId,
      category: 'processing',
      stage: 'failure',
      eventType: 'failed',
      status: 'FAILED',
      message: errorMessage || 'Translation failed',
      metadata: context ? { context } : undefined,
      failureReason: errorMessage || 'Translation failed',
      attempt
    });
  } catch (inner) {
    console.error('translationWorker failed to persist error state', inner);
  }
}

async function getTranslationItem(translationId, ownerId = 'default') {
  const key = { PK: `TRANSLATION#${translationId}`, SK: `TRANSLATION#${ownerId}` };
  const res = await ddb.send(new GetItemCommand({ TableName: DOCS_TABLE, Key: marshall(key) }));
  if (!res.Item) {
    throw new Error(`Translation ${translationId} not found`);
  }
  return unmarshall(res.Item);
}

async function updateTranslationItem(translationId, ownerId = 'default', patch) {
  const names = { '#u': 'updatedAt' };
  const values = { ':u': now() };
  const sets = ['#u = :u'];
  for (const [key, value] of Object.entries(patch || {})) {
    names[`#${key}`] = key;
    values[`:${key}`] = value;
    sets.push(`#${key} = :${key}`);
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'status')) {
    names['#SK1'] = 'SK1';
    values[':sk1'] = `STATUS#${patch.status}`;
    sets.push('#SK1 = :sk1');
  }
  await ddb.send(new UpdateItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall({ PK: `TRANSLATION#${translationId}`, SK: `TRANSLATION#${ownerId}` }),
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(values)
  }));
}

async function recordLog(entry) {
  try {
    await appendJobLog({
      jobType: 'translation',
      jobId: entry.translationId,
      ownerId: entry.ownerId,
      category: entry.category,
      stage: entry.stage,
      eventType: entry.eventType,
      status: entry.status,
      statusCode: entry.statusCode,
      message: entry.message,
      actor: entry.actor || { type: 'system', source: 'translation-worker', role: 'system' },
      metadata: entry.metadata,
      context: entry.context,
      attempt: entry.attempt,
      retryCount: entry.retryCount,
      failureReason: entry.failureReason,
      chunkProgress: entry.chunkProgress
    });
  } catch (err) {
    console.warn('translationWorker log append failed', err?.message || err);
  }
}

async function deleteObject(key) {
  if (!RAW_BUCKET || !key) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: RAW_BUCKET, Key: key }));
  } catch (err) {
    console.warn('translationWorker failed to delete object', { key, error: err?.message || err });
  }
}

async function captureChunkSnapshot(translationId, ownerId, existingChunks) {
  if (existingChunks && existingChunks.length) {
    return {
      chunks: existingChunks,
      summary: summariseChunks(existingChunks)
    };
  }
  const chunks = await listChunks(translationId, ownerId);
  return {
    chunks,
    summary: summariseChunks(chunks)
  };
}

async function finalisePause({ translationId, ownerId, item, summary }) {
  const pausedAt = now();
  const progress = summary ? {
    completed: summary.completed,
    failed: summary.failed,
    total: summary.total
  } : null;
  await updateTranslationItem(translationId, ownerId, {
    status: 'PAUSED',
    pausedAt,
    pausedBy: item.pauseRequestedBy || null,
    pausedByEmail: item.pauseRequestedByEmail || null,
    pausedBySub: item.pauseRequestedBySub || null,
    pauseRequestedAt: item.pauseRequestedAt || pausedAt,
    processedChunks: summary ? summary.completed : item.processedChunks || 0,
    failedChunks: summary ? summary.failed : item.failedChunks || 0,
    healthCheckRetries: 0,
    healthCheckReason: null
  });
  await recordLog({
    translationId,
    ownerId,
    category: 'processing-control',
    stage: 'pause',
    eventType: 'paused',
    status: 'PAUSED',
    message: 'Translation paused by administrator request',
    metadata: {
      requestedBy: item.pauseRequestedBy || null
    },
    chunkProgress: progress
  });
  await sendJobNotification({
    jobType: 'translation',
    status: 'paused',
    fileName: item.originalFilename || item.title || translationId,
    jobId: translationId,
    ownerId
  });
}

async function cleanupCancelledTranslation({ translationId, ownerId, item, summary }) {
  const cancelledAt = now();
  const progress = summary ? {
    completed: summary.completed,
    failed: summary.failed,
    total: summary.total
  } : null;
  const keysToDelete = Array.from(new Set([
    item.chunkFileKey,
    item.machineFileKey,
    item.translatedFileKey,
    item.translatedHtmlKey,
    `translations/chunks/${ownerId}/${translationId}.json`,
    `translations/machine/${ownerId}/${translationId}.html`,
    `translations/output/${ownerId}/${translationId}.html`,
    `translations/output/${ownerId}/${translationId}.docx`
  ].filter(Boolean)));
  await Promise.all(keysToDelete.map(deleteObject));
  await deleteAllChunks(translationId, ownerId);
  await updateTranslationItem(translationId, ownerId, {
    status: 'CANCELLED',
    cancelledAt,
    cancelledBy: item.cancelRequestedBy || null,
    cancelledByEmail: item.cancelRequestedByEmail || null,
    cancelledBySub: item.cancelRequestedBySub || null,
    cancelReason: item.cancelReason || null,
    chunkFileKey: null,
    machineFileKey: null,
    translatedFileKey: null,
    translatedHtmlKey: null,
    processedChunks: summary ? summary.completed : item.processedChunks || 0,
    failedChunks: summary ? summary.failed : item.failedChunks || 0,
    healthCheckRetries: 0,
    healthCheckReason: null
  });
  await recordLog({
    translationId,
    ownerId,
    category: 'processing-control',
    stage: 'cancel',
    eventType: 'cancelled',
    status: 'CANCELLED',
    message: 'Translation cancelled by administrator request',
    metadata: {
      requestedBy: item.cancelRequestedBy || null,
      reason: item.cancelReason || null
    },
    chunkProgress: progress
  });
  await sendJobNotification({
    jobType: 'translation',
    status: 'cancelled',
    fileName: item.originalFilename || item.title || translationId,
    jobId: translationId,
    ownerId
  });
}

async function enforceControlSignals({ translationId, ownerId, itemSnapshot, chunkRecords }) {
  const item = itemSnapshot || await getTranslationItem(translationId, ownerId);
  if (item.status === 'CANCELLED') {
    return { action: 'cancelled', item };
  }
  if (item.status === 'CANCEL_REQUESTED') {
    const { summary } = await captureChunkSnapshot(translationId, ownerId, chunkRecords);
    await cleanupCancelledTranslation({ translationId, ownerId, item, summary });
    return { action: 'cancelled', item };
  }
  if (item.status === 'PAUSED') {
    return { action: 'paused', item };
  }
  if (item.status === 'PAUSE_REQUESTED') {
    const { summary } = await captureChunkSnapshot(translationId, ownerId, chunkRecords);
    await finalisePause({ translationId, ownerId, item, summary });
    return { action: 'paused', item };
  }
  return { action: 'continue', item };
}

exports.handler = async (event) => {
  const detail = event?.detail || {};
  const translationId = detail.translationId;
  const ownerId = detail.ownerId || 'default';
  if (!translationId) {
    console.warn('translationWorker invoked without translationId');
    return;
  }

  if (!RAW_BUCKET) {
    await failTranslation({ translationId, ownerId, errorMessage: 'RAW_BUCKET not configured' });
    return;
  }

  if (!DOCS_TABLE) {
    await failTranslation({ translationId, ownerId, errorMessage: 'DOCS_TABLE not configured' });
    return;
  }

  let item;
  try {
    console.log('translationWorker start', { translationId, ownerId, detail });
    item = await getTranslationItem(translationId, ownerId);
    let control = await enforceControlSignals({ translationId, ownerId, itemSnapshot: item });
    if (control.action !== 'continue') {
      console.log('translationWorker exiting due to control signal', { translationId, action: control.action });
      return;
    }
    item = control.item;
    const attempt = Number(item.healthCheckRetries || 0) + 1;
    const originalKey = item.originalFileKey;
    if (!originalKey) {
      await failTranslation({ translationId, ownerId, errorMessage: 'Original file key missing on translation item', context: item, fileName: item?.originalFilename, attempt });
      return;
    }

    const startedAt = item.startedAt || now();
    await updateTranslationItem(translationId, ownerId, { status: 'PROCESSING', startedAt, pausedAt: null, pausedBy: null, pausedByEmail: null, pausedBySub: null });
    await recordLog({
      translationId,
      ownerId,
      category: 'processing-kickoff',
      stage: 'start',
      eventType: 'processing-started',
      status: 'PROCESSING',
      message: 'Translation processing started',
      metadata: { startedAt },
      attempt
    });

    control = await enforceControlSignals({ translationId, ownerId });
    if (control.action !== 'continue') {
      console.log('translationWorker exiting due to control signal after kickoff', { translationId, action: control.action });
      return;
    }
    item = control.item;

    let buffer, contentType;
    try {
      ({ buffer, contentType } = await readObject(RAW_BUCKET, originalKey));
    } catch (readErr) {
      await failTranslation({ translationId, ownerId, errorMessage: 'Failed to read source document from S3', context: { originalKey, error: readErr.message }, fileName: item.originalFilename, attempt });
      return;
    }

    let document;
    try {
      document = await prepareTranslationDocument({
        buffer,
        contentType,
        filename: item.originalFilename || originalKey.split('/').pop() || 'document'
      });
    } catch (parseErr) {
      // Enhanced logging for debugging document parsing errors
      console.error('Document parsing error details:', {
        translationId,
        ownerId,
        filename: item.originalFilename,
        contentType,
        error: parseErr.message,
        stack: parseErr.stack
      });

      // Also log to DynamoDB for audit purposes with enhanced error details
      await recordLog({
        translationId,
        ownerId,
        eventType: 'parsing-error',
        status: 'FAILED',
        message: `Document parsing failed: ${parseErr.message}`,
        metadata: {
          filename: item.originalFilename,
          contentType,
          errorType: parseErr.name || 'ParseError',
          originalError: parseErr.message
        },
        context: {
          parseError: parseErr.message,
          filename: item.originalFilename || originalKey.split('/').pop() || 'document',
          stackTrace: parseErr.stack
        }
      });

      // Provide more specific error messages for common issues
      let errorMessage = 'Failed to prepare translation document';
      if (parseErr.message.includes('bad XRef') ||
          parseErr.message.includes('Invalid PDF') ||
          parseErr.message.includes('PDF parsing failed')) {
        errorMessage = 'PDF file appears to be corrupted or invalid. Please try re-uploading the file or ensure the PDF is not password-protected.';
      } else if (parseErr.message.includes('Unsupported content type')) {
        errorMessage = 'File format not supported for translation. Please upload a PDF, Word document (DOC/DOCX), HTML, RTF, ODT, or text file.';
      } else if (parseErr.message.includes('DOCX parsing error') ||
                 parseErr.message.includes('Cannot read properties of null')) {
        errorMessage = 'Word document parsing error. The file may be corrupted or contain unsupported elements. Please try re-uploading or converting to a different format.';
      }

      await failTranslation({
        translationId,
        ownerId,
        errorMessage,
        context: {
          error: parseErr.message,
          filename: item.originalFilename || originalKey.split('/').pop() || 'document'
        },
        fileName: item.originalFilename,
        attempt
      });
      return;
    }

    await recordLog({
      translationId,
      ownerId,
      category: 'processing-kickoff',
      stage: 'document-parse',
      eventType: 'document-parsed',
      status: 'PROCESSING',
      message: 'Source document parsed for translation',
      metadata: {
        contentType,
        chunkEstimate: Array.isArray(document?.chunks) ? document.chunks.length : 0,
        assetCount: Array.isArray(document?.assets) ? document.assets.length : 0
      },
      attempt
    });

    let assetContext = { assets: [], anchors: [] };
    let enrichedAssets = document.assets || [];
    let resolvedAnchors = document.anchors || [];
    try {
      assetContext = await persistAssetsAndAnchors({
        s3,
        ddb,
        bucket: RAW_BUCKET,
        tableName: DOCS_TABLE,
        translationId,
        ownerId,
        assets: document.assets || [],
        anchors: document.anchors || []
      });
      if (assetContext?.assets?.length) {
        const assetMap = new Map(assetContext.assets.map(asset => [asset.assetId, asset]));
        enrichedAssets = (document.assets || []).map(asset => {
          const stored = assetMap.get(asset.assetId);
          if (!stored) {return asset;}
          return { ...asset, s3Bucket: stored.s3Bucket || null, s3Key: stored.s3Key || null };
        });
      }
      if (assetContext?.anchors?.length) {
        resolvedAnchors = assetContext.anchors;
      }
    } catch (assetErr) {
      await failTranslation({
        translationId,
        ownerId,
        errorMessage: 'Failed to persist asset metadata',
        context: { error: assetErr.message },
        fileName: item.originalFilename
      });
      return;
    }

    await recordLog({
      translationId,
      ownerId,
      category: 'processing',
      stage: 'asset-preparation',
      eventType: 'assets-indexed',
      status: 'PROCESSING',
      message: 'Assets and anchors prepared for translation',
      metadata: {
        assetsStored: assetContext?.assets?.length || enrichedAssets.length || 0,
        anchorsStored: assetContext?.anchors?.length || resolvedAnchors.length || 0
      },
      attempt
    });

    let engine;
    try {
      engine = await getTranslationEngine();
    } catch (engineErr) {
      await failTranslation({ translationId, ownerId, errorMessage: 'Failed to initialise translation engine', context: { error: engineErr.message }, fileName: item.originalFilename, attempt });
      return;
    }

    const existingChunks = await listChunks(translationId, ownerId);
    const byId = new Map();
    for (const stored of existingChunks) {
      if (stored?.chunkId) {
        byId.set(stored.chunkId, stored);
      }
    }

    const pending = [];
    for (const chunk of document.chunks) {
      const stored = await ensureChunkSource({ translationId, ownerId, chunk });
      const record = stored || byId.get(chunk.id) || null;
      if (record?.chunkId) {
        byId.set(record.chunkId, record);
        if (record.status !== 'COMPLETED') {
          pending.push({ chunk, record });
        }
      }
    }

    const chunkSummary = summariseChunks(Array.from(byId.values()));
    await updateTranslationItem(translationId, ownerId, {
      totalChunks: document.chunks.length,
      processedChunks: chunkSummary.completed,
      failedChunks: chunkSummary.failed,
      headHtml: document.headHtml,
      assetCount: enrichedAssets.length
    });

    await recordLog({
      translationId,
      ownerId,
      category: 'chunk-processing',
      stage: 'queue',
      eventType: 'chunks-queued',
      status: 'PROCESSING',
      message: `${pending.length} chunk(s) queued for machine translation`,
      metadata: {
        totalChunks: document.chunks.length,
        pendingChunks: pending.length,
        completedChunks: chunkSummary.completed
      },
      chunkProgress: {
        completed: chunkSummary.completed,
        failed: chunkSummary.failed,
        total: document.chunks.length
      },
      attempt
    });

    control = await enforceControlSignals({ translationId, ownerId, chunkRecords: Array.from(byId.values()) });
    if (control.action !== 'continue') {
      console.log('translationWorker exiting due to control signal before machine translation', { translationId, action: control.action });
      return;
    }
    item = control.item;

    let translations = [];
    if (pending.length) {
      try {
        const pendingChunks = pending.map(p => p.chunk);
        await Promise.all(pending.map(({ record }) => updateChunkState({
          translationId,
          ownerId,
          chunkOrder: record.order,
          patch: { status: 'PROCESSING', startedAt: now() }
        })));
        translations = await engine.translate(pendingChunks, {
          sourceLanguage: item.sourceLanguage || 'auto',
          targetLanguage: item.targetLanguage || 'en'
        });
      } catch (translateErr) {
        await Promise.all(pending.map(({ record }) => updateChunkState({
          translationId,
          ownerId,
          chunkOrder: record.order,
          patch: { status: 'FAILED', errorMessage: translateErr.message }
        })));
        await failTranslation({ translationId, ownerId, errorMessage: 'Translation provider error', context: { error: translateErr.message }, fileName: item.originalFilename, attempt });
        return;
      }

      for (const translation of translations) {
        const controlState = await enforceControlSignals({ translationId, ownerId, chunkRecords: Array.from(byId.values()) });
        if (controlState.action !== 'continue') {
          console.log('translationWorker exiting due to control signal during chunk updates', { translationId, action: controlState.action });
          return;
        }
        item = controlState.item;
        const record = byId.get(translation.id) || pending.find(p => p.chunk.id === translation.id)?.record;
        if (!record) {continue;}
        const updated = await updateChunkState({
          translationId,
          ownerId,
          chunkOrder: record.order,
          patch: {
            status: 'COMPLETED',
            machineHtml: translation.translatedHtml || record.sourceHtml,
            provider: translation.provider || engine.name,
            model: translation.model || engine.model,
            lastUpdatedBy: 'machine',
            lastUpdatedAt: now(),
            completedAt: now(),
            errorMessage: null
          }
        });
        if (updated?.chunkId) {
          byId.set(updated.chunkId, updated);
        }
      }

      const machineSummary = summariseChunks(Array.from(byId.values()));
      await recordLog({
        translationId,
        ownerId,
        category: 'chunk-processing',
        stage: 'machine-translation',
        eventType: 'chunks-processed',
        status: 'PROCESSING',
        message: `${translations.length} chunk(s) machine-translated`,
        metadata: {
          provider: engine.name,
          model: engine.model,
          translatedChunks: translations.length
        },
        chunkProgress: {
          completed: machineSummary.completed,
          failed: machineSummary.failed,
          total: machineSummary.total
        },
        attempt
      });
    }

    const finalChunks = Array.from(byId.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
    const finalSummary = summariseChunks(finalChunks);

    control = await enforceControlSignals({ translationId, ownerId, chunkRecords: finalChunks });
    if (control.action !== 'continue') {
      console.log('translationWorker exiting due to control signal before finalisation', { translationId, action: control.action });
      return;
    }
    item = control.item;

    if (finalSummary.total === 0 || finalSummary.completed !== finalSummary.total) {
      await updateTranslationItem(translationId, ownerId, {
        processedChunks: finalSummary.completed,
        failedChunks: finalSummary.failed
      });
      console.warn('translationWorker incomplete progress', {
        translationId,
        ownerId,
        summary: finalSummary
      });
      return;
    }

    const normalizedChunks = finalChunks.map(chunk => ({
      id: chunk.chunkId,
      order: chunk.order,
      blockId: chunk.blockId || chunk.chunkId,
      assetAnchors: chunk.assetAnchors || [],
      sourceHtml: chunk.sourceHtml,
      sourceText: chunk.sourceText,
      machineHtml: chunk.machineHtml,
      reviewerHtml: chunk.reviewerHtml || null,
      provider: chunk.provider || engine.name,
      model: chunk.model || engine.model,
      lastUpdatedBy: chunk.lastUpdatedBy || 'machine',
      lastUpdatedAt: chunk.lastUpdatedAt || chunk.updatedAt || now(),
      reviewerName: chunk.reviewerName || null
    }));

    const serializedAssets = assetContext.assets && assetContext.assets.length
      ? assetContext.assets
      : enrichedAssets.map(asset => ({
        assetId: asset.assetId,
        mime: asset.mime,
        bytes: asset.bytes ?? (asset.buffer ? asset.buffer.length : 0),
        widthPx: asset.widthPx || null,
        heightPx: asset.heightPx || null,
        keepOriginalLanguage: Boolean(asset.keepOriginalLanguage),
        altText: asset.altText || '',
        caption: asset.caption || null,
        s3Bucket: asset.s3Bucket || null,
        s3Key: asset.s3Key || null,
        originalName: asset.originalName || null
      }));

    const serializedAnchors = assetContext.anchors && assetContext.anchors.length
      ? assetContext.anchors
      : resolvedAnchors;

    const payload = {
      translationId,
      generatedAt: now(),
      sourceLanguage: item.sourceLanguage,
      targetLanguage: item.targetLanguage,
      provider: engine.name,
      model: engine.model,
      headHtml: document.headHtml,
      chunks: normalizedChunks,
      assets: serializedAssets,
      anchors: serializedAnchors
    };

    const chunkKey = `translations/chunks/${ownerId}/${translationId}.json`;
    try {
      await putObject(RAW_BUCKET, chunkKey, JSON.stringify(payload), 'application/json');
      console.log('translationWorker chunks stored', { translationId, chunkKey, chunkCount: payload.chunks.length });
      await recordLog({
        translationId,
        ownerId,
        category: 'reassembly',
        stage: 'chunk-persist',
        eventType: 'chunk-payload-stored',
        status: 'PROCESSING',
        message: 'Chunk payload persisted to storage',
        metadata: {
          chunkKey,
          chunkCount: payload.chunks.length
        },
        chunkProgress: {
          completed: payload.chunks.length,
          failed: 0,
          total: payload.chunks.length
        }
      });
    } catch (chunkErr) {
      await failTranslation({ translationId, ownerId, errorMessage: 'Failed to persist translation chunks', context: { chunkKey, error: chunkErr.message }, fileName: item.originalFilename, attempt });
      return;
    }

    const machineHtml = assembleHtmlDocument({
      headHtml: document.headHtml,
      chunks: normalizedChunks,
      assets: enrichedAssets,
      anchors: resolvedAnchors
    });
    const machineKey = `translations/machine/${ownerId}/${translationId}.html`;
    try {
      await putObject(RAW_BUCKET, machineKey, machineHtml, 'text/html');
      console.log('translationWorker machine HTML stored', { translationId, machineKey, length: machineHtml.length });
      await recordLog({
        translationId,
        ownerId,
        category: 'reassembly',
        stage: 'machine-output',
        eventType: 'machine-html-stored',
        status: 'PROCESSING',
        message: 'Machine translated HTML stored',
        metadata: {
          machineKey,
          htmlLength: machineHtml.length
        }
      });
    } catch (htmlErr) {
      await failTranslation({ translationId, ownerId, errorMessage: 'Failed to persist machine translated HTML', context: { machineKey, error: htmlErr.message }, fileName: item.originalFilename, attempt });
      return;
    }

    await updateTranslationItem(translationId, ownerId, {
      status: 'READY_FOR_REVIEW',
      chunkFileKey: chunkKey,
      machineFileKey: machineKey,
      totalChunks: normalizedChunks.length,
      translatedAt: now(),
      provider: engine.name,
      model: engine.model,
      processedChunks: normalizedChunks.length,
      failedChunks: 0,
      assetCount: enrichedAssets.length,
      healthCheckRetries: 0,
      healthCheckReason: null
    });
    console.log('translationWorker completed', { translationId, chunkKey, machineKey, chunkCount: normalizedChunks.length });
    await recordLog({
      translationId,
      ownerId,
      category: 'processing',
      stage: 'complete',
      eventType: 'processing-completed',
      status: 'READY_FOR_REVIEW',
      message: 'Translation processing completed',
      metadata: {
        chunkFileKey: chunkKey,
        machineFileKey: machineKey,
        chunkCount: normalizedChunks.length,
        assetCount: enrichedAssets.length,
        provider: engine.name,
        model: engine.model
      },
      chunkProgress: {
        completed: normalizedChunks.length,
        failed: 0,
        total: normalizedChunks.length
      },
      attempt
    });
    await sendJobNotification({
      jobType: 'translation',
      status: 'completed',
      fileName: item.originalFilename,
      jobId: translationId,
      ownerId
    });
  } catch (error) {
    console.error('translationWorker failed', error);
    await failTranslation({
      translationId,
      ownerId,
      errorMessage: error.message || 'Translation failed',
      context: error.details || null,
      fileName: item?.originalFilename
    });
  }
};
