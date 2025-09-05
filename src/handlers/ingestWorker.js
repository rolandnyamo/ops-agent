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
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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
  const contentType = res.ContentType || 'application/octet-stream';
  const buffer = Buffer.from(await res.Body.transformToByteArray());
  return { buffer, contentType };
}
async function setStatus(docId, agentId, status, extra={}){
  const names = { '#u':'updatedAt', '#s':'status' };
  const values = { ':u': new Date().toISOString(), ':s': status };
  for (const [k,v] of Object.entries(extra)) { names[`#${k}`] = k; values[`:${k}`] = v; }
  await ddb.send(new UpdateItemCommand({ TableName: TABLE, Key: marshall({ PK:`DOC#${docId}`, SK:`DOC#${agentId||'default'}` }), UpdateExpression: 'SET #u = :u, #s = :s' + Object.keys(extra).map(k=>`, #${k} = :${k}`).join(''), ExpressionAttributeNames: names, ExpressionAttributeValues: marshall(values) }));
}

async function embedChunks(chunks){
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const model = 'text-embedding-3-small';
  // Batch for efficiency
  const resp = await openai.embeddings.create({ model, input: chunks });
  return (resp?.data || []).map(d => d.embedding);
}

async function storeVectorsS3(docId, vectors, chunks, docMeta){
  if (!VEC_BUCKET) return;
  const meta = docMeta ? { docId, agentId: docMeta.agentId || 'default', title: docMeta.title, category: docMeta.category, audience: docMeta.audience, year: docMeta.year, version: docMeta.version } : { docId, agentId: 'default' };
  const lines = vectors.map((v, i) => JSON.stringify({ ...meta, chunkIdx: i, vector: v, text: chunks[i] }));
  const key = `vectors/${meta.agentId}/${docId}.jsonl`;
  await s3.send(new PutObjectCommand({ Bucket: VEC_BUCKET, Key: key, Body: lines.join('\n'), ContentType: 'application/x-ndjson' }));
}

async function storeVectorsS3Vectors(docId, vectors, chunks, docMeta){
  if (!VEC_BUCKET) throw new Error('VECTOR_BUCKET not set');
  if (!VEC_INDEX) throw new Error('VECTOR_INDEX not set');
  const client = new S3VectorsClient({});
  const items = vectors.map((vector, i) => ({
    vector,
    metadata: {
      docId,
      agentId: docMeta?.agentId || 'default',
      title: docMeta?.title,
      category: docMeta?.category,
      audience: docMeta?.audience,
      year: docMeta?.year,
      version: docMeta?.version,
      chunkIdx: i,
    },
    text: chunks[i]
  }));
  await client.send(new PutVectorsCommand({ bucket: VEC_BUCKET, index: VEC_INDEX, vectors: items }));
}

exports.handler = async (event) => {
  // EventBridge S3 ObjectCreated event
  try {
    const detail = event?.detail || {};
    const bucket = detail?.bucket?.name || RAW_BUCKET;
    const key = decodeKey(detail?.object?.key || '');
    if (!key.startsWith('raw/')) return { statusCode: 200 };
    const parts = key.split('/');
    const hasAgent = parts.length > 3;
    const agentId = hasAgent ? parts[1] : 'default';
    const docId = hasAgent ? parts[2] : parts[1];

    await setStatus(docId, agentId, 'PROCESSING');

    const { buffer, contentType } = await readObject(bucket, key);
    let text;
    if ((contentType || '').includes('text/html') || key.endsWith('.html') || key.endsWith('.htm')) {
      text = textFromHtml(buffer.toString('utf8'));
    } else if ((contentType || '').startsWith('text/') || key.endsWith('.txt') || key.endsWith('.md')) {
      text = buffer.toString('utf8');
    } else if (key.endsWith('.pdf') || (contentType||'').includes('application/pdf')){
      const pdfParse = require('pdf-parse');
      const res = await pdfParse(buffer);
      text = String(res.text || '').trim();
    } else if (key.endsWith('.docx') || (contentType||'').includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')){
      const mammoth = require('mammoth');
      const { value } = await mammoth.extractRawText({ buffer });
      text = String(value||'').trim();
    } else {
      await setStatus(docId, agentId, 'FAILED', { error: `Unsupported content type: ${contentType}` });
      return { statusCode: 200 };
    }

    const chunks = chunkText(text);
    const chunkLines = chunks.map((t, i) => JSON.stringify({ idx: i, text: t }));
    await s3.send(new PutObjectCommand({ Bucket: RAW_BUCKET, Key: `chunks/${agentId}/${docId}/chunks.jsonl`, Body: chunkLines.join('\n'), ContentType: 'application/x-ndjson' }));

    const vectors = await embedChunks(chunks);
    // Fetch doc metadata for vector metadata
    let docMeta = null;
    try {
      const dres = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: marshall({ PK:`DOC#${docId}`, SK:`DOC#${agentId}` }) }));
      docMeta = dres.Item ? unmarshall(dres.Item) : null;
    } catch {}

    if (VEC_MODE === 's3vectors') {
      await storeVectorsS3Vectors(docId, vectors, chunks, docMeta);
    } else if (VEC_MODE === 's3') {
      await storeVectorsS3(docId, vectors, chunks, docMeta);
    } else {
      console.log('Unknown VECTOR_MODE:', VEC_MODE);
    }

    await setStatus(docId, agentId, 'READY', { numChunks: chunks.length });
    return { statusCode: 200 };
  } catch (e) {
    console.error('ingestWorker error', e);
    try {
      const key = (event?.detail?.object?.key)||''; const parts = key.split('/'); const hasAgent = parts.length>3; const docId = hasAgent?parts[2]:parts[1]; const agentId = hasAgent?parts[1]:'default'; if (docId) await setStatus(docId, agentId, 'FAILED', { error: String(e.message||e) });
    } catch {}
    return { statusCode: 500 };
  }
};
