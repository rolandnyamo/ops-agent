const { DynamoDBClient, QueryCommand, GetItemCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const ddb = new DynamoDBClient({});
const s3 = new S3Client({});
const TABLE = process.env.DOCS_TABLE;
const BUCKET = process.env.RAW_BUCKET;
const VEC_BUCKET = process.env.VECTOR_BUCKET;
const VEC_MODE = process.env.VECTOR_MODE || 's3';

function ok(status, body) { return { statusCode: status, body: JSON.stringify(body) }; }
function parseBody(event){
  if (!event || !event.body) return {};
  try { return typeof event.body === 'string' ? JSON.parse(event.body) : event.body; }
  catch { return {}; }
}
function now(){ return new Date().toISOString(); }

function makeItem(input){
  const docId = input.docId;
  const status = input.status || 'UPLOADED';
  const category = input.category || 'uncat';
  return {
    PK: `DOC#${docId}`,
    SK: 'DOC',
    SK1: `STATUS#${status}`,
    SK2: `CATEGORY#${category}`,
    docId,
    title: input.title || '',
    description: input.description || '',
    category,
    audience: input.audience || '',
    year: input.year || '',
    version: input.version || '',
    sourceType: input.sourceType || (input.fileKey ? 'upload' : (input.url ? 'url' : 'unknown')),
    fileKey: input.fileKey || '',
    size: input.size || 0,
    createdAt: input.createdAt || now(),
    updatedAt: now(),
    status,
  };
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || 'GET';
  const path = event?.requestContext?.http?.path || '';
  const docId = event?.pathParameters?.docId;

  if (method === 'GET' && path.endsWith('/docs') && !docId) {
    // List docs via GSI: SK = 'DOC'
    const limit = Number(event?.queryStringParameters?.limit || 50);
    const params = {
      TableName: TABLE,
      IndexName: 'Index-01',
      KeyConditionExpression: '#sk = :sk',
      ExpressionAttributeNames: { '#sk': 'SK' },
      ExpressionAttributeValues: marshall({ ':sk': 'DOC' }),
      Limit: limit,
    };
    console.log('Querying docs with params:', JSON.stringify(params));
    const res = await ddb.send(new QueryCommand(params));
    const items = (res.Items || []).map(unmarshall);
    return ok(200, { items, count: items.length, nextToken: res.LastEvaluatedKey ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64') : null });
  }

  if (method === 'GET' && docId) {
    const key = { PK: `DOC#${docId}`, SK: 'DOC' };
    const res = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: marshall(key) }));
    if (!res.Item) return ok(404, { message: 'Not found' });
    return ok(200, unmarshall(res.Item));
  }

  if (method === 'PUT' && docId) {
    const body = parseBody(event);
    const allowed = ['title','description','category','audience','year','version'];
    const expr = [];
    const names = { '#u': 'updatedAt' };
    const values = { ':u': now() };
    for (const k of allowed) {
      if (typeof body[k] !== 'undefined') { expr.push(`#${k} = :${k}`); names[`#${k}`] = k; values[`:${k}`] = body[k]; }
    }
    if (typeof body.category === 'string') { expr.push('#SK2 = :sk2'); names['#SK2'] = 'SK2'; values[':sk2'] = `CATEGORY#${body.category || 'uncat'}`; }
    const UpdateExpression = 'SET ' + ['#u = :u', ...expr].join(', ');
    await ddb.send(new UpdateItemCommand({ TableName: TABLE, Key: marshall({ PK:`DOC#${docId}`, SK:'DOC' }), UpdateExpression, ExpressionAttributeNames: names, ExpressionAttributeValues: marshall(values) }));
    const res = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: marshall({ PK:`DOC#${docId}`, SK:'DOC' }) }));
    return ok(200, unmarshall(res.Item));
  }

  if (method === 'DELETE' && docId) {
    // Delete raw objects under raw/{docId}/ and the item
    if (BUCKET) {
      for (const prefix of [`raw/${docId}/`, `chunks/${docId}/`]){
        const listed = await ddbCatch(() => s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix })));
        if (listed && listed.Contents && listed.Contents.length) {
          const objects = listed.Contents.map(o => ({ Key: o.Key }));
          await ddbCatch(() => s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objects } })));
        }
      }
    }
    if (VEC_MODE === 's3' && VEC_BUCKET) {
      const prefix = `vectors/${docId}`;
      const listed = await ddbCatch(() => s3.send(new ListObjectsV2Command({ Bucket: VEC_BUCKET, Prefix: prefix })));
      if (listed && listed.Contents && listed.Contents.length) {
        const objects = listed.Contents.map(o => ({ Key: o.Key }));
        await ddbCatch(() => s3.send(new DeleteObjectsCommand({ Bucket: VEC_BUCKET, Delete: { Objects: objects } })));
      }
    }
    await ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: marshall({ PK:`DOC#${docId}`, SK:'DOC' }) }));
    return ok(200, { ok: true });
  }

  // POST /docs/ingest (simple create from upload-url/url)
  if (method === 'POST' && path.endsWith('/docs/ingest')) {
    const body = parseBody(event);
    if (!body.docId) return ok(400, { message: 'docId is required (from upload-url response)' });
    const item = makeItem({ ...body, status: 'UPLOADED' });
    await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(item) }));
    return ok(202, item);
  }

  return ok(405, { message: 'Method Not Allowed' });
};

async function ddbCatch(fn){ try { return await fn(); } catch { return null; } }
