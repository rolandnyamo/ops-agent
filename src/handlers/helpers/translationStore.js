const { DynamoDBClient, QueryCommand, UpdateItemCommand, BatchWriteItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const ddb = new DynamoDBClient({});

const DOCS_TABLE = process.env.DOCS_TABLE;

if (!DOCS_TABLE) {
  console.warn('translationStore initialised without DOCS_TABLE environment variable');
}

function now() {
  return new Date().toISOString();
}

function chunkSortKey(order) {
  const padded = String(Number(order || 0)).padStart(6, '0');
  return `CHUNK#${padded}`;
}

function chunkPrimaryKey(translationId, ownerId, order) {
  return {
    PK: `TRANSLATION#${translationId}`,
    SK: chunkSortKey(order)
  };
}

async function listChunks(translationId, ownerId) {
  if (!DOCS_TABLE) return [];
  const params = {
    TableName: DOCS_TABLE,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
    ExpressionAttributeNames: {
      '#pk': 'PK',
      '#sk': 'SK'
    },
    ExpressionAttributeValues: marshall({
      ':pk': `TRANSLATION#${translationId}`,
      ':skPrefix': 'CHUNK#'
    })
  };
  const res = await ddb.send(new QueryCommand(params));
  return (res.Items || []).map(item => unmarshall(item));
}

async function ensureChunkSource({ translationId, ownerId = 'default', chunk }) {
  if (!DOCS_TABLE || !chunk) return;
  const key = chunkPrimaryKey(translationId, ownerId, chunk.order);
  const names = {
    '#updatedAt': 'updatedAt',
    '#chunkId': 'chunkId',
    '#order': 'order',
    '#status': 'status',
    '#sourceHtml': 'sourceHtml',
    '#sourceText': 'sourceText',
    '#createdAt': 'createdAt',
    '#blockId': 'blockId',
    '#assetAnchors': 'assetAnchors'
  };
  const values = marshall({
    ':updatedAt': now(),
    ':chunkId': chunk.id,
    ':order': chunk.order,
    ':status': 'PENDING',
    ':sourceHtml': chunk.sourceHtml || '',
    ':sourceText': chunk.sourceText || '',
    ':createdAt': now(),
    ':blockId': chunk.blockId || chunk.id,
    ':assetAnchors': chunk.anchorIds || []
  });
  const res = await ddb.send(new UpdateItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall(key),
    UpdateExpression: 'SET #updatedAt = :updatedAt, #chunkId = :chunkId, #order = :order, #sourceHtml = :sourceHtml, #sourceText = :sourceText, #blockId = :blockId, #assetAnchors = :assetAnchors, #status = if_not_exists(#status, :status), #createdAt = if_not_exists(#createdAt, :createdAt)',
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW'
  }));
  return res.Attributes ? unmarshall(res.Attributes) : undefined;
}

async function updateChunkState({ translationId, ownerId = 'default', chunkOrder, patch }) {
  if (!DOCS_TABLE || !patch || typeof chunkOrder === 'undefined') return;
  const key = chunkPrimaryKey(translationId, ownerId, chunkOrder);
  const names = { '#updatedAt': 'updatedAt' };
  const sets = ['#updatedAt = :updatedAt'];
  const values = { ':updatedAt': now() };
  for (const [field, value] of Object.entries(patch)) {
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    sets.push(`#${field} = :${field}`);
  }
  const res = await ddb.send(new UpdateItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall(key),
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(values),
    ReturnValues: 'ALL_NEW'
  }));
  return res.Attributes ? unmarshall(res.Attributes) : undefined;
}

async function deleteAllChunks(translationId, ownerId = 'default') {
  if (!DOCS_TABLE) return;
  const chunks = await listChunks(translationId, ownerId);
  if (!chunks.length) return;
  const requests = chunks.map(chunk => ({
    DeleteRequest: {
      Key: marshall({ PK: chunk.PK, SK: chunk.SK })
    }
  }));
  while (requests.length) {
    const batch = requests.splice(0, 25);
    await ddb.send(new BatchWriteItemCommand({
      RequestItems: {
        [DOCS_TABLE]: batch
      }
    }));
  }
}

function summariseChunks(chunks = []) {
  const total = chunks.length;
  const completed = chunks.filter(chunk => chunk.status === 'COMPLETED').length;
  const failed = chunks.filter(chunk => chunk.status === 'FAILED').length;
  const latestUpdate = chunks.reduce((acc, chunk) => {
    const ts = chunk.updatedAt || chunk.lastUpdatedAt || chunk.completedAt;
    if (!ts) return acc;
    return !acc || new Date(ts) > new Date(acc) ? ts : acc;
  }, null);
  return { total, completed, failed, latestUpdate };
}

module.exports = {
  listChunks,
  ensureChunkSource,
  updateChunkState,
  deleteAllChunks,
  summariseChunks,
  chunkSortKey
};

