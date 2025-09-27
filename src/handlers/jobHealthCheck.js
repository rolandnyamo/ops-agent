const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const {
  scanTranslations,
  evaluateTranslation,
  restartTranslation,
  markTranslationFailed,
  scanDocs,
  evaluateDoc,
  invokeIngestWorker,
  sendJobNotification
} = require('./helpers/jobMonitor');

const ddb = new DynamoDBClient({});

const DOCS_TABLE = process.env.DOCS_TABLE;
const STALE_MINUTES = Number(process.env.JOB_HEALTH_STALE_MINUTES || 15);
const RETRY_LIMIT = Number(process.env.JOB_HEALTH_MAX_RETRIES || 3);

function now() {
  return new Date().toISOString();
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
    jobId: doc.docId
  });
}

exports.handler = async () => {
  const result = {
    translationsChecked: 0,
    translationsRestarted: 0,
    translationsFailed: 0,
    docsChecked: 0,
    docsRestarted: 0,
    docsFailed: 0
  };

  const translations = await scanTranslations('PROCESSING');
  result.translationsChecked = translations.length;
  for (const translation of translations) {
    const report = await evaluateTranslation(translation, { staleMinutes: STALE_MINUTES });
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
        jobId: report.translationId
      });
      result.translationsFailed += 1;
      continue;
    }
    await restartTranslation(report.translationId, report.ownerId);
    result.translationsRestarted += 1;
  }

  const docs = await scanDocs('PROCESSING');
  result.docsChecked = docs.length;
  for (const doc of docs) {
    const report = await evaluateDoc(doc, { staleMinutes: STALE_MINUTES });
    if (!report.stale) continue;
    const retries = await incrementDocRetry(doc.docId, doc.agentId || 'default', 'stale');
    if (retries > RETRY_LIMIT) {
      await markDocFailed(doc, 'Stale ingestion detected by health check');
      result.docsFailed += 1;
      continue;
    }
    await invokeIngestWorker(doc);
    result.docsRestarted += 1;
  }

  console.log('jobHealthCheck summary', result);
  return result;
};

