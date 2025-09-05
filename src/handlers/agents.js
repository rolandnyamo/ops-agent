const { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const crypto = require('node:crypto');
const { z } = require('zod');
const { generateJSON } = require('./helpers/openai');

const ddb = new DynamoDBClient({});
const TABLE = process.env.SETTINGS_TABLE;

const SettingsEvent = z.object({
  agentName: z.string().default('My Agent'),
  confidenceThreshold: z.number().min(0.3).max(0.7).default(0.45),
  fallbackMessage: z.string().default('Sorry, I could not find this in the documentation.'),
  organizationType: z.string().default(''),
  categories: z.array(z.string()).default([]),
  audiences: z.array(z.string()).default(['All']),
  notes: z.string().default(''),
});

function ok(status, body){ return { statusCode: status, body: JSON.stringify(body) }; }
function parse(event){ try { return event?.body ? (typeof event.body==='string'?JSON.parse(event.body):event.body) : {}; } catch { return {}; } }

async function inferSettings(useCase){
  if (!useCase) return null;
  
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

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || 'GET';
  const path = event?.requestContext?.http?.path || '';
  const agentIdParam = event?.pathParameters?.agentId;

  if (method === 'POST' && path.endsWith('/agents')){
    const body = parse(event);
    const useCase = body.useCase;
    const agentId = crypto.randomUUID().slice(0,8);
    const info = { PK: `AGENT#${agentId}`, SK: 'AGENT', data: { agentId, createdAt: new Date().toISOString() } };
    await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(info) }));
    if (useCase){
      const inf = await inferSettings(useCase);
      if (inf){
        const settings = { PK: `AGENT#${agentId}`, SK: 'SETTINGS#V1', data: { agentName: inf.agentName || 'Agent', confidenceThreshold: inf.confidenceThreshold ?? 0.45, fallbackMessage: inf.fallbackMessage || 'Sorry, I could not find this in the documentation.', organizationType: inf.organizationType || '', categories: inf.categories || [], audiences: inf.audiences || ['All'], notes: inf.notes || '', allowedOrigins: [], notifyEmails: [], updatedAt: new Date().toISOString() } };
        await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(settings) }));
      }
    }
    return ok(201, { agentId });
  }

  if (method === 'GET' && path.endsWith('/agents')){
    const res = await ddb.send(new QueryCommand({ TableName: TABLE, IndexName: 'Index-01', KeyConditionExpression: '#sk = :sk', ExpressionAttributeNames: { '#sk':'SK' }, ExpressionAttributeValues: marshall({ ':sk':'AGENT' }) }));
    const items = (res.Items||[]).map(unmarshall).map(x => ({ agentId: x.data?.agentId }));
    return ok(200, { items });
  }

  if (method === 'GET' && agentIdParam){
    const key = { PK: `AGENT#${agentIdParam}`, SK: 'SETTINGS#V1' };
    const res = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: marshall(key) }));
    return ok(200, res.Item ? unmarshall(res.Item).data : {});
  }

  return ok(405, { message: 'Method Not Allowed' });
};
