const { prepareTranslationDocument, assembleHtmlDocument } = require('./documentParser');
const { persistAssetsAndAnchors } = require('./assetStore');
const { getTranslationEngine } = require('./translationEngine');
const {
  ensureChunkSource,
  listChunks,
  updateChunkState,
  summariseChunks,
  getChunk
} = require('./translationStore');

function chunkMessagePayload({ translationId, ownerId, chunk }) {
  return {
    action: 'process-chunk',
    translationId,
    ownerId,
    chunkOrder: chunk.order,
    chunkId: chunk.chunkId
  };
}

function safeJsonParse(buffer) {
  try {
    return JSON.parse(buffer.toString('utf-8'));
  } catch {
    return null;
  }
}

function createModeHandlers(deps) {
  const {
    RAW_BUCKET,
    queueUrl,
    now,
    readObject,
    putObject,
    failTranslation,
    getTranslationItem,
    updateTranslationItem,
    recordLog,
    sendQueueMessage,
    sendQueueBatch,
    sendJobNotification
  } = deps;

  async function orchestrate(payload) {
    const translationId = payload?.translationId;
    const ownerId = payload?.ownerId || 'default';
    if (!translationId) {
      console.warn('orchestrate invoked without translationId', { payload });
      return;
    }

    if (!RAW_BUCKET || !queueUrl) {
      await failTranslation({
        translationId,
        ownerId,
        errorMessage: !RAW_BUCKET ? 'RAW_BUCKET not configured' : 'TRANSLATION queue not configured'
      });
      return;
    }

    let item;
    try {
      item = await getTranslationItem(translationId, ownerId);
    } catch (err) {
      await failTranslation({ translationId, ownerId, errorMessage: err.message });
      return;
    }

    const attempt = Number(item.healthCheckRetries || 0) + 1;
    const originalKey = item.originalFileKey;
    if (!originalKey) {
      await failTranslation({
        translationId,
        ownerId,
        errorMessage: 'Original file key missing on translation item',
        context: item,
        fileName: item?.originalFilename,
        attempt
      });
      return;
    }

    const startedAt = item.startedAt || now();
    await updateTranslationItem(translationId, ownerId, { status: 'PROCESSING', startedAt });
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

    let buffer;
    let contentType;
    try {
      ({ buffer, contentType } = await readObject(RAW_BUCKET, originalKey));
    } catch (readErr) {
      await failTranslation({
        translationId,
        ownerId,
        errorMessage: 'Failed to read source document from S3',
        context: { originalKey, error: readErr.message },
        fileName: item.originalFilename,
        attempt
      });
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
      await recordLog({
        translationId,
        ownerId,
        eventType: 'parsing-error',
        status: 'FAILED',
        message: `Document parsing failed: ${parseErr.message}`,
        metadata: {
          filename: item.originalFilename,
          contentType,
          errorType: parseErr.name || 'ParseError'
        },
        context: {
          parseError: parseErr.message,
          filename: item.originalFilename || originalKey.split('/').pop() || 'document',
          stackTrace: parseErr.stack
        },
        attempt
      });

      await failTranslation({
        translationId,
        ownerId,
        errorMessage: 'Failed to prepare translation document',
        context: { error: parseErr.message },
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
        s3: deps.s3,
        ddb: deps.ddb,
        bucket: RAW_BUCKET,
        tableName: deps.DOCS_TABLE,
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
        fileName: item.originalFilename,
        attempt
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
          pending.push(record);
        }
      }
    }

    const chunkSummary = summariseChunks(Array.from(byId.values()));
    const contextKey = `translations/work/${ownerId}/${translationId}/context.json`;
    try {
      await putObject(RAW_BUCKET, contextKey, JSON.stringify({
        headHtml: document.headHtml,
        assets: enrichedAssets,
        anchors: resolvedAnchors
      }), 'application/json');
    } catch (storeErr) {
      await failTranslation({
        translationId,
        ownerId,
        errorMessage: 'Failed to persist translation context',
        context: { contextKey, error: storeErr.message },
        fileName: item.originalFilename,
        attempt
      });
      return;
    }

    await updateTranslationItem(translationId, ownerId, {
      totalChunks: document.chunks.length,
      processedChunks: chunkSummary.completed,
      failedChunks: chunkSummary.failed,
      headHtml: document.headHtml,
      assetCount: enrichedAssets.length,
      documentContextKey: contextKey
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

    if (pending.length) {
      const messages = pending.map(chunk => chunkMessagePayload({ translationId, ownerId, chunk }));
      await sendQueueBatch(messages);
    } else if (chunkSummary.total > 0 && chunkSummary.completed === chunkSummary.total) {
      await sendQueueMessage({ action: 'assemble', translationId, ownerId });
    }
  }

  async function processChunk(payload) {
    const translationId = payload?.translationId;
    const ownerId = payload?.ownerId || 'default';
    const chunkOrder = payload?.chunkOrder;
    if (!translationId || typeof chunkOrder === 'undefined') {
      console.warn('processChunk invoked with invalid payload', { payload });
      return;
    }

    let item;
    try {
      item = await getTranslationItem(translationId, ownerId);
    } catch (err) {
      console.error('processChunk missing translation item', { translationId, ownerId, error: err.message });
      return;
    }

    const chunk = await getChunk(translationId, ownerId, chunkOrder);
    if (!chunk) {
      console.warn('processChunk could not find chunk', { translationId, ownerId, chunkOrder });
      return;
    }

    if (chunk.status === 'COMPLETED') {
      const chunks = await listChunks(translationId, ownerId);
      const summary = summariseChunks(chunks);
      if (summary.total > 0 && summary.completed === summary.total) {
        await sendQueueMessage({ action: 'assemble', translationId, ownerId });
      }
      return;
    }

    const attempt = Number(chunk.machineAttempts || 0) + 1;
    await updateChunkState({
      translationId,
      ownerId,
      chunkOrder,
      patch: {
        status: 'PROCESSING',
        startedAt: chunk.startedAt || now(),
        machineAttempts: attempt
      }
    });

    await recordLog({
      translationId,
      ownerId,
      category: 'chunk-processing',
      stage: 'machine-translation',
      eventType: 'chunk-processing-started',
      status: 'PROCESSING',
      message: `Chunk ${chunkOrder} machine translation started`,
      chunkProgress: {
        completed: 0,
        failed: 0,
        total: item.totalChunks || 0
      }
    });

    let engine;
    try {
      engine = await getTranslationEngine();
    } catch (engineErr) {
      await failTranslation({
        translationId,
        ownerId,
        errorMessage: 'Failed to initialise translation engine',
        context: { error: engineErr.message },
        fileName: item.originalFilename
      });
      return;
    }

    try {
      const result = await engine.translateChunk({
        id: chunk.chunkId,
        chunkId: chunk.chunkId,
        order: chunk.order,
        sourceHtml: chunk.sourceHtml
      }, {
        sourceLanguage: item.sourceLanguage || 'auto',
        targetLanguage: item.targetLanguage || 'en',
        attempt: attempt - 1
      });

      const updated = await updateChunkState({
        translationId,
        ownerId,
        chunkOrder,
        patch: {
          status: 'COMPLETED',
          machineHtml: result.translatedHtml || chunk.sourceHtml,
          provider: result.provider || engine.name,
          model: result.model || engine.model,
          lastUpdatedBy: 'machine',
          lastUpdatedAt: now(),
          completedAt: now(),
          errorMessage: null
        }
      });

      const chunks = await listChunks(translationId, ownerId);
      const summary = summariseChunks(chunks);
      await updateTranslationItem(translationId, ownerId, {
        processedChunks: summary.completed,
        failedChunks: summary.failed
      });

      await recordLog({
        translationId,
        ownerId,
        category: 'chunk-processing',
        stage: 'machine-translation',
        eventType: 'chunk-processed',
        status: 'PROCESSING',
        message: `Chunk ${chunkOrder} machine-translated`,
        metadata: {
          provider: updated?.provider || engine.name,
          model: updated?.model || engine.model,
          chunkOrder
        },
        chunkProgress: {
          completed: summary.completed,
          failed: summary.failed,
          total: summary.total
        }
      });

      if (summary.total > 0 && summary.completed === summary.total) {
        await sendQueueMessage({ action: 'assemble', translationId, ownerId });
      }
    } catch (translateErr) {
      await updateChunkState({
        translationId,
        ownerId,
        chunkOrder,
        patch: {
          status: 'FAILED',
          errorMessage: translateErr.message,
          lastUpdatedBy: 'machine',
          lastUpdatedAt: now()
        }
      });

      await recordLog({
        translationId,
        ownerId,
        category: 'chunk-processing',
        stage: 'machine-translation',
        eventType: 'chunk-translation-failed',
        status: 'FAILED',
        message: `Chunk ${chunkOrder} translation failed: ${translateErr.message}`,
        metadata: { chunkOrder },
        failureReason: translateErr.message
      });

      await failTranslation({
        translationId,
        ownerId,
        errorMessage: 'Chunk translation failed',
        context: { chunkOrder, error: translateErr.message },
        fileName: item.originalFilename
      });
    }
  }

  async function assemble(payload) {
    const translationId = payload?.translationId;
    const ownerId = payload?.ownerId || 'default';
    if (!translationId) {
      console.warn('assemble invoked without translationId', { payload });
      return;
    }

    let item;
    try {
      item = await getTranslationItem(translationId, ownerId);
    } catch (err) {
      console.error('assemble missing translation item', { translationId, ownerId, error: err.message });
      return;
    }

    if (item.status === 'READY_FOR_REVIEW') {
      console.log('assemble skipping completed translation', { translationId, ownerId });
      return;
    }

    const chunks = await listChunks(translationId, ownerId);
    const summary = summariseChunks(chunks);
    if (!summary.total || summary.completed !== summary.total) {
      console.warn('assemble invoked before all chunks completed', { translationId, ownerId, summary });
      return;
    }

    let context = { headHtml: '', assets: [], anchors: [] };
    if (item.documentContextKey) {
      try {
        const stored = await readObject(RAW_BUCKET, item.documentContextKey);
        context = safeJsonParse(stored.buffer) || context;
      } catch (err) {
        console.warn('assemble failed to read context', { translationId, ownerId, error: err.message });
      }
    }

    const normalizedChunks = chunks
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(chunk => ({
        id: chunk.chunkId,
        order: chunk.order,
        blockId: chunk.blockId || chunk.chunkId,
        assetAnchors: chunk.assetAnchors || [],
        sourceHtml: chunk.sourceHtml,
        sourceText: chunk.sourceText,
        machineHtml: chunk.machineHtml,
        reviewerHtml: chunk.reviewerHtml || null,
        provider: chunk.provider || item.provider || null,
        model: chunk.model || item.model || null,
        lastUpdatedBy: chunk.lastUpdatedBy || 'machine',
        lastUpdatedAt: chunk.lastUpdatedAt || chunk.updatedAt || now(),
        reviewerName: chunk.reviewerName || null
      }));

    const chunkPayload = {
      translationId,
      generatedAt: now(),
      sourceLanguage: item.sourceLanguage,
      targetLanguage: item.targetLanguage,
      provider: normalizedChunks[0]?.provider || item.provider || null,
      model: normalizedChunks[0]?.model || item.model || null,
      headHtml: context.headHtml || item.headHtml || '',
      chunks: normalizedChunks,
      assets: context.assets || [],
      anchors: context.anchors || []
    };

    const chunkKey = `translations/chunks/${ownerId}/${translationId}.json`;
    try {
      await putObject(RAW_BUCKET, chunkKey, JSON.stringify(chunkPayload), 'application/json');
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
          chunkCount: chunkPayload.chunks.length
        },
        chunkProgress: {
          completed: chunkPayload.chunks.length,
          failed: 0,
          total: chunkPayload.chunks.length
        }
      });
    } catch (chunkErr) {
      await failTranslation({
        translationId,
        ownerId,
        errorMessage: 'Failed to persist translation chunks',
        context: { chunkKey, error: chunkErr.message },
        fileName: item.originalFilename
      });
      return;
    }

    const machineHtml = assembleHtmlDocument({
      headHtml: context.headHtml || item.headHtml,
      chunks: normalizedChunks,
      assets: context.assets || [],
      anchors: context.anchors || []
    });

    const machineKey = `translations/machine/${ownerId}/${translationId}.html`;
    try {
      await putObject(RAW_BUCKET, machineKey, machineHtml, 'text/html');
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
      await failTranslation({
        translationId,
        ownerId,
        errorMessage: 'Failed to persist machine translated HTML',
        context: { machineKey, error: htmlErr.message },
        fileName: item.originalFilename
      });
      return;
    }

    await updateTranslationItem(translationId, ownerId, {
      status: 'READY_FOR_REVIEW',
      chunkFileKey: chunkKey,
      machineFileKey: machineKey,
      totalChunks: normalizedChunks.length,
      translatedAt: now(),
      provider: chunkPayload.provider,
      model: chunkPayload.model,
      processedChunks: normalizedChunks.length,
      failedChunks: 0,
      assetCount: (context.assets || []).length,
      healthCheckRetries: 0,
      healthCheckReason: null
    });

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
        assetCount: (context.assets || []).length,
        provider: chunkPayload.provider,
        model: chunkPayload.model
      },
      chunkProgress: {
        completed: normalizedChunks.length,
        failed: 0,
        total: normalizedChunks.length
      }
    });

    await sendJobNotification({
      jobType: 'translation',
      status: 'completed',
      fileName: item.originalFilename,
      jobId: translationId,
      ownerId
    });
  }

  return {
    start: orchestrate,
    orchestrate,
    'process-chunk': processChunk,
    process: processChunk,
    assemble
  };
}

module.exports = { createModeHandlers };
