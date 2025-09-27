const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { prepareTranslationDocument, assembleHtmlDocument } = require('./helpers/documentParser');
const { getTranslationEngine } = require('./helpers/translationEngine');
const { ensureChunkSource, listChunks, updateChunkState, summariseChunks } = require('./helpers/translationStore');
const { sendJobNotification } = require('./helpers/notifications');

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

async function failTranslation({ translationId, ownerId, errorMessage, context, fileName }) {
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
      jobId: translationId
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
    const originalKey = item.originalFileKey;
    if (!originalKey) {
      await failTranslation({ translationId, ownerId, errorMessage: 'Original file key missing on translation item', context: item, fileName: item?.originalFilename });
      return;
    }

    const startedAt = item.startedAt || now();
    await updateTranslationItem(translationId, ownerId, { status: 'PROCESSING', startedAt });

    let buffer, contentType;
    try {
      ({ buffer, contentType } = await readObject(RAW_BUCKET, originalKey));
    } catch (readErr) {
      await failTranslation({ translationId, ownerId, errorMessage: 'Failed to read source document from S3', context: { originalKey, error: readErr.message }, fileName: item.originalFilename });
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
      // Provide more specific error messages for common PDF issues
      let errorMessage = 'Failed to prepare translation document';
      if (parseErr.message.includes('bad XRef') || 
          parseErr.message.includes('Invalid PDF') ||
          parseErr.message.includes('PDF parsing failed')) {
        errorMessage = 'PDF file appears to be corrupted or invalid. Please try re-uploading the file or ensure the PDF is not password-protected.';
      } else if (parseErr.message.includes('Unsupported content type')) {
        errorMessage = 'File format not supported for translation. Please upload a PDF, Word document (DOC/DOCX), HTML, RTF, ODT, or text file.';
      }
      
      await failTranslation({
        translationId,
        ownerId,
        errorMessage,
        context: {
          error: parseErr.message,
          filename: item.originalFilename || originalKey.split('/').pop() || 'document'
        },
        fileName: item.originalFilename
      });
      return;
    }

    let engine;
    try {
      engine = await getTranslationEngine();
    } catch (engineErr) {
      await failTranslation({ translationId, ownerId, errorMessage: 'Failed to initialise translation engine', context: { error: engineErr.message }, fileName: item.originalFilename });
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
      headHtml: document.headHtml
    });

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
        await failTranslation({ translationId, ownerId, errorMessage: 'Translation provider error', context: { error: translateErr.message }, fileName: item.originalFilename });
        return;
      }

      for (const translation of translations) {
        const record = byId.get(translation.id) || pending.find(p => p.chunk.id === translation.id)?.record;
        if (!record) continue;
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
    }

    const finalChunks = Array.from(byId.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
    const finalSummary = summariseChunks(finalChunks);

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

    const payload = {
      translationId,
      generatedAt: now(),
      sourceLanguage: item.sourceLanguage,
      targetLanguage: item.targetLanguage,
      provider: engine.name,
      model: engine.model,
      headHtml: document.headHtml,
      chunks: normalizedChunks
    };

    const chunkKey = `translations/chunks/${ownerId}/${translationId}.json`;
    try {
      await putObject(RAW_BUCKET, chunkKey, JSON.stringify(payload), 'application/json');
      console.log('translationWorker chunks stored', { translationId, chunkKey, chunkCount: payload.chunks.length });
    } catch (chunkErr) {
      await failTranslation({ translationId, ownerId, errorMessage: 'Failed to persist translation chunks', context: { chunkKey, error: chunkErr.message }, fileName: item.originalFilename });
      return;
    }

    const machineHtml = assembleHtmlDocument({
      headHtml: document.headHtml,
      chunks: normalizedChunks
    });
    const machineKey = `translations/machine/${ownerId}/${translationId}.html`;
    try {
      await putObject(RAW_BUCKET, machineKey, machineHtml, 'text/html');
      console.log('translationWorker machine HTML stored', { translationId, machineKey, length: machineHtml.length });
    } catch (htmlErr) {
      await failTranslation({ translationId, ownerId, errorMessage: 'Failed to persist machine translated HTML', context: { machineKey, error: htmlErr.message }, fileName: item.originalFilename });
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
      healthCheckRetries: 0,
      healthCheckReason: null
    });
    console.log('translationWorker completed', { translationId, chunkKey, machineKey, chunkCount: normalizedChunks.length });
    await sendJobNotification({
      jobType: 'translation',
      status: 'completed',
      fileName: item.originalFilename,
      jobId: translationId
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
