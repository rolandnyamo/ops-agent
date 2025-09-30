const { DynamoDBClient, QueryCommand, UpdateItemCommand, BatchWriteItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const ddb = new DynamoDBClient({});
const s3 = new S3Client({});

const DOCS_TABLE = process.env.DOCS_TABLE;
const RAW_BUCKET = process.env.RAW_BUCKET;

if (!DOCS_TABLE) {
  console.warn('translationStore initialised without DOCS_TABLE environment variable');
}
if (!RAW_BUCKET) {
  console.warn('translationStore initialised without RAW_BUCKET environment variable');
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

function chunkDataKey(translationId, ownerId, chunkId) {
  const safeChunkId = encodeURIComponent(chunkId || 'unknown');
  return `translations/chunk-data/${ownerId}/${translationId}/${safeChunkId}.json`;
}

async function putChunkData({ translationId, ownerId, chunkId, dataKey, data }) {
  if (!RAW_BUCKET) {
    throw new Error('RAW_BUCKET environment variable is not configured');
  }
  if (!chunkId) {
    throw new Error('chunkId is required for putChunkData');
  }
  if (!translationId) {
    throw new Error('translationId is required for putChunkData');
  }
  if (!ownerId) {
    throw new Error('ownerId is required for putChunkData');
  }
  const key = dataKey || chunkDataKey(translationId, ownerId, chunkId);
  const body = JSON.stringify({
    chunkId,
    translationId,
    ownerId,
    ...data
  });
  await s3.send(new PutObjectCommand({
    Bucket: RAW_BUCKET,
    Key: key,
    Body: body,
    ContentType: 'application/json'
  }));
  return { key };
}

async function getChunkData({ translationId, ownerId, chunkId, dataKey }) {
  if (!RAW_BUCKET) {
    throw new Error('RAW_BUCKET environment variable is not configured');
  }
  if (!chunkId) {
    throw new Error('chunkId is required for getChunkData');
  }
  if (!translationId) {
    throw new Error('translationId is required for getChunkData');
  }
  if (!ownerId) {
    throw new Error('ownerId is required for getChunkData');
  }
  const key = dataKey || chunkDataKey(translationId, ownerId, chunkId);
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: RAW_BUCKET, Key: key }));
    const text = await res.Body.transformToString();
    if (!text) {return {};}
    return JSON.parse(text);
  } catch (err) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      return {};
    }
    console.warn('failed to read chunk data', { translationId, ownerId, chunkId, error: err?.message || err });
    return {};
  }
}

async function deleteChunkData({ translationId, ownerId, chunkId, dataKey }) {
  if (!RAW_BUCKET) {
    throw new Error('RAW_BUCKET environment variable is not configured');
  }
  if (!chunkId) {
    throw new Error('chunkId is required for deleteChunkData');
  }
  if (!translationId) {
    throw new Error('translationId is required for deleteChunkData');
  }
  if (!ownerId) {
    throw new Error('ownerId is required for deleteChunkData');
  }
  const key = dataKey || chunkDataKey(translationId, ownerId, chunkId);
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: RAW_BUCKET, Key: key }));
  } catch (err) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {return;}
    console.warn('failed to delete chunk data', { translationId, ownerId, chunkId, error: err?.message || err });
  }
}

async function queryChunkItems(translationId, _ownerId) {
  if (!DOCS_TABLE) {return [];}
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

async function getChunk(translationId, ownerId, chunkOrder) {
  if (!DOCS_TABLE) {
    throw new Error('DOCS_TABLE environment variable is not configured');
  }
  if (!translationId) {
    throw new Error('translationId is required for getChunk');
  }
  if (!ownerId) {
    throw new Error('ownerId is required for getChunk');
  }
  if (typeof chunkOrder === 'undefined' || chunkOrder === null) {
    throw new Error('chunkOrder is required for getChunk');
  }
  const params = {
    TableName: DOCS_TABLE,
    Key: marshall({
      PK: `TRANSLATION#${translationId}`,
      SK: chunkSortKey(chunkOrder)
    })
  };
  const res = await ddb.send(new GetItemCommand(params));
  if (!res.Item) {return null;}
  const item = unmarshall(res.Item);
  if (!RAW_BUCKET) {return item;}

  const hasInlineData = ['sourceHtml', 'machineHtml', 'reviewerHtml'].some(field =>
    Object.prototype.hasOwnProperty.call(item, field)
  );
  if (hasInlineData) {return item;}

  if (!item.chunkId) {return item;}

  const data = await getChunkData({
    translationId,
    ownerId,
    chunkId: item.chunkId,
    dataKey: item.dataKey
  });
  return {
    ...item,
    ...data
  };
}

async function listChunks(translationId, ownerId) {
  const items = await queryChunkItems(translationId, ownerId);
  if (!items.length) {return [];}
  const results = await Promise.all(items.map(async item => {
    if (!RAW_BUCKET) {
      return item;
    }
    const hasInlineData = ['sourceHtml', 'machineHtml', 'reviewerHtml'].some(field => Object.prototype.hasOwnProperty.call(item, field));
    if (hasInlineData) {
      return item;
    }
    const data = await getChunkData({
      translationId,
      ownerId,
      chunkId: item.chunkId,
      dataKey: item.dataKey
    });
    return {
      ...item,
      ...data
    };
  }));
  return results;
}

async function ensureChunkSource({ translationId, ownerId = 'default', chunk }) {
  if (!DOCS_TABLE || !chunk) {return;}
  const chunkId = chunk.id || chunk.chunkId;
  if (!chunkId) {
    throw new Error('Chunk is missing chunkId');
  }
  const key = chunkPrimaryKey(translationId, ownerId, chunk.order);
  const dataKey = chunkDataKey(translationId, ownerId, chunkId);
  const existingData = RAW_BUCKET
    ? await getChunkData({ translationId, ownerId, chunkId, dataKey })
    : {};
  const nextData = {
    ...existingData,
    chunkId,
    sourceHtml: chunk.sourceHtml || existingData?.sourceHtml || '',
    sourceText: chunk.sourceText || existingData?.sourceText || '',
    machineHtml: existingData.machineHtml || null,
    reviewerHtml: existingData.reviewerHtml || null
  };
  if (RAW_BUCKET) {
    await putChunkData({ translationId, ownerId, chunkId, dataKey, data: nextData });
  }

  const names = {
    '#updatedAt': 'updatedAt',
    '#chunkId': 'chunkId',
    '#order': 'order',
    '#status': 'status',
    '#createdAt': 'createdAt',
    '#blockId': 'blockId',
    '#assetAnchors': 'assetAnchors',
    '#dataKey': 'dataKey',
    '#sourceHtml': 'sourceHtml',
    '#sourceText': 'sourceText',
    '#machineHtml': 'machineHtml',
    '#reviewerHtml': 'reviewerHtml'
  };
  const values = marshall({
    ':updatedAt': now(),
    ':chunkId': chunkId,
    ':order': chunk.order,
    ':status': 'PENDING',
    ':createdAt': now(),
    ':blockId': chunk.blockId || chunkId,
    ':assetAnchors': chunk.anchorIds || [],
    ':dataKey': dataKey
  });
  const updateExpression = 'SET #updatedAt = :updatedAt, #chunkId = :chunkId, #order = :order, #blockId = :blockId, #assetAnchors = :assetAnchors, #status = if_not_exists(#status, :status), #createdAt = if_not_exists(#createdAt, :createdAt), #dataKey = :dataKey';
  const removeExpression = 'REMOVE #sourceHtml, #sourceText, #machineHtml, #reviewerHtml';
  let expression = updateExpression;
  if (RAW_BUCKET) {
    expression = `${updateExpression} ${removeExpression}`;
  }
  const res = await ddb.send(new UpdateItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall(key),
    UpdateExpression: expression,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW'
  }));
  const attributes = res.Attributes ? unmarshall(res.Attributes) : undefined;
  if (!attributes) {return undefined;}
  if (!RAW_BUCKET) {return attributes;}
  return {
    ...attributes,
    ...nextData,
    dataKey
  };
}

async function updateChunkState({ translationId, ownerId = 'default', chunkOrder, chunkId, patch }) {
  if (!DOCS_TABLE) {
    throw new Error('DOCS_TABLE environment variable is not configured');
  }
  if (!patch || typeof patch !== 'object') {
    throw new Error('patch object is required for updateChunkState');
  }
  if (typeof chunkOrder === 'undefined' || chunkOrder === null) {
    throw new Error('chunkOrder is required for updateChunkState');
  }
  if (!chunkId) {
    throw new Error('chunkId is required for updateChunkState');
  }
  if (!translationId) {
    throw new Error('translationId is required for updateChunkState');
  }
  const key = chunkPrimaryKey(translationId, ownerId, chunkOrder);
  const names = { '#updatedAt': 'updatedAt', '#dataKey': 'dataKey' };
  const sets = ['#updatedAt = :updatedAt', '#dataKey = if_not_exists(#dataKey, :dataKey)'];
  const values = { ':updatedAt': now(), ':dataKey': chunkDataKey(translationId, ownerId, chunkId) };

  const largeFields = new Set(['sourceHtml', 'sourceText', 'machineHtml', 'reviewerHtml']);
  const removeFields = new Set();
  const ddbPatch = {};
  const s3Patch = {};
  for (const [field, value] of Object.entries(patch)) {
    if (RAW_BUCKET && largeFields.has(field)) {
      s3Patch[field] = value;
      removeFields.add(field);
      continue;
    }
    ddbPatch[field] = value;
  }

  for (const [field, value] of Object.entries(ddbPatch)) {
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    sets.push(`#${field} = :${field}`);
  }

  // Add expression attribute names for fields we're removing
  for (const field of removeFields) {
    names[`#${field}`] = field;
  }

  let mergedData = null;
  if (RAW_BUCKET && Object.keys(s3Patch).length) {
    const existing = await getChunkData({ translationId, ownerId, chunkId, dataKey: values[':dataKey'] });
    mergedData = {
      ...existing,
      chunkId,
      ...s3Patch
    };
    await putChunkData({ translationId, ownerId, chunkId, dataKey: values[':dataKey'], data: mergedData });
  }

  let updateExpression = `SET ${sets.join(', ')}`;
  if (RAW_BUCKET && removeFields.size) {
    const removeNames = Array.from(removeFields).map(field => `#${field}`).join(', ');
    updateExpression += ` REMOVE ${removeNames}`;
  }

  const res = await ddb.send(new UpdateItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall(key),
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(values),
    ReturnValues: 'ALL_NEW'
  }));
  const attributes = res.Attributes ? unmarshall(res.Attributes) : undefined;
  if (!attributes) {return undefined;}
  if (!RAW_BUCKET) {return attributes;}
  if (!mergedData) {
    mergedData = await getChunkData({ translationId, ownerId, chunkId, dataKey: attributes.dataKey });
  }
  return {
    ...attributes,
    ...mergedData
  };
}

async function deleteAllChunks(translationId, ownerId = 'default') {
  if (!DOCS_TABLE) {return;}
  const chunks = await queryChunkItems(translationId, ownerId);
  if (!chunks.length) {return;}
  if (RAW_BUCKET) {
    await Promise.all(chunks.map(chunk => deleteChunkData({
      translationId,
      ownerId,
      chunkId: chunk.chunkId,
      dataKey: chunk.dataKey
    })));
  }
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
    if (!ts) {return acc;}
    return !acc || new Date(ts) > new Date(acc) ? ts : acc;
  }, null);
  return { total, completed, failed, latestUpdate };
}

module.exports = {
  listChunks,
  getChunk,
  ensureChunkSource,
  updateChunkState,
  deleteAllChunks,
  summariseChunks,
  chunkSortKey
};
