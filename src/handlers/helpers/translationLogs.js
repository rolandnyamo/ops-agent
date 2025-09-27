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

function buildLogItem({ translationId, ownerId = 'default', eventType, status, message, actor, metadata, context }) {
  if (!translationId) {
    throw new Error('translationId is required for logging');
  }
  if (!DOCS_TABLE) {
    throw new Error('DOCS_TABLE not configured');
  }
  const created = now();
  const createdAt = created.toISOString();
  const logId = crypto.randomUUID();
  const item = {
    PK: `TRANSLATION#${translationId}`,
    SK: `LOG#${createdAt}#${logId}`,
    translationId,
    ownerId: ownerId || 'default',
    logId,
    eventType: eventType || 'unknown',
    createdAt,
    expiresAt: Math.floor(created.getTime() / 1000) + TEN_DAYS_SECONDS
  };
  if (status) item.status = status;
  if (message) item.message = message;
  if (actor) item.actor = actor;
  if (metadata) item.metadata = metadata;
  if (context) item.context = context;
  return item;
}

async function appendTranslationLog(entry) {
  if (!DOCS_TABLE) {
    console.warn('appendTranslationLog skipped: DOCS_TABLE not configured');
    return;
  }
  const item = buildLogItem(entry);
  await ddb.send(new PutItemCommand({ TableName: DOCS_TABLE, Item: marshall(item, { removeUndefinedValues: true }) }));
  return item;
}

async function listTranslationLogs({ translationId, limit = 50, nextToken }) {
  if (!DOCS_TABLE) {
    throw new Error('DOCS_TABLE not configured');
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const params = {
    TableName: DOCS_TABLE,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
    ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
    ExpressionAttributeValues: marshall({
      ':pk': `TRANSLATION#${translationId}`,
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
      translationId: record.translationId,
      ownerId: record.ownerId,
      createdAt: record.createdAt,
      eventType: record.eventType,
      status: record.status || null,
      message: record.message || null,
      actor: record.actor || null,
      metadata: record.metadata || record.context || null
    };
  });
  const lastEvaluatedKey = res.LastEvaluatedKey ? base64Encode(res.LastEvaluatedKey) : null;
  return { items, nextToken: lastEvaluatedKey };
}

module.exports = {
  appendTranslationLog,
  listTranslationLogs
};
