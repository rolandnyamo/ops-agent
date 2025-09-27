const { DynamoDBClient, ScanCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { listChunks, summariseChunks } = require('./translationStore');
const { sendJobNotification } = require('./notifications');

const ddb = new DynamoDBClient({});
const eb = new EventBridgeClient({});
const lambda = new LambdaClient({});

const DOCS_TABLE = process.env.DOCS_TABLE;
const RAW_BUCKET = process.env.RAW_BUCKET;
const INGEST_WORKER_FUNCTION = process.env.INGEST_WORKER_FUNCTION_NAME;

function minutesAgo(minutes) {
  return Date.now() - minutes * 60 * 1000;
}

function isoToMs(value) {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

async function scanTranslations(status) {
  if (!DOCS_TABLE) return [];
  const res = await ddb.send(new ScanCommand({
    TableName: DOCS_TABLE,
    FilterExpression: 'begins_with(#pk, :pkPrefix) AND begins_with(#sk, :skPrefix) AND #status = :status',
    ExpressionAttributeNames: {
      '#pk': 'PK',
      '#sk': 'SK',
      '#status': 'status'
    },
    ExpressionAttributeValues: marshall({
      ':pkPrefix': 'TRANSLATION#',
      ':skPrefix': 'TRANSLATION#',
      ':status': status
    })
  }));
  return (res.Items || []).map(item => unmarshall(item));
}

async function scanDocs(status) {
  if (!DOCS_TABLE) return [];
  const res = await ddb.send(new ScanCommand({
    TableName: DOCS_TABLE,
    FilterExpression: 'begins_with(#pk, :pkPrefix) AND begins_with(#sk, :skPrefix) AND #status = :status',
    ExpressionAttributeNames: {
      '#pk': 'PK',
      '#sk': 'SK',
      '#status': 'status'
    },
    ExpressionAttributeValues: marshall({
      ':pkPrefix': 'DOC#',
      ':skPrefix': 'DOC#',
      ':status': status
    })
  }));
  return (res.Items || []).map(item => unmarshall(item));
}

async function evaluateTranslation(translation, { staleMinutes }) {
  const ownerId = translation.ownerId || 'default';
  const translationId = translation.translationId;
  const chunks = await listChunks(translationId, ownerId);
  const summary = summariseChunks(chunks);
  const activityCandidates = [summary.latestUpdate, translation.updatedAt, translation.createdAt, translation.startedAt];
  const latestMs = activityCandidates.map(isoToMs).reduce((acc, value) => (value > acc ? value : acc), 0);
  const stale = latestMs && latestMs < minutesAgo(staleMinutes)
    ? { reason: 'stale', lastActivity: new Date(latestMs).toISOString() }
    : null;
  const missingChunks = summary.total === 0;
  const readyToComplete = summary.total > 0 && summary.total === summary.completed;
  return {
    translation,
    ownerId,
    translationId,
    chunks,
    summary,
    stale,
    missingChunks,
    readyToComplete
  };
}

async function evaluateDoc(doc, { staleMinutes }) {
  const updatedAt = isoToMs(doc.updatedAt);
  const stale = updatedAt && updatedAt < minutesAgo(staleMinutes)
    ? { reason: 'stale', lastActivity: doc.updatedAt }
    : null;
  return {
    doc,
    stale
  };
}

async function restartTranslation(translationId, ownerId) {
  await eb.send(new PutEventsCommand({
    Entries: [{
      Source: 'ops-agent',
      DetailType: 'TranslationRequested',
      Detail: JSON.stringify({ translationId, ownerId })
    }]
  }));
}

async function invokeIngestWorker(doc) {
  if (!INGEST_WORKER_FUNCTION || !RAW_BUCKET) return;
  const key = doc.fileKey;
  if (!key) return;
  const payload = {
    detail: {
      bucket: { name: RAW_BUCKET },
      object: { key }
    }
  };
  await lambda.send(new InvokeCommand({
    FunctionName: INGEST_WORKER_FUNCTION,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload))
  }));
}

async function markTranslationFailed(translationId, ownerId, reason) {
  if (!DOCS_TABLE) return;
  const patch = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
    '#errorMessage': 'errorMessage',
    '#errorContext': 'errorContext'
  };
  const values = marshall({
    ':status': 'FAILED',
    ':updatedAt': new Date().toISOString(),
    ':errorMessage': 'Translation stalled',
    ':errorContext': reason || 'Stale job detected by health check'
  });
  await ddb.send(new UpdateItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall({ PK: `TRANSLATION#${translationId}`, SK: `TRANSLATION#${ownerId}` }),
    UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #errorMessage = :errorMessage, #errorContext = :errorContext',
    ExpressionAttributeNames: patch,
    ExpressionAttributeValues: values
  }));
}

module.exports = {
  scanTranslations,
  scanDocs,
  evaluateTranslation,
  evaluateDoc,
  restartTranslation,
  invokeIngestWorker,
  markTranslationFailed,
  sendJobNotification
};

