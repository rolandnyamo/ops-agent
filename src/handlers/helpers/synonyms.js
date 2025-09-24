const { DynamoDBClient, GetItemCommand, BatchGetItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');

// Lightweight text normalization
function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s) {
  const norm = normalizeText(s);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

function extractNgrams(text, maxN = 3) {
  const tokens = tokenize(text);
  const grams = new Set();
  const N = Math.min(maxN, 3);
  for (let n = N; n >= 1; n--) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const gram = tokens.slice(i, i + n).join(' ');
      if (gram.length >= 3) grams.add(gram);
    }
  }
  // Return as array sorted by length desc (longest-first)
  return Array.from(grams).sort((a, b) => b.length - a.length);
}

async function getActiveSynonymsVersion(ddb, tableName, agentId) {
  try {
    const res = await ddb.send(
      new GetItemCommand({
        TableName: tableName,
        Key: marshall({ PK: `AGENT#${agentId}`, SK: 'SYNONYMS#ACTIVE' })
      })
    );
    if (res.Item) {
      const item = unmarshall(res.Item);
      return item.version || null;
    }
    return null;
  } catch (e) {
    console.warn('getActiveSynonymsVersion error:', e.message);
    return null;
  }
}

async function batchGetVariantMappings(ddb, tableName, agentId, version, grams = []) {
  if (!version || !grams?.length) return {};
  // Build BatchGet keys for each gram
  const keys = grams.map((g) => marshall({ PK: `AGENT#${agentId}`, SK: `SYNVAR#v${version}#${g}` }));
  const req = { RequestItems: {} };
  req.RequestItems[tableName] = { Keys: keys };

  try {
    const res = await ddb.send(new BatchGetItemCommand(req));
    const out = {};
    const items = (res.Responses && res.Responses[tableName]) || [];
    for (const it of items.map(unmarshall)) {
      const sk = it.SK || '';
      const gram = sk.split(`#v${version}#`)[1];
      if (!gram) continue;
      out[gram] = { canonical: it.canonical, groupId: it.groupId, weight: it.weight || 1 };
    }
    return out;
  } catch (e) {
    console.warn('batchGetVariantMappings error:', e.message);
    return {};
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildExpansions(original, matchesMap, limit = 3) {
  // matchesMap: { gram -> {canonical, groupId, weight} }
  const grams = Object.keys(matchesMap || {});
  if (grams.length === 0) return [];

  // Sort by length desc, then weight desc
  grams.sort((a, b) => {
    const len = b.length - a.length;
    if (len !== 0) return len;
    return (matchesMap[b].weight || 1) - (matchesMap[a].weight || 1);
  });

  const expansions = [];
  const used = new Set();

  for (const gram of grams) {
    const { canonical } = matchesMap[gram];
    if (!canonical) continue;
    const re = new RegExp(`\\b${escapeRegex(gram)}\\b`, 'i');
    if (!re.test(original)) continue;
    const variant = original.replace(re, canonical);
    if (variant !== original && !used.has(variant)) {
      expansions.push(variant);
      used.add(variant);
      if (expansions.length >= limit) break;
    }
  }

  return expansions;
}

function applyLexicalBoost(results, terms = [], presenceBoost = 0.12, overlapBoost = 0.05) {
  if (!Array.isArray(results) || results.length === 0 || !terms?.length) return { results, boosts: [] };
  const termsLc = Array.from(new Set(terms.map((t) => normalizeText(t)).filter(Boolean)));
  const boosts = [];
  const boosted = results.map((r) => {
    const text = normalizeText(r.text || '');
    let boost = 0;
    let hits = 0;
    for (const t of termsLc) {
      if (!t) continue;
      if (text.includes(t)) {
        boost += presenceBoost;
        // count overlaps approximately
        const cnt = (text.match(new RegExp(`\\b${escapeRegex(t)}\\b`, 'g')) || []).length;
        hits += cnt;
      }
    }
    boost += Math.min(hits, 10) * overlapBoost;
    const newScore = (r.score || 0) + boost;
    boosts.push({ chunkIdx: r.metadata?.chunkIdx, applied: boost, hits });
    return { ...r, score: newScore };
  });
  // Resort by score desc
  boosted.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { results: boosted, boosts };
}

module.exports = {
  normalizeText,
  tokenize,
  extractNgrams,
  getActiveSynonymsVersion,
  batchGetVariantMappings,
  buildExpansions,
  applyLexicalBoost,
};

