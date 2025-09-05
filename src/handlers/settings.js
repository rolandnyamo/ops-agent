const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const ddb = new DynamoDBClient({});

const TABLE = process.env.SETTINGS_TABLE;

function defaults(){
  return {
    agentName: 'Agent',
    confidenceThreshold: 0.45,
    fallbackMessage: 'Sorry, I could not find this in the documentation.',
    organizationType: '',
    categories: [],
    audiences: ['All'],
    notes: '',
    allowedOrigins: [],
    notifyEmails: [],
    updatedAt: new Date().toISOString()
  };
}

function parseBody(event){
  if (!event || !event.body) return {};
  try { return typeof event.body === 'string' ? JSON.parse(event.body) : event.body; }
  catch { return {}; }
}

function validate(input){
  const out = {};
  if (typeof input.agentName === 'string' && input.agentName.trim()) out.agentName = input.agentName.trim();
  if (typeof input.confidenceThreshold === 'number' && input.confidenceThreshold >= 0 && input.confidenceThreshold <= 1) out.confidenceThreshold = input.confidenceThreshold;
  if (typeof input.fallbackMessage === 'string') out.fallbackMessage = input.fallbackMessage;
  if (typeof input.organizationType === 'string') out.organizationType = input.organizationType;
  if (Array.isArray(input.categories)) out.categories = input.categories.filter(x => typeof x === 'string');
  if (Array.isArray(input.audiences)) out.audiences = input.audiences.filter(x => typeof x === 'string');
  if (typeof input.notes === 'string') out.notes = input.notes;
  if (Array.isArray(input.allowedOrigins)) out.allowedOrigins = input.allowedOrigins.filter(x => typeof x === 'string');
  if (Array.isArray(input.notifyEmails)) out.notifyEmails = input.notifyEmails.filter(x => typeof x === 'string');
  return out;
}

exports.handler = async (event) => {
  const method = (event && event.httpMethod) || (event && event.requestContext && event.requestContext.http && event.requestContext.http.method) || 'GET';
  const qs = event?.queryStringParameters || {};
  const b = parseBody(event);
  const agentId = String(qs.agentId || b.agentId || 'default');

  if (method === 'GET') {
    try {
      const res = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: marshall({ PK: `AGENT#${agentId}`, SK: 'SETTINGS#V1' }) }));
      const item = res.Item ? unmarshall(res.Item) : undefined;
      const body = item ? item.data : defaults();
      return { statusCode: 200, body: JSON.stringify(body) };
    } catch (e) {
      console.error('GET /settings error', e);
      return { statusCode: 500, body: JSON.stringify({ message: 'settings fetch failed' }) };
    }
  }

  if (method === 'PUT') {
    const input = b;
    const data = validate(input);
    if (!('agentName' in data)) return { statusCode: 400, body: JSON.stringify({ message: 'agentName is required' }) };
    if (!('confidenceThreshold' in data)) return { statusCode: 400, body: JSON.stringify({ message: 'confidenceThreshold is required (0..1)' }) };

    const now = new Date().toISOString();
    const item = { PK: `AGENT#${agentId}`, SK: 'SETTINGS#V1', data: { ...defaults(), ...data, updatedAt: now } };
    try {
      await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(item) }));
      return { statusCode: 200, body: JSON.stringify(item.data) };
    } catch (e) {
      console.error('PUT /settings error', e);
      return { statusCode: 500, body: JSON.stringify({ message: 'settings update failed' }) };
    }
  }

  return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
};
