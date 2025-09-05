const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { S3VectorsClient, QueryVectorsCommand } = require('@aws-sdk/client-s3vectors');
const { getOpenAIClient } = require('./helpers/openai-client');

const VECTOR_MODE = process.env.VECTOR_MODE || 's3vectors';
const VECTOR_BUCKET = process.env.VECTOR_BUCKET;
const VECTOR_INDEX = process.env.VECTOR_INDEX || 'docs';

async function embedQuery(q){
  const openai = await getOpenAIClient();
  const model = 'text-embedding-3-small';
  const resp = await openai.embeddings.create({ model, input: q });
  return resp?.data?.[0]?.embedding;
}

function cosine(a, b){
  let dot=0, a2=0, b2=0;
  for (let i=0;i<a.length;i++){ const x=a[i], y=b[i]||0; dot+=x*y; a2+=x*x; b2+=y*y; }
  return dot / (Math.sqrt(a2) * Math.sqrt(b2) + 1e-8);
}

async function queryS3Vectors(vector, topK=5, filter){
  const client = new S3VectorsClient({});
  const params = { bucket: VECTOR_BUCKET, index: VECTOR_INDEX, vector, topK };
  if (filter) params.filter = filter;
  const res = await client.send(new QueryVectorsCommand(params));
  const items = res?.results || res?.vectors || [];
  return items.map((r) => ({ score: r.score ?? r.distance ?? 0, metadata: r.metadata, text: r.text }));
}

async function queryS3Jsonl(vector, topK=5, agentId){
  const s3 = new S3Client({});
  const prefix = agentId ? `vectors/${agentId}/` : 'vectors/';
  const list = await s3.send(new ListObjectsV2Command({ Bucket: VECTOR_BUCKET, Prefix: prefix }));
  const all = [];
  for (const obj of list.Contents || []){
    const get = await s3.send(new GetObjectCommand({ Bucket: VECTOR_BUCKET, Key: obj.Key }));
    const body = await get.Body.transformToString('utf8');
    for (const line of body.split(/\n+/)){
      if (!line.trim()) continue;
      try { const rec = JSON.parse(line); all.push(rec); } catch {}
    }
  }
  const scored = all.map((r) => ({ ...r, score: cosine(vector, r.vector) }));
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0, topK).map(r => ({ score: r.score, metadata: r, text: r.text }));
}

exports.handler = async (event) => {
  const body = event?.body && typeof event.body === 'string' ? JSON.parse(event.body) : event?.body || {};
  const q = body?.q;
  const filter = body?.filter;
  const agentId = body?.agentId;
  if (!q) return { statusCode: 400, body: JSON.stringify({ message: 'q is required' }) };

  const vector = await embedQuery(q);
  let results;
  if (VECTOR_MODE === 's3vectors') {
    let f = filter;
    if (agentId) f = f ? `(${f}) AND agentId = "${agentId}"` : `agentId = "${agentId}"`;
    results = await queryS3Vectors(vector, 5, f);
  } else {
    results = await queryS3Jsonl(vector, 5, agentId);
  }

  const grounded = results.length > 0;
  const snippets = results.map(r => r.text).filter(Boolean).slice(0,3).join('\n\n');
  const confidence = results[0]?.score || 0;
  const answer = grounded ? `Based on your sources:\n\n${snippets}` : 'I could not find this in the documentation.';
  const citations = results.slice(0,3).map(r => ({ docId: r.metadata?.docId, chunk: r.metadata?.chunkIdx, score: Number((r.score||0).toFixed(3)) }));

  return { statusCode: 200, body: JSON.stringify({ answer, grounded, confidence: Number(confidence.toFixed(3)), citations }) };
};
