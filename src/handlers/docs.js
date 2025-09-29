const { DynamoDBClient, QueryCommand, GetItemCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { S3VectorsClient, DeleteVectorsCommand } = require('@aws-sdk/client-s3vectors');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { response } = require('./helpers/utils');
const { appendJobLog, listJobLogs } = require('./helpers/jobLogs');

const ddb = new DynamoDBClient({});
const s3 = new S3Client({});
const TABLE = process.env.DOCS_TABLE;
const BUCKET = process.env.RAW_BUCKET;
const VEC_BUCKET = process.env.VECTOR_BUCKET;
const VEC_INDEX = process.env.VECTOR_INDEX || 'docs';
const VEC_MODE = process.env.VECTOR_MODE || 's3vectors';
const SETTINGS_TABLE = process.env.SETTINGS_TABLE;

function ok(status, body, callback) {
  response.statusCode = status;
  response.body = JSON.stringify(body);
  return callback(null, response);
}
function parseBody(event){
  if (!event || !event.body) {return {};}
  try { return typeof event.body === 'string' ? JSON.parse(event.body) : event.body; }
  catch { return {}; }
}
function now(){ return new Date().toISOString(); }

function requesterFrom(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims || {};
  return {
    name: claims['name'] || claims['cognito:username'] || null,
    email: claims['email'] || null,
    sub: claims['sub'] || null
  };
}

function actorFrom(user, role = 'user') {
  if (!user) return { type: 'system', role };
  const { email = null, name = null, sub = null } = user;
  if (!email && !name && !sub) {
    return { type: 'system', role };
  }
  return { type: 'user', email, name, sub, role };
}

async function recordLog({ docId, agentId = 'default', category, stage, eventType, status, message, metadata, actor }) {
  try {
    await appendJobLog({
      jobType: 'documentation',
      jobId: docId,
      ownerId: agentId || 'default',
      category,
      stage,
      eventType,
      status,
      message,
      metadata,
      actor
    });
  } catch (err) {
    console.warn('docs handler log append failed', err?.message || err);
  }
}

async function getAgentVectorIndex(agentId){
  if (!SETTINGS_TABLE || !agentId) return agentId || VEC_INDEX;
  try {
    const res = await ddb.send(new GetItemCommand({
      TableName: SETTINGS_TABLE,
      Key: marshall({ PK:`AGENT#${agentId}`, SK:'SETTINGS#V1' })
    }));
    if (res.Item) {
      const item = unmarshall(res.Item);
      const data = item.data || item;
      const configured = data?.search?.vectorIndex;
      if (configured) {return configured;}
    }
  } catch (error) {
    console.warn('getAgentVectorIndex (docs) failed:', error?.message || error);
  }
  return agentId || VEC_INDEX;
}

function makeItem(input){
  const docId = input.docId;
  const status = input.status || 'UPLOADED';
  const category = input.category || 'uncat';
  const agentId = input.agentId || 'default';
  return {
    PK: `DOC#${docId}`,
    SK: `DOC#${agentId}`,
    SK1: `STATUS#${status}`,
    SK2: `CATEGORY#${category}`,
    docId,
    agentId,
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
    submittedByEmail: input.submittedByEmail || null,
    submittedByName: input.submittedByName || null
  };
}

exports.handler = async (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false;

  const method = event?.requestContext?.http?.method || event?.httpMethod || 'GET';
  const path = event?.requestContext?.http?.path || event?.requestContext?.path || '';
  const docId = event?.pathParameters?.docId;
  const requester = requesterFrom(event);

  if (method === 'GET' && path.endsWith('/docs') && !docId) {
    const agentId = event?.queryStringParameters?.agentId || 'default';
    const limit = Number(event?.queryStringParameters?.limit || 50);
    const params = {
      TableName: TABLE,
      IndexName: 'Index-01',
      KeyConditionExpression: '#sk = :sk',
      ExpressionAttributeNames: { '#sk': 'SK' },
      ExpressionAttributeValues: marshall({ ':sk': `DOC#${agentId}` }),
      Limit: limit
    };
    console.log('Querying docs with params:', JSON.stringify(params));
    const res = await ddb.send(new QueryCommand(params));
    const items = (res.Items || []).map(unmarshall);
    return ok(200, { items, count: items.length, nextToken: res.LastEvaluatedKey ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64') : null }, callback);
  }

  if (method === 'GET' && path.endsWith('/logs') && docId) {
    const agentId = event?.queryStringParameters?.agentId || 'default';
    const limit = Number(event?.queryStringParameters?.limit || 50);
    const nextToken = event?.queryStringParameters?.nextToken || null;
    try {
      const logs = await listJobLogs({ jobType: 'documentation', jobId: docId, limit, nextToken });
      return ok(200, logs, callback);
    } catch (err) {
      console.warn('docs logs retrieval failed', err?.message || err);
      return ok(500, { message: 'Failed to fetch logs' }, callback);
    }
  }

  if (method === 'GET' && docId) {
    const agentId = event?.queryStringParameters?.agentId || 'default';
    const key = { PK: `DOC#${docId}`, SK: `DOC#${agentId}` };
    const res = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: marshall(key) }));
    if (!res.Item) {return ok(404, { message: 'Not found' }, callback);}
    return ok(200, unmarshall(res.Item), callback);
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
    const agentId = event?.queryStringParameters?.agentId || 'default';
    const UpdateExpression = 'SET ' + ['#u = :u', ...expr].join(', ');
    await ddb.send(new UpdateItemCommand({ TableName: TABLE, Key: marshall({ PK:`DOC#${docId}`, SK:`DOC#${agentId}` }), UpdateExpression, ExpressionAttributeNames: names, ExpressionAttributeValues: marshall(values) }));
    const res = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: marshall({ PK:`DOC#${docId}`, SK:`DOC#${agentId}` }) }));
    const updated = unmarshall(res.Item);
    await recordLog({
      docId,
      agentId,
      category: 'processing',
      stage: 'metadata-update',
      eventType: 'doc-updated',
      status: updated.status || 'UPDATED',
      message: 'Documentation metadata updated',
      metadata: body,
      actor: actorFrom(requester, 'editor')
    });
    return ok(200, updated, callback);
  }

  if (method === 'DELETE' && docId) {
    const agentId = event?.queryStringParameters?.agentId || 'default';
    // Mark DELETING (best-effort)
    try {
      await ddb.send(new UpdateItemCommand({
        TableName: TABLE,
        Key: marshall({ PK:`DOC#${docId}`, SK:`DOC#${agentId}` }),
        UpdateExpression: 'SET #s = :s, #u = :u',
        ExpressionAttributeNames: { '#s':'status', '#u':'updatedAt' },
        ExpressionAttributeValues: marshall({ ':s':'DELETING', ':u': new Date().toISOString() })
      }));
    } catch {}
    // Delete raw objects under raw/{docId}/ and chunks/{docId}/
    if (BUCKET) {
      for (const prefix of [`raw/${agentId}/${docId}/`, `chunks/${agentId}/${docId}/`]){
        const listed = await ddbCatch(() => s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix })));
        if (listed && listed.Contents && listed.Contents.length) {
          const objects = listed.Contents.map(o => ({ Key: o.Key }));
          await ddbCatch(() => s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objects } })));
        }
      }
    }
    if (VEC_MODE === 's3' && VEC_BUCKET) {
      const prefix = `vectors/${agentId}/${docId}`;
      const listed = await ddbCatch(() => s3.send(new ListObjectsV2Command({ Bucket: VEC_BUCKET, Prefix: prefix })));
      if (listed && listed.Contents && listed.Contents.length) {
        const objects = listed.Contents.map(o => ({ Key: o.Key }));
        await ddbCatch(() => s3.send(new DeleteObjectsCommand({ Bucket: VEC_BUCKET, Delete: { Objects: objects } })));
      }
    }
    if (VEC_MODE === 's3vectors' && VEC_BUCKET) {
      const cli = new S3VectorsClient({});
      try {
        const indexName = await getAgentVectorIndex(agentId);
        const safeDoc = String(docId).replace(/"/g, '\\"');
        const safeAgent = String(agentId).replace(/"/g, '\\"');
        await cli.send(new DeleteVectorsCommand({
          vectorBucketName: VEC_BUCKET,
          indexName,
          filter: `docId = \"${safeDoc}\" AND agentId = \"${safeAgent}\"`
        }));
      } catch (e) { console.log('DeleteVectors error (ignored):', e?.message || e); }
    }
    await ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: marshall({ PK:`DOC#${docId}`, SK:`DOC#${agentId}` }) }));
    await recordLog({
      docId,
      agentId,
      category: 'publication',
      stage: 'cleanup',
      eventType: 'doc-deleted',
      status: 'DELETED',
      message: 'Documentation source deleted',
      metadata: { agentId },
      actor: actorFrom(requester, 'admin')
    });
    return ok(200, { ok: true }, callback);
  }

  // POST /docs/ingest (simple create from upload-url/url)
  if (method === 'POST' && path.endsWith('/docs/ingest')) {
    const body = parseBody(event);
    if (!body.docId) {return ok(400, { message: 'docId is required (from upload-url response)' }, callback);}
    const item = makeItem({ ...body, status: 'UPLOADED', submittedByEmail: requester?.email || null, submittedByName: requester?.name || null });
    await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(item) }));
    await recordLog({
      docId: item.docId,
      agentId: item.agentId,
      category: 'submission',
      stage: 'intake',
      eventType: 'doc-submitted',
      status: item.status,
      message: 'Documentation ingestion request submitted',
      metadata: {
        title: item.title,
        sourceType: item.sourceType,
        fileKey: item.fileKey
      },
      actor: actorFrom(requester, 'submitter')
    });
    return ok(202, item, callback);
  }

  return ok(405, { message: 'Method Not Allowed' }, callback);
};

async function ddbCatch(fn){ try { return await fn(); } catch { return null; } }
