const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { S3VectorsClient, QueryVectorsCommand } = require('@aws-sdk/client-s3vectors');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { getOpenAIClient } = require('./helpers/openai-client');
const { generateText } = require('./helpers/openai');

const VECTOR_MODE = process.env.VECTOR_MODE || 's3vectors';
const VECTOR_BUCKET = process.env.VECTOR_BUCKET;
const VECTOR_INDEX = process.env.VECTOR_INDEX || 'docs';
const SETTINGS_TABLE = process.env.SETTINGS_TABLE;

const ddb = new DynamoDBClient({});

async function getAgentSettings(agentId) {
  try {
    const res = await ddb.send(new GetItemCommand({
      TableName: SETTINGS_TABLE,
      Key: marshall({ PK: `AGENT#${agentId}`, SK: 'SETTINGS#V1' })
    }));
    
    if (res.Item) {
      const item = unmarshall(res.Item);
      return item.data || item; // data might be nested
    }
  } catch (error) {
    console.warn('Could not fetch agent settings:', error.message);
  }
  
  // Return defaults if not found
  return {
    agentName: 'Agent',
    confidenceThreshold: 0.45,
    fallbackMessage: 'Sorry, I could not find this in the documentation.'
  };
}

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
  const params = { 
    vectorBucketName: VECTOR_BUCKET, 
    indexName: VECTOR_INDEX, 
    queryVector: { float32: vector }, 
    topK 
  };
  if (filter) params.filter = filter;
  const res = await client.send(new QueryVectorsCommand(params));
  const items = res?.vectors || [];
  return items.map((r) => ({ score: r.distance ?? 0, metadata: r.metadata, text: r.metadata?.text }));
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
  const startTime = Date.now();
  const body = event?.body && typeof event.body === 'string' ? JSON.parse(event.body) : event?.body || {};
  const q = body?.q;
  const filter = body?.filter;
  const agentId = body?.agentId;
  const debug = body?.debug === true;
  if (!q) return { statusCode: 400, body: JSON.stringify({ message: 'q is required' }) };

  // Get agent settings to use confidence threshold and fallback message
  const agentSettings = agentId ? await getAgentSettings(agentId) : {
    confidenceThreshold: 0.45,
    fallbackMessage: 'I could not find this information in the documentation.'
  };

  const vector = await embedQuery(q);
  console.log('Generated vector length:', vector?.length);
  console.log('Vector sample:', vector?.slice(0, 5));
  
  if (!vector) {
    return { statusCode: 500, body: JSON.stringify({ message: 'Failed to generate embedding vector' }) };
  }
  
  let results;
  let searchStartTime = Date.now();
  let appliedFilter = null;
  
  if (VECTOR_MODE === 's3vectors') {
    let f = filter;
    if (agentId) {
      // Convert string filter to S3 Vectors object format
      const agentFilter = { "agentId": { "$eq": agentId } };
      if (f) {
        // If there's an existing filter, combine them with $and
        f = { "$and": [agentFilter, f] };
      } else {
        f = agentFilter;
      }
    }
    appliedFilter = null//f;
    results = await queryS3Vectors(vector, 5, f);
  } else {
    results = await queryS3Jsonl(vector, 5, agentId);
  }
  
  const searchTime = Date.now() - searchStartTime;
  const confidence = results[0]?.score || 0;
  const grounded = results.length > 0 && confidence >= agentSettings.confidenceThreshold;
  const citations = results.slice(0,3).map(r => ({ docId: r.metadata?.docId, chunk: r.metadata?.chunkIdx, score: Number((r.score||0).toFixed(3)) }));

  let answer;
  let aiPrompt = null;
  let aiStartTime = Date.now();
  
  if (grounded) {
    const snippets = results.map(r => r.text).filter(Boolean).slice(0,3).join('\n\n');
    
    // Use the OpenAI helper to generate a comprehensive answer
    const systemPrompt = `You are a helpful assistant that answers questions based on provided documentation. Use the context provided to give accurate, helpful responses. If the context doesn't fully answer the question, acknowledge what information is available and what might be missing.`;
    const userPrompt = `Context from documentation:\n\n${snippets}\n\nQuestion: ${q}\n\nPlease provide a helpful answer based on the above context.`;
    
    aiPrompt = { systemPrompt, userPrompt };
    
    try {
      const response = await generateText({
        model: 'gpt-3.5-turbo',
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        additionalParams: {
          max_tokens: 500,
          temperature: 0.1
        }
      });
      
      answer = response.success ? response.text : `Based on your sources:\n\n${snippets}`;
    } catch (error) {
      // Fallback to raw snippets if AI fails
      answer = `Based on your sources:\n\n${snippets}`;
    }
  } else {
    // Use agent-specific fallback message when confidence is too low or no results
    answer = agentSettings.fallbackMessage;
  }
  
  const aiTime = Date.now() - aiStartTime;
  const totalTime = Date.now() - startTime;

  const response = { 
    answer, 
    grounded, 
    confidence: Number(confidence.toFixed(3)), 
    citations 
  };

  if (debug) {
    response.debug = {
      timing: {
        total: totalTime,
        vectorSearch: searchTime,
        aiGeneration: aiTime,
        embedding: searchStartTime - startTime
      },
      vectorSearch: {
        resultsCount: results.length,
        appliedFilter: appliedFilter,
        vectorLength: vector?.length,
        vectorSample: vector?.slice(0, 5)
      },
      rawResults: results.map(r => ({
        score: r.score,
        docId: r.metadata?.docId,
        chunkIdx: r.metadata?.chunkIdx,
        title: r.metadata?.title,
        textPreview: r.text?.slice(0, 200) + (r.text?.length > 200 ? '...' : ''),
        fullTextLength: r.text?.length
      })),
      retrievedChunks: results.map(r => r.text).filter(Boolean),
      confidenceAnalysis: {
        threshold: agentSettings.confidenceThreshold,
        topScore: confidence,
        isGrounded: grounded,
        scoresAboveThreshold: results.filter(r => r.score >= agentSettings.confidenceThreshold).length
      },
      agentSettings: {
        agentId,
        confidenceThreshold: agentSettings.confidenceThreshold,
        fallbackMessage: agentSettings.fallbackMessage
      }
    };
    
    if (aiPrompt) {
      response.debug.aiProcessing = {
        systemPrompt,
        userPrompt,
        snippetsUsed: results.map(r => r.text).filter(Boolean).length,
        totalSnippetLength: results.map(r => r.text).filter(Boolean).join('\n\n').length
      };
    }
  }

  return { statusCode: 200, body: JSON.stringify(response) };
};
