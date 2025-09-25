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
  try {
    await s3v.send(new CreateIndexCommand({
      vectorBucketName: VECTOR_BUCKET,
      indexName: agentId,
      vectorDimension: VECTOR_DIMENSION,
      vectorType: 'float32'
    }));
    return agentId;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 409 || error?.name === 'ConflictException') {
      return agentId;
    }
    console.warn('Failed to ensure agent vector index:', error?.message || error);
    return agentId;
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
    const body = parse(event);
    const useCase = body.useCase;
    const agentId = crypto.randomUUID().slice(0,8);
    const info = { PK: `AGENT#${agentId}`, SK: 'AGENT', data: { agentId, createdAt: new Date().toISOString() } };
    await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(info) }));
    await ensureAgentVectorIndex(agentId);

    const inferred = useCase ? await inferSettings(useCase) : null;
    const nowIso = new Date().toISOString();
    const baseSearch = {
      queryExpansion: { enabled: false, maxVariants: 3 },
      lexicalBoost: { enabled: true, presenceBoost: 0.12, overlapBoost: 0.05 },
      embeddingModel: 'text-embedding-3-small',
      synonyms: { autoApprove: false },
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
    const settings = { PK: `AGENT#${agentId}`, SK: 'SETTINGS#V1', data: baseSettings };
    await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(settings) }));

    response.body = JSON.stringify({ agentId });
    response.statusCode = 201;
    return callback(null, response);
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

    response.body = JSON.stringify({ ...resObj });
    response.statusCode = 200;
    return callback(null, response);
  }

  // ---- Synonyms draft endpoints ----
  if (method === 'GET' && path.endsWith(`/agents/${agentIdParam}/synonyms/draft`)) {
    const key = { PK: `AGENT#${agentIdParam}`, SK: 'SYNONYMS#DRAFT' };
    const res = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: marshall(key) }));
    const data = res.Item ? unmarshall(res.Item).data : null;
    response.body = JSON.stringify({ draft: data });
    response.statusCode = 200;
    return callback(null, response);
  }

  if (method === 'PUT' && path.endsWith(`/agents/${agentIdParam}/synonyms/draft`)) {
    const body = parse(event);
    const groups = Array.isArray(body?.groups) ? body.groups : [];
    const version = body?.version || `draft-${Date.now()}`;
    const now = new Date().toISOString();
    const item = { PK: `AGENT#${agentIdParam}`, SK: 'SYNONYMS#DRAFT', data: { version, groups, updatedAt: now } };
    await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(item) }));
    response.body = JSON.stringify({ success: true, draft: item.data });
    response.statusCode = 200;
    return callback(null, response);
  }

  if (method === 'POST' && path.endsWith(`/agents/${agentIdParam}/synonyms/publish`)) {
    // Promote current draft to an active version
    const { PutItemCommand, BatchWriteItemCommand } = require('@aws-sdk/client-dynamodb');
    const { GetItemCommand: GetIt } = require('@aws-sdk/client-dynamodb');
    const draftKey = { PK: `AGENT#${agentIdParam}`, SK: 'SYNONYMS#DRAFT' };
    const dres = await ddb.send(new GetIt({ TableName: TABLE, Key: marshall(draftKey) }));
    const draft = dres.Item ? unmarshall(dres.Item).data : null;
    if (!draft || !Array.isArray(draft.groups) || draft.groups.length === 0) {
      response.statusCode = 400;
      response.body = JSON.stringify({ message: 'No draft to publish' });
      return callback(null, response);
    }
    const version = String(Date.now());
    const now = new Date().toISOString();

    // Write groups and variants
    for (let i = 0; i < draft.groups.length; i++) {
      const g = draft.groups[i];
      const groupId = g.groupId || String(i + 1).padStart(4, '0');
      const groupItem = {
        PK: `AGENT#${agentIdParam}`,
        SK: `SYNONYMS#v${version}#GROUP#${groupId}`,
        canonical: g.canonical,
        variants: g.variants || [],
        weight: g.weight || 1,
        updatedAt: now
      };
      await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(groupItem) }));
      for (const v of (g.variants || [])) {
        const norm = String(v || '').toLowerCase().trim().replace(/\s+/g, ' ');
        if (!norm) continue;
        const varItem = {
          PK: `AGENT#${agentIdParam}`,
          SK: `SYNVAR#v${version}#${norm}`,
          canonical: g.canonical,
          groupId,
          weight: g.weight || 1,
          updatedAt: now
        };
        await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(varItem) }));
      }
    }

    // Activate
    const active = { PK: `AGENT#${agentIdParam}`, SK: 'SYNONYMS#ACTIVE', version: String(version), createdAt: now };
    await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(active) }));

    response.body = JSON.stringify({ success: true, version });
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
