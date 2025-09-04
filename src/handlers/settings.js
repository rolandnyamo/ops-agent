const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const ddb = new DynamoDBClient({});

const TABLE = process.env.SETTINGS_TABLE;
const PK = 'SETTINGS#GLOBAL';
const SK = 'V1';

function defaults(){
  return {
    agentName: 'Agent',
    confidenceThreshold: 0.45,
    fallbackMessage: 'Sorry, I could not find this in the documentation.',
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
  if (Array.isArray(input.allowedOrigins)) out.allowedOrigins = input.allowedOrigins.filter(x => typeof x === 'string');
  if (Array.isArray(input.notifyEmails)) out.notifyEmails = input.notifyEmails.filter(x => typeof x === 'string');
  return out;
}

exports.handler = async (event) => {
  const method = (event && event.httpMethod) || (event && event.requestContext && event.requestContext.http && event.requestContext.http.method) || 'GET';

  if (method === 'GET') {
    try {
      const res = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: marshall({ PK, SK }) }));
      const item = res.Item ? unmarshall(res.Item) : undefined;
      const body = item ? item.data : defaults();
      return { statusCode: 200, body: JSON.stringify(body) };
    } catch (e) {
      console.error('GET /settings error', e);
      return { statusCode: 500, body: JSON.stringify({ message: 'settings fetch failed' }) };
    }
  }

  if (method === 'PUT') {
    const input = parseBody(event);
    const data = validate(input);
    if (!('agentName' in data)) return { statusCode: 400, body: JSON.stringify({ message: 'agentName is required' }) };
    if (!('confidenceThreshold' in data)) return { statusCode: 400, body: JSON.stringify({ message: 'confidenceThreshold is required (0..1)' }) };

    const now = new Date().toISOString();
    const item = { PK, SK, data: { ...defaults(), ...data, updatedAt: now } };
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
