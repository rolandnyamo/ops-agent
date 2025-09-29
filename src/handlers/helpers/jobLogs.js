const { DynamoDBClient, PutItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const crypto = require('node:crypto');

const ddb = new DynamoDBClient({});
const DOCS_TABLE = process.env.DOCS_TABLE;

const TEN_DAYS_SECONDS = 10 * 24 * 60 * 60;

function now() {
  return new Date();
}

function base64Encode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

function base64Decode(token) {
  try {
    return JSON.parse(Buffer.from(String(token), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function partitionKey(jobType, jobId) {
  if (jobType === 'translation') {
    return `TRANSLATION#${jobId}`;
  }
  if (jobType === 'documentation') {
    return `DOC#${jobId}`;
  }
  return `JOB#${jobId}`;
}

function normaliseActor(actor = {}) {
  if (!actor || typeof actor !== 'object') {
    return null;
  }
  const { type = 'system', email = null, name = null, sub = null, source = null, role = null } = actor;
  if (!type && !email && !name && !sub && !source && !role) {
    return null;
  }
  return { type: type || 'system', email, name, sub, source, role };
}

function buildLogItem({
  jobType,
  jobId,
  ownerId = 'default',
  category,
  stage,
  eventType,
  status,
  message,
  actor,
  metadata,
  context,
  attempt,
  retryCount,
  failureReason,
  chunkProgress,
  statusCode
}) {
  if (!DOCS_TABLE) {
    throw new Error('DOCS_TABLE not configured');
  }
  if (!jobType) {
    throw new Error('jobType is required for logging');
  }
  if (!jobId) {
    throw new Error('jobId is required for logging');
  }

  const created = now();
  const createdAt = created.toISOString();
  const logId = crypto.randomUUID();

  const item = {
    PK: partitionKey(jobType, jobId),
    SK: `LOG#${createdAt}#${logId}`,
    jobType,
    jobId,
    ownerId: ownerId || 'default',
    logId,
    createdAt,
    expiresAt: Math.floor(created.getTime() / 1000) + TEN_DAYS_SECONDS
  };

  if (category) item.category = category;
  if (stage) item.stage = stage;
  if (eventType) item.eventType = eventType;
  if (typeof status !== 'undefined') item.status = status;
  if (typeof statusCode !== 'undefined') item.statusCode = statusCode;
  if (message) item.message = message;
  const actorPayload = normaliseActor(actor);
  if (actorPayload) item.actor = actorPayload;
  if (metadata) item.metadata = metadata;
  if (context) item.context = context;
  if (typeof attempt !== 'undefined') item.attempt = attempt;
  if (typeof retryCount !== 'undefined') item.retryCount = retryCount;
  if (failureReason) item.failureReason = failureReason;
  if (chunkProgress) item.chunkProgress = chunkProgress;

  return item;
}

async function appendJobLog(entry) {
  if (!DOCS_TABLE) {
    console.warn('appendJobLog skipped: DOCS_TABLE not configured');
    return null;
  }
  const item = buildLogItem(entry);
  await ddb.send(new PutItemCommand({
    TableName: DOCS_TABLE,
    Item: marshall(item, { removeUndefinedValues: true })
  }));
  return item;
}

async function listJobLogs({ jobType, jobId, limit = 50, nextToken }) {
  if (!DOCS_TABLE) {
    throw new Error('DOCS_TABLE not configured');
  }
  if (!jobType) {
    throw new Error('jobType is required');
  }
  if (!jobId) {
    throw new Error('jobId is required');
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const params = {
    TableName: DOCS_TABLE,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
    ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
    ExpressionAttributeValues: marshall({
      ':pk': partitionKey(jobType, jobId),
      ':sk': 'LOG#'
    }),
    ScanIndexForward: false,
    Limit: safeLimit
  };

  const startKey = nextToken ? base64Decode(nextToken) : null;
  if (startKey) {
    params.ExclusiveStartKey = startKey;
  }

  const res = await ddb.send(new QueryCommand(params));
  const items = (res.Items || []).map(raw => {
    const record = unmarshall(raw);
    return {
      logId: record.logId || record.SK?.split('#')[2],
      jobType: record.jobType,
      jobId: record.jobId,
      ownerId: record.ownerId,
      createdAt: record.createdAt,
      category: record.category || null,
      stage: record.stage || null,
      eventType: record.eventType,
      status: record.status || null,
      statusCode: record.statusCode || null,
      message: record.message || null,
      actor: record.actor || null,
      metadata: record.metadata || null,
      context: record.context || null,
      attempt: typeof record.attempt === 'number' ? record.attempt : null,
      retryCount: typeof record.retryCount === 'number' ? record.retryCount : null,
      failureReason: record.failureReason || null,
      chunkProgress: record.chunkProgress || null
    };
  });

  const lastEvaluatedKey = res.LastEvaluatedKey ? base64Encode(res.LastEvaluatedKey) : null;
  return { items, nextToken: lastEvaluatedKey };
}

module.exports = {
  appendJobLog,
  listJobLogs
};
