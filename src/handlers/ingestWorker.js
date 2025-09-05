const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { S3VectorsClient, PutVectorsCommand } = require('@aws-sdk/client-s3vectors');
const { DynamoDBClient, UpdateItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const s3 = new S3Client({});
const ddb = new DynamoDBClient({});
const RAW_BUCKET = process.env.RAW_BUCKET;
const VEC_BUCKET = process.env.VECTOR_BUCKET || 'ops-embeddings';
const VEC_MODE = process.env.VECTOR_MODE || 's3vectors';
const VEC_INDEX = process.env.VECTOR_INDEX || 'docs';
const TABLE = process.env.DOCS_TABLE;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function decodeKey(key){ return decodeURIComponent(key.replace(/\+/g,'%20')); }
function textFromHtml(html){ return String(html).replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function chunkText(text, maxChars=3500, overlap=300){
  const t = String(text||'');
  const chunks = [];
  for (let i=0; i<t.length; i += (maxChars - overlap)) chunks.push(t.slice(i, i+maxChars));
  return chunks;
}
async function readObject(bucket, key){
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await res.Body.transformToString('utf8');
  const contentType = res.ContentType || 'application/octet-stream';
  return { body, contentType };
}
async function setStatus(docId, status, extra={}){
  const names = { '#u':'updatedAt', '#s':'status' };
  const values = { ':u': new Date().toISOString(), ':s': status };
  for (const [k,v] of Object.entries(extra)) { names[`#${k}`] = k; values[`:${k}`] = v; }
  await ddb.send(new UpdateItemCommand({ TableName: TABLE, Key: marshall({ PK:`DOC#${docId}`, SK:'DOC' }), UpdateExpression: 'SET #u = :u, #s = :s' + Object.keys(extra).map(k=>`, #${k} = :${k}`).join(''), ExpressionAttributeNames: names, ExpressionAttributeValues: marshall(values) }));
}

async function embedChunks(chunks){
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const model = 'text-embedding-3-small';
  const out = [];
  for (const text of chunks){
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ input: text, model })
    });
    if (!resp.ok) throw new Error(`OpenAI ${resp.status}`);
    const json = await resp.json();
    const vec = json.data?.[0]?.embedding;
    out.push(vec);
  }
  return out;
}

async function storeVectorsS3(docId, vectors, chunks){
  if (!VEC_BUCKET) return;
  const lines = vectors.map((v, i) => JSON.stringify({ docId, chunkIdx: i, vector: v, text: chunks[i] }));
  const key = `vectors/${docId}.jsonl`;
  await s3.send(new PutObjectCommand({ Bucket: VEC_BUCKET, Key: key, Body: lines.join('\n'), ContentType: 'application/x-ndjson' }));
}

async function storeVectorsS3Vectors(docId, vectors, chunks){
  if (!VEC_BUCKET) throw new Error('VECTOR_BUCKET not set');
  if (!VEC_INDEX) throw new Error('VECTOR_INDEX not set');
  const client = new S3VectorsClient({});
  const items = vectors.map((vector, i) => ({
    vector,
    metadata: {
      docId,
      chunkIdx: i,
    }
  }));
  await client.send(new PutVectorsCommand({ 
    vectorBucketName: VEC_BUCKET, 
    indexName: VEC_INDEX,
    indexArn: 'arn:aws:s3vectors:us-east-1:326445141506:bucket/ops-embeddings/index/docs',
    vectors: items 
  }));
}

exports.handler = async (event) => {
  // EventBridge S3 ObjectCreated event
  try {
    const detail = event?.detail || {};
    const bucket = detail?.bucket?.name || RAW_BUCKET;
    const key = decodeKey(detail?.object?.key || '');
    if (!key.startsWith('raw/')) return { statusCode: 200 };
    const docId = key.split('/')[1];

    await setStatus(docId, 'PROCESSING');

    const { body, contentType } = await readObject(bucket, key);
    let text;
    if ((contentType || '').includes('text/html') || key.endsWith('.html') || key.endsWith('.htm')) {
      text = textFromHtml(body);
    } else if ((contentType || '').startsWith('text/') || key.endsWith('.txt') || key.endsWith('.md')) {
      text = body;
    } else {
      await setStatus(docId, 'FAILED', { error: 'Unsupported content type for v1' });
      return { statusCode: 200 };
    }

    const chunks = chunkText(text);
    const chunkLines = chunks.map((t, i) => JSON.stringify({ idx: i, text: t }));
    await s3.send(new PutObjectCommand({ Bucket: RAW_BUCKET, Key: `chunks/${docId}/chunks.jsonl`, Body: chunkLines.join('\n'), ContentType: 'application/x-ndjson' }));

    const vectors = await embedChunks(chunks);

    if (VEC_MODE === 's3vectors') {
      await storeVectorsS3Vectors(docId, vectors, chunks);
    } else if (VEC_MODE === 's3') {
      await storeVectorsS3(docId, vectors, chunks);
    } else {
      console.log('Unknown VECTOR_MODE:', VEC_MODE);
    }

    await setStatus(docId, 'READY', { numChunks: chunks.length });
    return { statusCode: 200 };
  } catch (e) {
    console.error('ingestWorker error', e);
    try {
      const key = (event?.detail?.object?.key)||''; const docId = key.split('/')[1]; if (docId) await setStatus(docId, 'FAILED', { error: String(e.message||e) });
    } catch {}
    return { statusCode: 500 };
  }
};
