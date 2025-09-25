const { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { S3VectorsClient, CreateIndexCommand, DeleteIndexCommand } = require('@aws-sdk/client-s3vectors');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const crypto = require('node:crypto');
const { z } = require('zod');
const { generateJSON } = require('./helpers/openai');
const { response } = require('./helpers/utils');

const ddb = new DynamoDBClient({});
const s3v = new S3VectorsClient({});
const TABLE = process.env.SETTINGS_TABLE;
const VECTOR_BUCKET = process.env.VECTOR_BUCKET;
const VECTOR_DIMENSION = Number(process.env.VECTOR_DIMENSION || 1536);

const SettingsEvent = z.object({
  agentName: z.string().default('My Agent'),
  confidenceThreshold: z.number().min(0.3).max(0.7).default(0.45),
  fallbackMessage: z.string().default('Sorry, I could not find this in the documentation.'),
  organizationType: z.string().default(''),
  categories: z.array(z.string()).default([]),
  audiences: z.array(z.string()).default(['All']),
  notes: z.string().default('')
});

function parse(event){ try { return event?.body ? (typeof event.body==='string'?JSON.parse(event.body):event.body) : {}; } catch { return {}; } }

async function ensureAgentVectorIndex(agentId) {
  if (!VECTOR_BUCKET || !agentId) return null;
  const dimension = Number.isFinite(VECTOR_DIMENSION) && VECTOR_DIMENSION > 0 ? VECTOR_DIMENSION : 1536;
  try {
    await s3v.send(new CreateIndexCommand({
      vectorBucketName: VECTOR_BUCKET,
      indexName: agentId,
      dimension,
      dataType: 'float32',
      distanceMetric: 'cosine'
    }));
    return agentId;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 409 || error?.name === 'ConflictException') {
      return agentId;
    }
    console.error('Failed to ensure agent vector index:', error?.message || error);
    throw error;
  }
}

async function deleteAgentVectorIndex(agentId) {
  if (!VECTOR_BUCKET || !agentId) return;
  try {
    await s3v.send(new DeleteIndexCommand({ vectorBucketName: VECTOR_BUCKET, indexName: agentId }));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status && status !== 404) {
      console.warn('Failed to delete agent vector index:', error?.message || error);
    }
  }
}

async function inferSettings(useCase){
  if (!useCase) {return null;}

  const input = [
    { role: 'system', content: 'You are an AI assistant that extracts agent settings from use case descriptions. Return only valid JSON matching the required schema.' },
    {
      role: 'user',
      content: `Given this use case, propose JSON with: agentName, confidenceThreshold (0.3..0.7), fallbackMessage (neutral), organizationType, categories (4-7), audiences, notes.\n\nUSE_CASE:\n${String(useCase).slice(0,4000)}`
    }
  ];

  try {
    const result = await generateJSON({
      model: 'gpt-4o-mini',
      input,
      schema: SettingsEvent,
      schemaName: 'settings'
    });

    return result.success ? result.parsed : null;
  } catch (error) {
    console.error('Error inferring settings:', error);
    return null;
  }
}

exports.handler = async (event, context, callback) => {

  context.callbackWaitsForEmptyEventLoop = false;

  console.log('Event:', JSON.stringify(event));

  const method = event?.requestContext?.http?.method || event?.httpMethod || 'GET';
  const path = event?.requestContext?.http?.path || event?.requestContext?.path || '';
  const agentIdParam = event?.pathParameters?.agentId;

  if (method === 'POST' && path.endsWith('/agents')){
    try {
      const body = parse(event);
      const useCase = body.useCase;
      const agentId = crypto.randomUUID().slice(0,8);
      await ensureAgentVectorIndex(agentId);

      const info = { PK: `AGENT#${agentId}`, SK: 'AGENT', data: { agentId, createdAt: new Date().toISOString() } };
      await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(info) }));

      const inferred = useCase ? await inferSettings(useCase) : null;
      const nowIso = new Date().toISOString();
      const baseSearch = {
        queryExpansion: { enabled: true, maxVariants: 3 },
        lexicalBoost: { enabled: true, presenceBoost: 0.12, overlapBoost: 0.05 },
        embeddingModel: 'text-embedding-3-small',
        vectorIndex: agentId
      };
      const baseSettings = {
        agentName: inferred?.agentName || 'Agent',
        confidenceThreshold: inferred?.confidenceThreshold ?? 0.45,
        fallbackMessage: inferred?.fallbackMessage || 'Sorry, I could not find this in the documentation.',
        organizationType: inferred?.organizationType || '',
        categories: inferred?.categories || [],
        audiences: inferred?.audiences || ['All'],
        notes: inferred?.notes || '',
        allowedOrigins: [],
        notifyEmails: [],
        search: { ...baseSearch, ...(inferred?.search || {}) },
        updatedAt: nowIso
      };
      if (!baseSettings.search.vectorIndex) {
        baseSettings.search.vectorIndex = agentId;
      }
      if (baseSettings.search.queryExpansion) {
        baseSettings.search.queryExpansion.enabled = true;
        if (typeof baseSettings.search.queryExpansion.maxVariants !== 'number') {
          baseSettings.search.queryExpansion.maxVariants = 3;
        }
      }
      const settings = { PK: `AGENT#${agentId}`, SK: 'SETTINGS#V1', data: baseSettings };
      await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(settings) }));

      response.body = JSON.stringify({ agentId });
      response.statusCode = 201;
      return callback(null, response);
    } catch (error) {
      console.error('Create agent error:', error);
      response.statusCode = 500;
      response.body = JSON.stringify({ message: 'Failed to create agent', error: error?.message || 'create_failed' });
      return callback(null, response);
    }
  }

  if (method === 'GET' && path.endsWith('/agents')){
    const res = await ddb.send(new QueryCommand({ TableName: TABLE, IndexName: 'Index-01', KeyConditionExpression: '#sk = :sk', ExpressionAttributeNames: { '#sk':'SK' }, ExpressionAttributeValues: marshall({ ':sk':'AGENT' }) }));
    const items = (res.Items||[]).map(unmarshall).map(x => ({ agentId: x.data?.agentId }));

    response.body = JSON.stringify({ items });
    response.statusCode = 200;
    return callback(null, response);
  }

  if (method === 'GET' && agentIdParam){
    const key = { PK: `AGENT#${agentIdParam}`, SK: 'SETTINGS#V1' };
    const res = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: marshall(key) }));
    const raw = res.Item ? unmarshall(res.Item).data : null;
    const resObj = raw || {};
    if (resObj.search && !resObj.search.vectorIndex) {
      resObj.search.vectorIndex = agentIdParam;
    }
    if (resObj.search) {
      if (!resObj.search.queryExpansion) {
        resObj.search.queryExpansion = { enabled: true, maxVariants: 3 };
      } else {
        resObj.search.queryExpansion.enabled = true;
        if (typeof resObj.search.queryExpansion.maxVariants !== 'number') {
          resObj.search.queryExpansion.maxVariants = 3;
        }
      }
    }

    response.body = JSON.stringify({ ...resObj });
    response.statusCode = 200;
    return callback(null, response);
  }

  if (method === 'DELETE' && agentIdParam) {
    try {
      await deleteAgentVectorIndex(agentIdParam);
      // Delete agent settings
      await ddb.send(new DeleteItemCommand({
        TableName: TABLE,
        Key: marshall({ PK: `AGENT#${agentIdParam}`, SK: 'SETTINGS#V1' })
      }));

      // Delete agent entry
      await ddb.send(new DeleteItemCommand({
        TableName: TABLE,
        Key: marshall({ PK: `AGENT#${agentIdParam}`, SK: 'AGENT' })
      }));

      response.body = JSON.stringify({ success: true, agentId: agentIdParam });
      response.statusCode = 200;
      return callback(null, response);
    } catch (error) {
      console.error('Error deleting agent:', error);
      response.statusCode = 500;
      response.body = JSON.stringify({ message: 'Failed to delete agent' });
      return callback(null, response);
    }
  }
  response.statusCode = 405;
  response.body = JSON.stringify({ message: 'Method not allowed' });
  return callback(null, response);
};
