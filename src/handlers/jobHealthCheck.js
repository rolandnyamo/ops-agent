const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const {
  scanTranslations,
  evaluateTranslation,
  restartTranslation,
  markTranslationFailed,
  scanDocs,
  evaluateDoc,
  invokeIngestWorker,
  sendJobNotification,
  enqueueChunkProcessing
} = require('./helpers/jobMonitor');
const { appendJobLog } = require('./helpers/jobLogs');
const { deleteAllChunks } = require('./helpers/translationStore');

const ddb = new DynamoDBClient({});
const s3 = new S3Client({});

const DOCS_TABLE = process.env.DOCS_TABLE;
const STALE_MINUTES = Number(process.env.JOB_HEALTH_STALE_MINUTES || 15);
const RETRY_LIMIT = Number(process.env.JOB_HEALTH_MAX_RETRIES || 3);
const RAW_BUCKET = process.env.RAW_BUCKET;
const MAX_CHUNK_RETRIES = Math.max(0, Number(process.env.TRANSLATION_CHUNK_MAX_RETRIES || 3));

function now() {
  return new Date().toISOString();
}

async function deleteObject(key) {
  if (!RAW_BUCKET || !key) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: RAW_BUCKET, Key: key }));
  } catch (err) {
    console.warn('jobHealthCheck failed to delete object', { key, error: err?.message || err });
  }
}

async function incrementTranslationRetry(translationId, ownerId, reason) {
  if (!DOCS_TABLE) return 0;
  const res = await ddb.send(new UpdateItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall({ PK: `TRANSLATION#${translationId}`, SK: `TRANSLATION#${ownerId}` }),
    UpdateExpression: 'SET #retries = if_not_exists(#retries, :zero) + :one, #healthReason = :reason, #healthCheckedAt = :now',
    ExpressionAttributeNames: {
      '#retries': 'healthCheckRetries',
      '#healthReason': 'healthCheckReason',
      '#healthCheckedAt': 'healthCheckedAt'
    },
    ExpressionAttributeValues: marshall({
      ':zero': 0,
      ':one': 1,
      ':reason': reason,
      ':now': now()
    }),
    ReturnValues: 'ALL_NEW'
  }));
  const attrs = res.Attributes ? unmarshall(res.Attributes) : {};
  return attrs.healthCheckRetries || 0;
}

async function incrementDocRetry(docId, agentId, reason) {
  if (!DOCS_TABLE) return 0;
  const res = await ddb.send(new UpdateItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall({ PK: `DOC#${docId}`, SK: `DOC#${agentId}` }),
    UpdateExpression: 'SET #retries = if_not_exists(#retries, :zero) + :one, #healthReason = :reason, #healthCheckedAt = :now',
    ExpressionAttributeNames: {
      '#retries': 'healthCheckRetries',
      '#healthReason': 'healthCheckReason',
      '#healthCheckedAt': 'healthCheckedAt'
    },
    ExpressionAttributeValues: marshall({
      ':zero': 0,
      ':one': 1,
      ':reason': reason,
      ':now': now()
    }),
    ReturnValues: 'ALL_NEW'
  }));
  const attrs = res.Attributes ? unmarshall(res.Attributes) : {};
  return attrs.healthCheckRetries || 0;
}

async function markDocFailed(doc, reason) {
  if (!DOCS_TABLE) return;
  await ddb.send(new UpdateItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall({ PK: `DOC#${doc.docId}`, SK: `DOC#${doc.agentId}` }),
    UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #error = :error',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      '#error': 'error'
    },
    ExpressionAttributeValues: marshall({
      ':status': 'FAILED',
      ':updatedAt': now(),
      ':error': reason || 'Processing stalled'
    })
  }));
  await sendJobNotification({
    jobType: 'documentation',
    status: 'failed',
    fileName: doc.title || doc.fileKey?.split('/').pop() || doc.docId,
    jobId: doc.docId,
    ownerId: doc.agentId || 'default'
  });
}

async function cleanupCancelledTranslationRecord(translation) {
  if (!DOCS_TABLE || !translation) return false;
  if (translation.cancelCleanupAt) return false;
  const translationId = translation.translationId;
  const ownerId = translation.ownerId || 'default';
  const keys = Array.from(new Set([
    translation.chunkFileKey,
    translation.machineFileKey,
    translation.translatedFileKey,
    translation.translatedHtmlKey,
    `translations/chunks/${ownerId}/${translationId}.json`,
    `translations/machine/${ownerId}/${translationId}.html`,
    `translations/output/${ownerId}/${translationId}.html`,
    `translations/output/${ownerId}/${translationId}.docx`
  ].filter(Boolean)));
  if (keys.length) {
    await Promise.all(keys.map(deleteObject));
  }
  await deleteAllChunks(translationId, ownerId);
  await ddb.send(new UpdateItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall({ PK: `TRANSLATION#${translationId}`, SK: `TRANSLATION#${ownerId}` }),
    UpdateExpression: 'SET #updatedAt = :now, #cleanupAt = :now REMOVE #chunkFileKey, #machineFileKey, #translatedFileKey, #translatedHtmlKey',
    ExpressionAttributeNames: {
      '#updatedAt': 'updatedAt',
      '#chunkFileKey': 'chunkFileKey',
      '#machineFileKey': 'machineFileKey',
      '#translatedFileKey': 'translatedFileKey',
      '#translatedHtmlKey': 'translatedHtmlKey',
      '#cleanupAt': 'cancelCleanupAt'
    },
    ExpressionAttributeValues: marshall({
      ':now': now()
    })
  }));
  await appendJobLog({
    jobType: 'translation',
    jobId: translationId,
    ownerId,
    category: 'processing-control',
    stage: 'cancel-cleanup',
    eventType: 'cancelled-cleanup',
    status: 'CANCELLED',
    message: 'Cancelled translation artifacts cleaned by health monitor',
    actor: { type: 'system', source: 'health-check', role: 'system' }
  });
  return true;
}

async function recordRestartLog(translationId, ownerId, reason) {
  try {
    await appendJobLog({
      jobType: 'translation',
      jobId: translationId,
      ownerId,
      category: 'health-monitoring',
      stage: 'auto-restart',
      eventType: 'restart-requested',
      status: 'PROCESSING',
      message: 'Translation restart triggered by health check',
      actor: { type: 'system', source: 'health-check', role: 'system' },
      metadata: { reason }
    });
  } catch (err) {
    console.warn('Failed to append health check translation log', err?.message || err);
  }
}

exports.handler = async () => {
  const result = {
    translationsChecked: 0,
    translationsRestarted: 0,
    translationsFailed: 0,
    translationChunksRequeued: 0,
    translationsCancelledCleaned: 0,
    docsChecked: 0,
    docsRestarted: 0,
    docsFailed: 0
  };

  const translations = await scanTranslations('PROCESSING');
  result.translationsChecked = translations.length;
  for (const translation of translations) {
    const report = await evaluateTranslation(translation, { staleMinutes: STALE_MINUTES });

    const failedChunks = (report.chunks || []).filter(chunk => chunk?.status === 'FAILED');
    if (failedChunks.length) {
      const reason = 'chunk-failed';
      const retries = await incrementTranslationRetry(report.translationId, report.ownerId, reason);
      let exhausted = false;
      const retriedOrders = [];
      for (const chunk of failedChunks) {
        const attempts = Number(chunk.machineAttempts || 0);
        const retriesAllowed = MAX_CHUNK_RETRIES > 0;
        if (!retriesAllowed || attempts >= MAX_CHUNK_RETRIES) {
          exhausted = true;
          continue;
        }
        await enqueueChunkProcessing({ translationId: report.translationId, ownerId: report.ownerId, chunk });
        retriedOrders.push(chunk.order);
        await appendJobLog({
          jobType: 'translation',
          jobId: report.translationId,
          ownerId: report.ownerId,
          category: 'health-monitoring',
          stage: 'chunk-retry',
          eventType: 'chunk-retry-scheduled',
          status: 'PROCESSING',
          message: `Health check requeued chunk ${chunk.order} (machineAttempts=${attempts})`,
          metadata: {
            chunkOrder: chunk.order,
            machineAttempts: attempts,
            maxChunkRetries: MAX_CHUNK_RETRIES,
            healthRetries: retries
          }
        });
      }

      if (exhausted || retries > RETRY_LIMIT) {
        await markTranslationFailed(report.translationId, report.ownerId, exhausted ? 'chunk-max-retries' : reason);
        await sendJobNotification({
          jobType: 'translation',
          status: 'failed',
          fileName: translation.originalFilename || translation.title || translation.translationId,
          jobId: report.translationId,
          ownerId: report.ownerId
        });
        await appendJobLog({
          jobType: 'translation',
          jobId: report.translationId,
          ownerId: report.ownerId,
          category: 'health-monitoring',
          stage: 'auto-fail',
          eventType: 'health-check-failed',
          status: 'FAILED',
          message: exhausted
            ? 'Translation marked failed after chunk exceeded max retries'
            : 'Translation marked failed after repeated chunk failures',
          actor: { type: 'system', source: 'health-check', role: 'system' },
          metadata: {
            reason: exhausted ? 'chunk-max-retries' : reason,
            retries,
            failedChunks: failedChunks.map(chunk => ({ order: chunk.order, machineAttempts: chunk.machineAttempts }))
          }
        });
        result.translationsFailed += 1;
        continue;
      }

      if (retriedOrders.length) {
        result.translationChunksRequeued += retriedOrders.length;
      }
      continue;
    }

    if (!report.missingChunks && !report.stale) {
      continue;
    }
    const reason = report.missingChunks ? 'no-chunks' : 'stale-progress';
    const retries = await incrementTranslationRetry(report.translationId, report.ownerId, reason);
    if (retries > RETRY_LIMIT) {
      await markTranslationFailed(report.translationId, report.ownerId, reason);
      await sendJobNotification({
        jobType: 'translation',
        status: 'failed',
        fileName: translation.originalFilename || translation.title || translation.translationId,
        jobId: report.translationId,
        ownerId: report.ownerId
      });
      await appendJobLog({
        jobType: 'translation',
        jobId: report.translationId,
        ownerId: report.ownerId,
        category: 'health-monitoring',
        stage: 'auto-fail',
        eventType: 'health-check-failed',
        status: 'FAILED',
        message: 'Translation marked failed after exceeding health check retries',
        actor: { type: 'system', source: 'health-check', role: 'system' },
        metadata: { reason, retries }
      });
      result.translationsFailed += 1;
      continue;
    }
    await restartTranslation(report.translationId, report.ownerId);
    await recordRestartLog(report.translationId, report.ownerId, reason);
    result.translationsRestarted += 1;
  }

  const cancelledTranslations = await scanTranslations('CANCELLED');
  for (const translation of cancelledTranslations) {
    const cleaned = await cleanupCancelledTranslationRecord(translation);
    if (cleaned) {
      result.translationsCancelledCleaned += 1;
    }
  }

  const docs = await scanDocs('PROCESSING');
  result.docsChecked = docs.length;
  for (const doc of docs) {
    const report = await evaluateDoc(doc, { staleMinutes: STALE_MINUTES });
    if (!report.stale) continue;
    const retries = await incrementDocRetry(doc.docId, doc.agentId || 'default', 'stale');
    if (retries > RETRY_LIMIT) {
      await markDocFailed(doc, 'Stale ingestion detected by health check');
      await appendJobLog({
        jobType: 'documentation',
        jobId: doc.docId,
        ownerId: doc.agentId || 'default',
        category: 'health-monitoring',
        stage: 'auto-fail',
        eventType: 'health-check-failed',
        status: 'FAILED',
        message: 'Documentation ingestion marked failed after exceeding health check retries',
        actor: { type: 'system', source: 'health-check', role: 'system' },
        metadata: { reason: 'stale', retries }
      });
      result.docsFailed += 1;
      continue;
    }
    await invokeIngestWorker(doc);
    await appendJobLog({
      jobType: 'documentation',
      jobId: doc.docId,
      ownerId: doc.agentId || 'default',
      category: 'health-monitoring',
      stage: 'auto-restart',
      eventType: 'restart-requested',
      status: 'PROCESSING',
      message: 'Documentation ingestion restart triggered by health check',
      actor: { type: 'system', source: 'health-check', role: 'system' },
      metadata: { retries }
    });
    result.docsRestarted += 1;
  }

  console.log('jobHealthCheck summary', result);
  return result;
};
