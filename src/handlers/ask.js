const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { S3VectorsClient, QueryVectorsCommand, DescribeIndexCommand, GetIndexCommand } = require('@aws-sdk/client-s3vectors');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { getOpenAIClient } = require('./helpers/openai-client');
const { generateText } = require('./helpers/openai');
const {
  extractNgrams,
  getActiveSynonymsVersion,
  batchGetVariantMappings,
  buildExpansions,
  applyLexicalBoost,
} = require('./helpers/synonyms');
const { response } = require('./helpers/utils');

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
      const data = item.data || item;
      if (agentId && data?.search && !data.search.vectorIndex) {
        data.search.vectorIndex = agentId;
      }
      return data; // data might be nested
    }
  } catch (error) {
    console.warn('Could not fetch agent settings:', error.message);
  }

  // Return defaults if not found
  return {
    agentName: 'Agent',
    confidenceThreshold: 0.45,
    fallbackMessage: 'Sorry, I could not find this in the documentation.',
    systemPrompt: `You are a helpful assistant that provides concise, well-formatted answers based on documentation. 

Guidelines:
- Keep answers brief and to the point
- Use bullet points or lists when presenting multiple items
- Start with the most important/direct information
- Format numbers and prices clearly
- If the context is incomplete, briefly mention what's missing

Format your response to be easily scannable.`
  };
}

async function embedQuery(q, model='text-embedding-3-small'){
  const openai = await getOpenAIClient();
  const resp = await openai.embeddings.create({ model, input: q });
  return resp?.data?.[0]?.embedding;
}

function cosine(a, b){
  let dot=0, a2=0, b2=0;
  for (let i=0;i<a.length;i++){ const x=a[i], y=b[i]||0; dot+=x*y; a2+=x*x; b2+=y*y; }
  return dot / (Math.sqrt(a2) * Math.sqrt(b2) + 1e-8);
}

async function queryS3Vectors(vector, topK=5, filter, indexName){
  const client = new S3VectorsClient({});
  const params = {
    vectorBucketName: VECTOR_BUCKET,
    indexName: indexName || VECTOR_INDEX,
    queryVector: { float32: vector },
    topK,
    returnMetadata: true  // This is the key parameter to get metadata!
  };
  if (filter) {params.filter = filter;}

  console.log('S3Vectors query params:', JSON.stringify(params, null, 2));
  const res = await client.send(new QueryVectorsCommand(params));
  console.log('S3Vectors raw response sample:', JSON.stringify({
    vectorCount: res?.vectors?.length,
    // firstResult: res?.vectors?.[0],
    hasMetadata: !!res?.vectors?.[0]?.metadata
  }, null, 2));

  const items = res?.vectors || [];
  return items.map((r) => ({
    score: r.distance ?? r.score ?? 0.5, // Still need to find the correct field for similarity score
    metadata: r.metadata || { docId: r.key, text: `Document chunk: ${r.key}` },
    text: r.metadata?.text || `Content from ${r.key}`
  }));
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
      if (!line.trim()) {continue;}
      try { const rec = JSON.parse(line); all.push(rec); } catch {}
    }
  }
  const scored = all.map((r) => ({ ...r, score: cosine(vector, r.vector) }));
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0, topK).map(r => ({ score: r.score, metadata: r, text: r.text }));
}

async function debugS3VectorsIndex(indexName) {
  try {
    const client = new S3VectorsClient({});
    const res = await client.send(new GetIndexCommand({
      vectorBucketName: VECTOR_BUCKET,
      indexName: indexName || VECTOR_INDEX
    }));

    return res;
  } catch (error) {
    console.error('Failed to describe S3 Vectors index:', error);
    return null;
  }
}

async function debugS3BucketContents() {
  try {
    const s3 = new S3Client({});
    const listCommand = new ListObjectsV2Command({
      Bucket: VECTOR_BUCKET,
      MaxKeys: 10
    });

    const response = await s3.send(listCommand);
    console.log('S3 Bucket Contents Sample:', {
      totalObjects: response.KeyCount,
      isTruncated: response.IsTruncated,
      objects: response.Contents?.slice(0, 5)?.map(obj => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified
      }))
    });

    return response;
  } catch (error) {
    console.error('Failed to list S3 bucket contents:', error);
    return null;
  }
}

exports.handler = async (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false;

  console.log(JSON.stringify(event))

  // Handle CORS preflight requests
  if (event.requestContext?.http?.method === 'OPTIONS') {
    response.statusCode = 200;
    response.body = JSON.stringify({ message: 'CORS preflight' });
    return callback(null, response);
  }

  const startTime = Date.now();
  const body = event?.body && typeof event.body === 'string' ? JSON.parse(event.body) : event?.body || {};
  const q = body?.q;
  const filter = body?.filter;
  let agentId = body?.agentId;
  const debug = body?.debug === true;

  // Check authentication context from the authorizer
  const authorizerContext = event.requestContext?.authorizer;
  let botInfo = null;
  let authType = null;

  if (authorizerContext) {
    authType = authorizerContext.authType;

    if (authType === 'bot' && authorizerContext.agentId) {
      // This is an authenticated bot request
      agentId = authorizerContext.agentId;
      botInfo = {
        botId: authorizerContext.botId,
        siteUrl: authorizerContext.siteUrl,
        platform: authorizerContext.platform
      };
      console.log(`Bot request: ${botInfo.botId} for agent: ${agentId}`);
    } else if (authType === 'admin') {
      // This is an admin testing the bot functionality
      // agentId should be provided in the request body
      if (!agentId) {
        response.statusCode = 400;
        response.body = JSON.stringify({
          message: 'agentId is required when testing as admin',
          authType: 'admin',
          userId: authorizerContext.userId
        });
        return callback(null, response);
      }
      console.log(`Admin testing bot functionality: ${authorizerContext.email} for agent: ${agentId}`);
    }
  }

  if (!q) {
    response.statusCode = 400;
    response.body = JSON.stringify({ message: 'q is required' });
    return callback(null, response);
  }

  // Get agent settings to use confidence threshold and fallback message
  const agentSettings = agentId ? await getAgentSettings(agentId) : {
    confidenceThreshold: 0.45,
    fallbackMessage: 'I could not find this information in the documentation.',
    search: {
      queryExpansion: { enabled: false, maxVariants: 3 },
      lexicalBoost: { enabled: true, presenceBoost: 0.12, overlapBoost: 0.05 },
      embeddingModel: 'text-embedding-3-small'
    }
  };

  // Ensure defaults for search settings
  const searchCfg = agentSettings.search || {};
  if (!searchCfg.queryExpansion) searchCfg.queryExpansion = { enabled: false, maxVariants: 3 };
  if (!searchCfg.lexicalBoost) searchCfg.lexicalBoost = { enabled: true, presenceBoost: 0.12, overlapBoost: 0.05 };
  if (!searchCfg.embeddingModel) searchCfg.embeddingModel = 'text-embedding-3-small';
  if (agentId && !searchCfg.vectorIndex) searchCfg.vectorIndex = agentId;

  // Build query expansions using per-agent synonyms (lookup only grams present in query)
  let expansions = [q];
  let synonymDebug = null;
  try {
    if (agentId && searchCfg.queryExpansion?.enabled) {
      const version = await getActiveSynonymsVersion(ddb, SETTINGS_TABLE, agentId);
      const grams = extractNgrams(q, 3);
      const matchesMap = await batchGetVariantMappings(ddb, SETTINGS_TABLE, agentId, version, grams);
      const extra = buildExpansions(q, matchesMap, searchCfg.queryExpansion?.maxVariants || 3);
      // dedupe while keeping order
      const seen = new Set();
      expansions = [q, ...extra].filter((s) => { const key = s.trim(); if (seen.has(key)) return false; seen.add(key); return true; });
      synonymDebug = { version, gramsTried: grams, matches: matchesMap, expansionsTried: expansions };
    }
  } catch (e) {
    console.warn('Query expansion failed (continuing without):', e.message);
  }

  // Embed and retrieve for each expansion; merge results
  const embeddingModel = searchCfg.embeddingModel || 'text-embedding-3-small';
  const merged = new Map();
  let rawSearchResponse = null;
  // Apply any incoming filter directly (pass-through for S3 Vectors)
  // Note: filter structure must match S3 Vectors expectations if used.
  const vectorIndexName = searchCfg.vectorIndex || VECTOR_INDEX;
  let appliedFilter = filter || null;
  if (agentId && VECTOR_MODE === 's3vectors') {
    const agentFilter = `agentId = \"${String(agentId).replace(/"/g, '\\"')}\"`;
    appliedFilter = appliedFilter ? `(${agentFilter}) AND (${appliedFilter})` : agentFilter;
  }
  const searchStartTime = Date.now();
  for (let i = 0; i < expansions.length; i++) {
    const qx = expansions[i];
    const vector = await embedQuery(qx, embeddingModel);
    if (!vector) { continue; }

    let resultsForQ = [];
    if (VECTOR_MODE === 's3vectors') {
      try {
        const client = new S3VectorsClient({});
        const params = {
          vectorBucketName: VECTOR_BUCKET,
          indexName: vectorIndexName,
          queryVector: { float32: vector },
          topK: 5,
          returnMetadata: true,
          includeScores: true
        };
        if (appliedFilter) { params.filter = appliedFilter; }
        const res = await client.send(new QueryVectorsCommand(params));
        if (i === 0) rawSearchResponse = res; // capture first for debug
        const items = res?.vectors || [];
        resultsForQ = items.map((r, index) => ({
          score: r.distance ?? r.score ?? (0.9 - index * 0.1),
          metadata: r.metadata,
          text: r.metadata?.text,
          _sourceQuery: qx
        }));
      } catch (error) {
        console.error('S3Vectors query failed:', error);
        throw error;
      }
    } else {
      resultsForQ = await queryS3Jsonl(vector, 5, agentId);
      resultsForQ = resultsForQ.map((r) => ({ ...r, _sourceQuery: qx }));
    }

    for (const r of resultsForQ) {
      const key = `${r.metadata?.title || ''}|${r.metadata?.chunkIdx}|${(r.text || '').slice(0, 50)}`;
      const prev = merged.get(key);
      if (!prev || (r.score || 0) > (prev.score || 0)) {
        merged.set(key, r);
      }
    }
  }

  let results = Array.from(merged.values());
  const searchTime = Date.now() - searchStartTime;

  // Optionally apply lexical boosts using matched canonicals/variants
  let boostDebug = null;
  if (searchCfg.lexicalBoost?.enabled && synonymDebug?.matches) {
    const termsToBoost = [
      ...Object.keys(synonymDebug.matches || {}),
      ...Object.values(synonymDebug.matches || {}).map((m) => m.canonical)
    ];
    const boosted = applyLexicalBoost(results, termsToBoost, searchCfg.lexicalBoost?.presenceBoost || 0.12, searchCfg.lexicalBoost?.overlapBoost || 0.05);
    results = boosted.results;
    boostDebug = boosted.boosts;
  }
  // Add comprehensive debugging
  console.log('=== VECTOR SEARCH DEBUG ===');
  console.log('VECTOR_MODE:', VECTOR_MODE);
  console.log('VECTOR_BUCKET:', VECTOR_BUCKET);
  console.log('VECTOR_INDEX:', vectorIndexName);
  console.log('AgentId:', agentId);
  console.log('Original filter:', filter);

  // Debug the index itself
  const indexInfo = await debugS3VectorsIndex(vectorIndexName);
  const bucketInfo = await debugS3BucketContents();

  // searchTime already computed above after merging results
  const confidence = results[0]?.score || 0;
  const grounded = results.length > 0 && confidence >= agentSettings.confidenceThreshold;
  const citations = results.slice(0,3).map(r => ({
    docId: r.metadata?.title || r.metadata?.docId || 'Document',
    chunk: r.metadata?.chunkIdx,
    score: Number((r.score||0).toFixed(3))
  }));

  let answer;
  let aiPrompt = null;
  const aiStartTime = Date.now();

  if (grounded) {
    const snippets = results.map(r => r.text).filter(Boolean).slice(0,3).join('\n\n');

    // Use the system prompt from agent settings
    const systemPrompt = agentSettings.systemPrompt || `You are a helpful assistant that provides concise, well-formatted answers based on documentation. 

Guidelines:
- Keep answers brief and to the point
- Use bullet points or lists when presenting multiple items
- Start with the most important/direct information
- Format numbers and prices clearly
- If the context is incomplete, briefly mention what's missing

Format your response to be easily scannable.`;

    const userPrompt = `Context from documentation:

${snippets}

Question: ${q}

Provide a concise, well-formatted answer based on the above context.`;

    aiPrompt = { systemPrompt, userPrompt };

    try {
      const response = await generateText({
        model: 'gpt-3.5-turbo',
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        additionalParams: {
          max_output_tokens: 500,
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

  const responseBody = {
    answer,
    grounded,
    confidence: Number(confidence.toFixed(3)),
    citations
  };

  if (debug) {
    responseBody.debug = {
      timing: {
        total: totalTime,
        vectorSearch: searchTime,
        aiGeneration: aiTime,
        embedding: searchStartTime - startTime
      },
      vectorSearch: {
        resultsCount: results.length,
        appliedFilter: appliedFilter,
        vectorLength: undefined,
        vectorSample: undefined,
        rawSearchResponse: rawSearchResponse ? {
          vectorCount: rawSearchResponse.vectors?.length,
          hasMetadata: rawSearchResponse.vectors?.[0]?.metadata ? true : false
        } : null
      },
      indexInfo: indexInfo ? indexInfo.index : null,
      environment: {
        VECTOR_MODE,
        VECTOR_BUCKET,
        VECTOR_INDEX,
        region: process.env.AWS_REGION
      },
      queryExpansion: synonymDebug || null,
      lexicalBoosts: boostDebug || null,
      rawResults: results.map(r => ({
        score: r.score,
        docId: r.metadata?.docId,
        chunkIdx: r.metadata?.chunkIdx,
        title: r.metadata?.title,
        textPreview: r.text?.slice(0, 200) + (r.text?.length > 200 ? '...' : ''),
        fullTextLength: r.text?.length,
        fullMetadata: r.metadata,
        sourceQuery: r._sourceQuery
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
      responseBody.debug.aiProcessing = {
        systemPrompt: aiPrompt.systemPrompt,
        userPrompt: aiPrompt.userPrompt,
        snippetsUsed: results.map(r => r.text).filter(Boolean).length,
        totalSnippetLength: results.map(r => r.text).filter(Boolean).join('\n\n').length
      };
    }
  }

  response.statusCode = 200;
  response.body = JSON.stringify(responseBody);
  return callback(null, response);
};
