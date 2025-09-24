const { DynamoDBClient, QueryCommand, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { getOpenAIClient } = require('./helpers/openai-client');
const { response } = require('./helpers/utils');

const TABLE = process.env.SETTINGS_TABLE;
const ddb = new DynamoDBClient({});

function normalize(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9\s\-]/g,' ').replace(/\s+/g,' ').trim(); }

// Simple morphological/format variants
function generateVariants(term){
  const variants = new Set();
  const t = normalize(term);
  if (!t) return [];
  variants.add(t);
  // hyphen/space toggles
  variants.add(t.replace(/\-/g,' '));
  variants.add(t.replace(/\s+/g,'-'));
  // plural/singular naive
  if (t.endsWith('ies')) variants.add(t.slice(0,-3)+'y');
  if (t.endsWith('y')) variants.add(t.slice(0,-1)+'ies');
  if (t.endsWith('s')) variants.add(t.slice(0,-1));
  else variants.add(t+'s');
  return Array.from(variants).filter(v=>v && v!==t);
}

function initials(phrase){ return phrase.split(/\s+/).map(w=>w[0]||'').join('').toUpperCase(); }
function isAcronym(s){ return /^[A-Z0-9]{2,8}$/.test(s); }

async function fetchTopTerms(agentId, limit=200){
  // Query GSI by SK = POPULAR#AGENT#<id>
  const sk = `POPULAR#AGENT#${agentId}`;
  const res = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'Index-01',
    KeyConditionExpression: '#sk = :sk',
    ExpressionAttributeNames: { '#sk':'SK' },
    ExpressionAttributeValues: marshall({ ':sk': sk })
  }));
  const items = (res.Items||[]).map(unmarshall);
  items.sort((a,b)=> (b.score||0) - (a.score||0));
  return items.slice(0, limit).map(x=>({ term: x.term, score: x.score||0 }));
}

function buildGroups(terms){
  // Group by acronym<->expansion and by normalized equivalence
  const groups = [];
  const seen = new Set();
  const termSet = new Set(terms.map(t=>normalize(t.term)));

  // Acronym pairing
  const mapByInitials = new Map();
  for (const {term} of terms){
    const n = normalize(term);
    const init = initials(n);
    if (init.length>=2) {
      if (!mapByInitials.has(init)) mapByInitials.set(init, new Set());
      mapByInitials.get(init).add(n);
    }
  }

  for (const [acronym, phrases] of mapByInitials.entries()){
    // If we actually have the acronym as a separate term, link it
    const hasAcr = termSet.has(acronym.toLowerCase());
    if (hasAcr && phrases.size>0){
      const canonical = Array.from(phrases).sort((a,b)=>b.length-a.length)[0];
      const variants = [acronym, ...Array.from(phrases).filter(p=>p!==canonical)];
      const key = `acr:${canonical}|${acronym}`;
      if (!seen.has(key)){
        seen.add(key);
        groups.push({ canonical, variants, weight: 2 });
      }
    }
  }

  // Format/morphology variants for top phrases
  for (const {term} of terms){
    const n = normalize(term);
    if (!n || isAcronym(n.toUpperCase())) continue;
    const variants = generateVariants(n).filter(v=>v!==n);
    if (variants.length){
      const key = `var:${n}`;
      if (!seen.has(key)){
        seen.add(key);
        groups.push({ canonical: n, variants, weight: 1 });
      }
    }
  }
  return groups;
}

async function getAgentSettings(agentId){
  const res = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: marshall({ PK:`AGENT#${agentId}`, SK:'SETTINGS#V1' }) }));
  const item = res.Item ? unmarshall(res.Item).data : {};
  return item || {};
}

async function writeDraft(agentId, groups){
  const now = new Date().toISOString();
  const version = `draft-${Date.now()}`;
  const item = { PK: `AGENT#${agentId}`, SK: 'SYNONYMS#DRAFT', data: { version, groups, updatedAt: now } };
  await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(item) }));
  return version;
}

async function publish(agentId, groups){
  const now = new Date().toISOString();
  const version = String(Date.now());
  for (let i=0;i<groups.length;i++){
    const g = groups[i];
    const groupId = g.groupId || String(i+1).padStart(4,'0');
    const groupItem = { PK:`AGENT#${agentId}`, SK:`SYNONYMS#v${version}#GROUP#${groupId}`, canonical: g.canonical, variants: g.variants||[], weight: g.weight||1, updatedAt: now };
    await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(groupItem) }));
    for (const v of (g.variants||[])){
      const norm = normalize(v);
      if (!norm) continue;
      const varItem = { PK:`AGENT#${agentId}`, SK:`SYNVAR#v${version}#${norm}`, canonical: g.canonical, groupId, weight: g.weight||1, updatedAt: now };
      await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(varItem) }));
    }
  }
  const active = { PK:`AGENT#${agentId}`, SK:'SYNONYMS#ACTIVE', version, createdAt: now };
  await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshall(active) }));
  return version;
}

exports.handler = async (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const method = event?.httpMethod || event?.requestContext?.http?.method;

  // Handle CORS preflight for HTTP calls
  if (method === 'OPTIONS') {
    response.statusCode = 204;
    response.body = '';
    return callback(null, response);
  }

  try {
    // Triggered by EventBridge or HTTP with agentId.
    const agentId = event?.detail?.agentId || event?.agentId || event?.pathParameters?.agentId || event?.queryStringParameters?.agentId;
    if (!agentId) {
      if (method) {
        response.statusCode = 400;
        response.body = JSON.stringify({ message: 'agentId is required' });
        return callback(null, response);
      }
      return { statusCode: 400, body: JSON.stringify({ message: 'agentId is required' }) };
    }

    const terms = await fetchTopTerms(agentId, 200);
    const groups = buildGroups(terms);
    const settings = await getAgentSettings(agentId);
    const autoApprove = !!settings?.search?.synonyms?.autoApprove;

    if (autoApprove) {
      const version = await publish(agentId, groups);
      if (method) {
        response.statusCode = 200;
        response.body = JSON.stringify({ success: true, published: true, version, groupsCount: groups.length });
        return callback(null, response);
      }
      return { statusCode: 200, body: JSON.stringify({ success: true, published: true, version, groupsCount: groups.length }) };
    } else {
      const version = await writeDraft(agentId, groups);
      if (method) {
        response.statusCode = 200;
        response.body = JSON.stringify({ success: true, published: false, version, groupsCount: groups.length });
        return callback(null, response);
      }
      return { statusCode: 200, body: JSON.stringify({ success: true, published: false, version, groupsCount: groups.length }) };
    }
  } catch (e) {
    console.error('synonymsGen error', e);
    if (event?.httpMethod || event?.requestContext?.http?.method) {
      response.statusCode = 500;
      response.body = JSON.stringify({ message: 'generation failed', error: e.message });
      return callback(null, response);
    }
    return { statusCode: 500, body: JSON.stringify({ message: 'generation failed', error: e.message }) };
  }
};
