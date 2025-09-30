const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { SQSClient, SendMessageCommand, SendMessageBatchCommand } = require('@aws-sdk/client-sqs');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { appendJobLog } = require('./helpers/jobLogs');
const { sendJobNotification } = require('./helpers/notifications');
const { createModeHandlers } = require('./helpers/translationWorkerModes');

const s3 = new S3Client({});
const ddb = new DynamoDBClient({});
const sqs = new SQSClient({});

const RAW_BUCKET = process.env.RAW_BUCKET;
const DOCS_TABLE = process.env.DOCS_TABLE;
const QUEUE_URL = process.env.TRANSLATION_QUEUE_URL;

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

async function sendQueueMessage(payload) {
  if (!QUEUE_URL) {
    console.warn('sendQueueMessage called without TRANSLATION_QUEUE_URL');
    return;
  }
  await sqs.send(new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify(payload)
  }));
}

async function sendQueueBatch(messages) {
  if (!QUEUE_URL || !Array.isArray(messages) || !messages.length) {
    if (!QUEUE_URL) {
      console.warn('sendQueueBatch called without TRANSLATION_QUEUE_URL');
    }
    return;
  }
  const copy = Array.from(messages, (msg) => JSON.stringify(msg));
  let index = 0;
  while (index < copy.length) {
    const batch = copy.slice(index, index + 10);
    const entries = batch.map((body, idx) => ({
      Id: `${index + idx}`,
      MessageBody: body
    }));
    await sqs.send(new SendMessageBatchCommand({ QueueUrl: QUEUE_URL, Entries: entries }));
    index += 10;
  }
}

async function failTranslation({ translationId, ownerId, errorMessage, context, fileName, attempt }) {
  if (!translationId) return;
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
  if (!DOCS_TABLE) {
    throw new Error('DOCS_TABLE not configured');
  }
  const key = { PK: `TRANSLATION#${translationId}`, SK: `TRANSLATION#${ownerId}` };
  const res = await ddb.send(new GetItemCommand({ TableName: DOCS_TABLE, Key: marshall(key) }));
  if (!res.Item) {
    throw new Error(`Translation ${translationId} not found`);
  }
  return unmarshall(res.Item);
}

async function updateTranslationItem(translationId, ownerId = 'default', patch) {
  if (!DOCS_TABLE) {
    throw new Error('DOCS_TABLE not configured');
  }
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

const modeHandlers = createModeHandlers({
  RAW_BUCKET,
  DOCS_TABLE,
  queueUrl: QUEUE_URL,
  s3,
  ddb,
  sqs,
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
});

async function handlePayload(payload, meta = {}) {
  if (!payload || typeof payload !== 'object') {
    console.warn('handlePayload received invalid payload', { payload, meta });
    return;
  }
  const action = String(payload.action || payload.mode || 'start').toLowerCase();
  const handler = modeHandlers[action];
  if (!handler) {
    console.warn('translationWorker received unsupported action', { action, payload });
    return;
  }
  await handler(payload, meta);
}

exports.handler = async (event) => {
  const records = Array.isArray(event?.Records) ? event.Records : null;
  if (records && records.length) {
    for (const record of records) {
      let payload;
      try {
        const pendingChunks = pending.map(p => p.chunk);
        await Promise.all(pending.map(({ record }) => updateChunkState({
          translationId,
          ownerId,
          chunkOrder: record.order,
          chunkId: record.chunkId,
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
          chunkId: record.chunkId,
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
          chunkId: record.chunkId,
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
    return;
  }

  if (event?.detail) {
    const payload = { ...event.detail, action: event.detail.action || 'start' };
    await handlePayload(payload, { legacyEvent: true });
    return;
  }

  console.warn('translationWorker invoked with unexpected event shape', { event });
};
