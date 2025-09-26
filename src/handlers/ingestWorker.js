const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { S3VectorsClient, PutVectorsCommand, CreateIndexCommand } = require('@aws-sdk/client-s3vectors');
const { DynamoDBClient, UpdateItemCommand, GetItemCommand, PutItemCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { response } = require('./helpers/utils');
const { parseDocument } = require('./helpers/documentParser');

const s3 = new S3Client({});
const ddb = new DynamoDBClient({});
const RAW_BUCKET = process.env.RAW_BUCKET;
const VEC_BUCKET = process.env.VECTOR_BUCKET || 'ops-embeddings';
const VEC_MODE = process.env.VECTOR_MODE || 's3vectors';
const VEC_INDEX = process.env.VECTOR_INDEX || 'docs';
const VEC_DIMENSION = Number(process.env.VECTOR_DIMENSION || 1536);
const TABLE = process.env.DOCS_TABLE;
const SETTINGS_TABLE = process.env.SETTINGS_TABLE;
const { getOpenAIClient } = require('./helpers/openai-client');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const s3vectors = new S3VectorsClient({});

function decodeKey(key){ return decodeURIComponent(key.replace(/\+/g,'%20')); }
function textFromHtml(html){ return String(html).replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function chunkText(text, maxChars=3500, overlap=300){
  const t = String(text||'');
  const chunks = [];
  for (let i=0; i<t.length; i += (maxChars - overlap)) {chunks.push(t.slice(i, i+maxChars));}
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
  const openai = await getOpenAIClient();
  const model = 'text-embedding-3-small';
  // Batch for efficiency
  const resp = await openai.embeddings.create({ model, input: chunks });
  return (resp?.data || []).map(d => d.embedding);
}

async function storeVectorsS3(docId, vectors, chunks, docMeta){
  if (!VEC_BUCKET) {return;}
  const meta = docMeta ? { docId, agentId: docMeta.agentId || 'default', title: docMeta.title, category: docMeta.category, audience: docMeta.audience, year: docMeta.year, version: docMeta.version } : { docId, agentId: 'default' };
  const lines = vectors.map((v, i) => JSON.stringify({ ...meta, chunkIdx: i, vector: v, text: chunks[i] }));
  const key = `vectors/${meta.agentId}/${docId}.jsonl`;
  await s3.send(new PutObjectCommand({ Bucket: VEC_BUCKET, Key: key, Body: lines.join('\n'), ContentType: 'application/x-ndjson' }));
}

// Utility function to calculate JSON size in bytes
function getJsonSize(obj) {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}

// Utility function to truncate text to fit within metadata size limits
function truncateTextForMetadata(text, docMeta, maxFilterableSize = 1800) { // Leave buffer for other fields
  if (!text) {return '';}

  // Create realistic template with actual metadata values
  const filterableMetaTemplate = {
    title: docMeta?.title || '',
    category: docMeta?.category || '',
    audience: docMeta?.audience || '',
    chunkIdx: 999, // Use realistic number
    text: ''
  };

  // Start with full text and progressively truncate
  let truncated = text;

  while (truncated.length > 0) {
    filterableMetaTemplate.text = truncated;
    if (getJsonSize(filterableMetaTemplate) <= maxFilterableSize) {
      break;
    }

    // Truncate by 10% each iteration, preserving word boundaries
    const newLength = Math.floor(truncated.length * 0.9);
    let cutPoint = newLength;

    // Try to cut at word boundary
    const spaceIndex = truncated.lastIndexOf(' ', newLength);
    if (spaceIndex > newLength * 0.8) { // Don't go back too far
      cutPoint = spaceIndex;
    }

    truncated = truncated.substring(0, cutPoint) + '...';
  }

  return truncated;
}

async function storeVectorsS3Vectors(agentId, indexName, docId, vectors, chunks, docMeta){
  if (!VEC_BUCKET) {throw new Error('VECTOR_BUCKET not set');}
  const targetIndex = indexName || VEC_INDEX;
  if (!targetIndex) {throw new Error('VECTOR_INDEX not set');}
  const items = vectors.map((vector, i) => {
    const truncatedText = truncateTextForMetadata(chunks[i], docMeta);

    return {
      key: `${agentId}_${docId}_chunk_${i}`,
      data: {
        float32: vector // AWS S3 Vectors requires data.float32 format
      },
      metadata: {
        // Filterable metadata (under 2KB limit) - fields likely to be used for search/filtering
        title: docMeta?.title || '',
        category: docMeta?.category || '',
        audience: docMeta?.audience || '',
        chunkIdx: i,
        text: truncatedText,
        agentId: agentId || docMeta?.agentId || 'default',
        docId

        // Unfilterable metadata - stored but not indexed (larger fields)
        // unfilterable: {
        //   docId: docId,
        //   year: docMeta?.year || '',
        //   version: docMeta?.version || '',
        //   originalTextLength: chunks[i]?.length || 0,
        //   fullText: chunks[i] || '' // Store full text in unfilterable section
        // }
      }
    };
  });

  // Log metadata size for debugging (first item only)
  if (items.length > 0) {
    const sampleMetadata = items[0].metadata;
    const filterableMetadata = {
      title: sampleMetadata.title,
      category: sampleMetadata.category,
      audience: sampleMetadata.audience,
      chunkIdx: sampleMetadata.chunkIdx,
      text: sampleMetadata.text,
      agentId: sampleMetadata.agentId,
      docId: sampleMetadata.docId
    };
    const filterableSize = getJsonSize(filterableMetadata);
    const totalSize = getJsonSize(sampleMetadata);
    console.log(`Metadata sizes - Filterable: ${filterableSize}B, Total: ${totalSize}B`);
  }

  await s3vectors.send(new PutVectorsCommand({
    vectorBucketName: VEC_BUCKET,
    indexName: targetIndex,
    vectors: items
  }));
}

async function ensureVectorIndex(indexName) {
  if (!VEC_BUCKET || !indexName) {return;}
  const dimension = Number.isFinite(VEC_DIMENSION) && VEC_DIMENSION > 0 ? VEC_DIMENSION : 1536;
  try {
    await s3vectors.send(new CreateIndexCommand({
      vectorBucketName: VEC_BUCKET,
      indexName,
      dimension,
      dataType: 'float32',
      distanceMetric: 'cosine'
    }));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status !== 409) {
      console.warn('ensureVectorIndex failed:', error?.message || error);
      throw error;
    }
  }
}

async function getAgentVectorIndex(agentId) {
  if (!SETTINGS_TABLE || !agentId) return agentId || VEC_INDEX;
  try {
    const res = await ddb.send(new GetItemCommand({
      TableName: SETTINGS_TABLE,
      Key: marshall({ PK: `AGENT#${agentId}`, SK: 'SETTINGS#V1' })
    }));
    if (res.Item) {
      const item = unmarshall(res.Item);
      const data = item.data || item;
      const configured = data?.search?.vectorIndex;
      if (configured) return configured;
    }
  } catch (error) {
    console.warn('getAgentVectorIndex failed:', error?.message || error);
  }
  return agentId || VEC_INDEX;
}

// -------------------- Term Stats + Popularity Materialization --------------------
const STOPWORDS = new Set([
  'the','a','an','and','or','of','in','on','for','to','with','by','is','are','was','were','be','as','at','from','that','this','it','its','into','your','you','we','our','their','they','he','she','his','her','not','no','but','if','then','so','can','will','may','do','does','did'
]);

function normalizeTerm(s){
  return String(s||'')
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function extractDocTerms(chunks, maxUnique=200){
  const freq = new Map();
  for (const text of chunks){
    const norm = normalizeTerm(text);
    if (!norm) continue;
    const tokens = norm.split(' ').filter(t => t && t.length >= 3 && !STOPWORDS.has(t));
    // unigrams
    for (const t of tokens){
      freq.set(t, (freq.get(t)||0) + 1);
    }
    // bigrams
    for (let i=0;i<tokens.length-1;i++){
      const g = `${tokens[i]} ${tokens[i+1]}`;
      if (g.length>=3) freq.set(g, (freq.get(g)||0) + 1);
    }
    // trigrams (lightweight)
    for (let i=0;i<tokens.length-2;i++){
      const g = `${tokens[i]} ${tokens[i+1]} ${tokens[i+2]}`;
      if (g.length>=5) freq.set(g, (freq.get(g)||0) + 1);
    }
  }
  // rank by frequency desc, then length desc
  const ranked = Array.from(freq.entries()).sort((a,b)=>{
    const f = b[1]-a[1]; if (f!==0) return f; return b[0].length - a[0].length;
  });
  return ranked.slice(0, maxUnique).map(([term,count])=>({term, count}));
}

function paddedScore(df, titleHits){
  const score = (Number(df)||0)*1000 + Math.min(Number(titleHits)||0, 999);
  return String(score).padStart(9,'0');
}

async function updateAgentTermStats(agentId, docId, chunks, title){
  if (!SETTINGS_TABLE) return;
  // Check doc marker to avoid double DF increments
  let firstTimeDoc = false;
  try {
    const mr = await ddb.send(new GetItemCommand({ TableName: SETTINGS_TABLE, Key: marshall({ PK:`AGENT#${agentId}`, SK:`DOCSCAN#${docId}#TERMS#v1` }) }));
    if (!mr.Item) firstTimeDoc = true;
  } catch {}

  const terms = extractDocTerms(chunks, 200);
  const now = new Date().toISOString();
  const titleNorm = normalizeTerm(title||'');

  for (const {term} of terms){
    const key = { PK:`AGENT#${agentId}`, SK:`TERM#${term}` };
    let oldRankPK = null;
    try {
      const cur = await ddb.send(new GetItemCommand({ TableName: SETTINGS_TABLE, Key: marshall(key) }));
      if (cur.Item) {
        const item = unmarshall(cur.Item);
        oldRankPK = item.rankPK || null;
      }
    } catch {}

    const titleAdd = titleNorm && titleNorm.includes(term) ? 1 : 0;
    // Update counters
    const names = { '#u':'updatedAt', '#t':'titleHits' };
    const values = { ':u': now, ':one': firstTimeDoc ? 1 : 0, ':t': titleAdd };
    const ue = 'ADD df :one, #t :t SET #u = :u';
    const upd = await ddb.send(new UpdateItemCommand({
      TableName: SETTINGS_TABLE,
      Key: marshall(key),
      UpdateExpression: ue,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values),
      ReturnValues: 'ALL_NEW'
    }));

    const updated = unmarshall(upd.Attributes || {});
    const df = Number(updated.df)||0;
    const th = Number(updated.titleHits)||0;
    const newPad = paddedScore(df, th);
    const newRankPK = `RANK#${newPad}#${term}`;

    // If rank changed, swap rank items
    if (oldRankPK && oldRankPK !== newRankPK) {
      try {
        await ddb.send(new DeleteItemCommand({ TableName: SETTINGS_TABLE, Key: marshall({ PK: oldRankPK, SK: `POPULAR#AGENT#${agentId}` }) }));
      } catch {}
    }
    if (!oldRankPK || oldRankPK !== newRankPK) {
      try {
        await ddb.send(new PutItemCommand({
          TableName: SETTINGS_TABLE,
          Item: marshall({
            PK: newRankPK,
            SK: `POPULAR#AGENT#${agentId}`,
            term,
            df,
            titleHits: th,
            score: Number(df)*1000 + Math.min(th,999),
            updatedAt: now
          })
        }));
      } catch (e) { console.warn('Put rank item failed', e.message); }

      try {
        await ddb.send(new UpdateItemCommand({
          TableName: SETTINGS_TABLE,
          Key: marshall(key),
          UpdateExpression: 'SET rankPK = :r',
          ExpressionAttributeValues: marshall({ ':r': newRankPK })
        }));
      } catch {}
    }
  }

  // Write doc marker if first time
  if (firstTimeDoc) {
    try {
      await ddb.send(new PutItemCommand({
        TableName: SETTINGS_TABLE,
        Item: marshall({ PK:`AGENT#${agentId}`, SK:`DOCSCAN#${docId}#TERMS#v1`, termsHash: 'v1', processedAt: now })
      }));
    } catch {}
  }
}

exports.handler = async (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false;

  // EventBridge S3 ObjectCreated event
  try {
    const detail = event?.detail || {};
    const bucket = detail?.bucket?.name || RAW_BUCKET;
    const key = decodeKey(detail?.object?.key || '');
    if (!key.startsWith('raw/')) {
      response.statusCode = 200;
      response.body = JSON.stringify({ message: 'Not a raw file, skipping' });
      return callback(null, response);
    }
    const parts = key.split('/');
    const hasAgent = parts.length > 3;
    const agentId = hasAgent ? parts[1] : 'default';
    const docId = hasAgent ? parts[2] : parts[1];

    await setStatus(docId, agentId, 'PROCESSING');

    const { buffer, contentType } = await readObject(bucket, key);
    let text;
    
    try {
      // Use centralized document parser
      const filename = key.split('/').pop() || 'document';
      const parseResult = await parseDocument({ buffer, contentType, filename });
      
      // For ingestion, we need plain text (not HTML)
      text = parseResult.text || '';
      
      // For HTML files, extract text using the existing function for consistency
      if (parseResult.html && (filename.endsWith('.html') || filename.endsWith('.htm'))) {
        text = textFromHtml(parseResult.html);
      }
      
      text = String(text).trim();
      
      if (!text) {
        throw new Error('No text content extracted from document');
      }
      
    } catch (parseError) {
      console.error(`Document parsing failed for ${key}:`, parseError.message);
      await setStatus(docId, agentId, 'FAILED', { 
        error: `Document parsing failed: ${parseError.message}`,
        contentType,
        filename: key.split('/').pop()
      });
      response.statusCode = 200;
      response.body = JSON.stringify({ message: 'Document parsing failed', error: parseError.message });
      return callback(null, response);
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

    const vectorIndex = await getAgentVectorIndex(agentId);

    if (VEC_MODE === 's3vectors') {
      await ensureVectorIndex(vectorIndex);
      await storeVectorsS3Vectors(agentId, vectorIndex, docId, vectors, chunks, docMeta);
    } else if (VEC_MODE === 's3') {
      await storeVectorsS3(docId, vectors, chunks, docMeta);
    } else {
      console.log('Unknown VECTOR_MODE:', VEC_MODE);
    }

    // Update term stats for popular term extraction (guarded)
    try {
      if (process.env.ENABLE_TERM_STATS === 'true') {
        await updateAgentTermStats(agentId, docId, chunks, docMeta?.title || '');
      }
    } catch (e) {
      console.warn('Term stats update failed (continuing):', e.message);
    }

    await setStatus(docId, agentId, 'READY', { numChunks: chunks.length });

    // Emit an async event to generate/update synonyms for this agent
    try {
      const eb = new EventBridgeClient({});
      await eb.send(new PutEventsCommand({
        Entries: [{
          Source: 'ops-agent',
          DetailType: 'SynonymsRequested',
          Detail: JSON.stringify({ agentId, reason: 'doc_ingested', docId })
        }]
      }));
    } catch (e) {
      console.warn('Failed to emit synonyms event:', e.message);
    }
    response.statusCode = 200;
    response.body = JSON.stringify({ message: 'Processing completed', docId, chunks: chunks.length });
    return callback(null, response);
  } catch (e) {
    console.error('ingestWorker error', e);
    try {
      const key = (event?.detail?.object?.key)||''; const parts = key.split('/'); const hasAgent = parts.length>3; const docId = hasAgent?parts[2]:parts[1]; const agentId = hasAgent?parts[1]:'default'; if (docId) {await setStatus(docId, agentId, 'FAILED', { error: String(e.message||e) });}
    } catch {}
    response.statusCode = 500;
    response.body = JSON.stringify({ message: 'Processing failed', error: e.message });
    return callback(null, response);
  }
};
