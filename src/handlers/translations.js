const { DynamoDBClient, QueryCommand, GetItemCommand, PutItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const HtmlDocx = require('html-docx-js');
const crypto = require('node:crypto');
const { response } = require('./helpers/utils');
const { assembleHtmlDocument } = require('./helpers/documentParser');

const ddb = new DynamoDBClient({});
const s3 = new S3Client({});
const eb = new EventBridgeClient({});

const DOCS_TABLE = process.env.DOCS_TABLE;
const RAW_BUCKET = process.env.RAW_BUCKET;

function now() {
  return new Date().toISOString();
}

function parseBody(event) {
  if (!event || !event.body) return {};
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch {
    return {};
  }
}

function ok(status, body, callback) {
  response.statusCode = status;
  response.body = JSON.stringify(body);
  return callback(null, response);
}

function sanitizeFilename(name) {
  return String(name || 'document').replace(/[^A-Za-z0-9._-]/g, '_');
}

function ownerFrom(event) {
  return event?.queryStringParameters?.ownerId || 'default';
}

function reviewerFrom(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims || {};
  return {
    name: claims['name'] || claims['cognito:username'] || null,
    email: claims['email'] || null,
    sub: claims['sub'] || null,
  };
}

function makeItem(input) {
  const translationId = input.translationId;
  const ownerId = input.ownerId || 'default';
  const status = input.status || 'PROCESSING';
  return {
    PK: `TRANSLATION#${translationId}`,
    SK: `TRANSLATION#${ownerId}`,
    SK1: `STATUS#${status}`,
    translationId,
    ownerId,
    title: input.title || '',
    description: input.description || '',
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    originalFilename: input.originalFilename,
    originalFileKey: input.originalFileKey,
    status,
    createdAt: input.createdAt || now(),
    updatedAt: now(),
    requestedBy: input.requestedBy || null,
    provider: input.provider || null,
    model: input.model || null
  };
}

async function generateUploadUrl(body, eventOwner) {
  const ownerId = body.ownerId || eventOwner || 'default';
  const translationId = body.translationId || crypto.randomUUID();
  if (!RAW_BUCKET) {
    throw new Error('RAW_BUCKET not configured');
  }

  const filename = sanitizeFilename(body.filename);
  const contentType = String(body.contentType || '').toLowerCase();
  const allow = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
    'text/html'
  ]);
  if (!allow.has(contentType)) {
    throw new Error(`Unsupported content type ${contentType}`);
  }

  const key = `translations/raw/${ownerId}/${translationId}/${filename}`;
  const cmd = new PutObjectCommand({ Bucket: RAW_BUCKET, Key: key, ContentType: contentType });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 });
  return { ownerId, translationId, uploadUrl, fileKey: key, contentType, filename };
}

async function createTranslation(body, eventOwner, requester) {
  if (!DOCS_TABLE) {
    throw new Error('DOCS_TABLE not configured');
  }
  const ownerId = body.ownerId || eventOwner || 'default';
  const translationId = body.translationId || crypto.randomUUID();
  const sourceLanguage = body.sourceLanguage || 'fr';
  const targetLanguage = body.targetLanguage || 'en';
  const fileKey = body.fileKey;
  const filename = body.originalFilename || body.filename || sanitizeFilename(fileKey?.split('/').pop() || 'document');

  if (!fileKey) {
    throw new Error('fileKey is required');
  }
  if (!fileKey.startsWith(`translations/raw/${ownerId}/${translationId}`)) {
    throw new Error('fileKey does not match translation owner or id');
  }

  const item = makeItem({
    translationId,
    ownerId,
    title: body.title || filename,
    description: body.description || '',
    sourceLanguage,
    targetLanguage,
    originalFilename: filename,
    originalFileKey: fileKey,
    status: 'PROCESSING',
    requestedBy: requester?.email || requester?.sub || null,
    createdAt: now()
  });

  await ddb.send(new PutItemCommand({ TableName: DOCS_TABLE, Item: marshall(item) }));

  await eb.send(new PutEventsCommand({
    Entries: [{
      Source: 'ops-agent',
      DetailType: 'TranslationRequested',
      Detail: JSON.stringify({ translationId, ownerId })
    }]
  }));

  return item;
}

async function listTranslations(ownerId) {
  const params = {
    TableName: DOCS_TABLE,
    IndexName: 'Index-01',
    KeyConditionExpression: '#sk = :sk',
    ExpressionAttributeNames: { '#sk': 'SK' },
    ExpressionAttributeValues: marshall({ ':sk': `TRANSLATION#${ownerId}` }),
    Limit: 100
  };
  const res = await ddb.send(new QueryCommand(params));
  return (res.Items || []).map(unmarshall);
}

async function getTranslation(translationId, ownerId) {
  const res = await ddb.send(new GetItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall({ PK: `TRANSLATION#${translationId}`, SK: `TRANSLATION#${ownerId}` })
  }));
  if (!res.Item) return null;
  return unmarshall(res.Item);
}

async function updateTranslation(translationId, ownerId, patch) {
  const names = { '#u': 'updatedAt' };
  const values = { ':u': now() };
  const sets = ['#u = :u'];
  for (const [key, value] of Object.entries(patch || {})) {
    names[`#${key}`] = key;
    values[`:${key}`] = value;
    sets.push(`#${key} = :${key}`);
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'status')) {
    names['#SK1'] = 'SK1';
    values[':sk1'] = `STATUS#${patch.status}`;
    sets.push('#SK1 = :sk1');
  }
  await ddb.send(new UpdateItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall({ PK: `TRANSLATION#${translationId}`, SK: `TRANSLATION#${ownerId}` }),
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(values)
  }));
}

async function loadChunks(chunkKey) {
  const res = await s3.send(new GetObjectCommand({ Bucket: RAW_BUCKET, Key: chunkKey }));
  const bytes = await res.Body.transformToByteArray();
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

async function saveChunks(chunkKey, payload) {
  await s3.send(new PutObjectCommand({ Bucket: RAW_BUCKET, Key: chunkKey, Body: JSON.stringify(payload), ContentType: 'application/json' }));
}

async function handleChunkUpdate(event, translationId, ownerId, reviewer) {
  const body = parseBody(event);
  if (!body.chunks || !Array.isArray(body.chunks)) {
    throw new Error('chunks array required');
  }

  const item = await getTranslation(translationId, ownerId);
  if (!item?.chunkFileKey) {
    throw new Error('No chunk file found for translation');
  }
  const chunkData = await loadChunks(item.chunkFileKey);
  const chunkMap = new Map((chunkData.chunks || []).map(chunk => [chunk.id, chunk]));
  const updatedAt = now();
  for (const incoming of body.chunks) {
    const target = chunkMap.get(incoming.id);
    if (!target) continue;
    let nextHtml = target.machineHtml;
    if (Object.prototype.hasOwnProperty.call(incoming, 'reviewerHtml')) {
      nextHtml = typeof incoming.reviewerHtml === 'string' ? incoming.reviewerHtml : target.machineHtml;
    } else if (Object.prototype.hasOwnProperty.call(incoming, 'html')) {
      nextHtml = typeof incoming.html === 'string' ? incoming.html : target.machineHtml;
    } else if (Object.prototype.hasOwnProperty.call(incoming, 'text')) {
      nextHtml = typeof incoming.text === 'string' ? incoming.text : target.machineHtml;
    }
    target.reviewerHtml = nextHtml;
    target.lastUpdatedBy = reviewer.email || reviewer.name || reviewer.sub || 'reviewer';
    target.lastUpdatedAt = updatedAt;
    target.reviewerName = reviewer.name || target.reviewerName || null;
  }

  chunkData.lastReviewedAt = updatedAt;
  chunkData.chunks = Array.from(chunkMap.values());
  await saveChunks(item.chunkFileKey, chunkData);
  await updateTranslation(translationId, ownerId, { lastReviewedAt: updatedAt });
  return chunkData;
}

async function handleApprove(translationId, ownerId, reviewer) {
  const item = await getTranslation(translationId, ownerId);
  if (!item?.chunkFileKey) {
    throw new Error('No chunk file found for translation');
  }
  const chunkData = await loadChunks(item.chunkFileKey);
  const finalHtml = assembleHtmlDocument({ headHtml: chunkData.headHtml, chunks: chunkData.chunks, reviewer: true });
  const htmlKey = `translations/output/${ownerId}/${translationId}.html`;
  await s3.send(new PutObjectCommand({ Bucket: RAW_BUCKET, Key: htmlKey, Body: finalHtml, ContentType: 'text/html; charset=utf-8' }));

  let docxKey = null;
  try {
    const buffer = HtmlDocx.asBlob(finalHtml);
    docxKey = `translations/output/${ownerId}/${translationId}.docx`;
    await s3.send(new PutObjectCommand({ Bucket: RAW_BUCKET, Key: docxKey, Body: buffer, ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  } catch (err) {
    console.warn('Failed to generate DOCX, falling back to HTML only:', err?.message || err);
  }

  const statusPatch = {
    status: 'APPROVED',
    approvedAt: now(),
    approvedBy: reviewer.email || reviewer.name || reviewer.sub || 'reviewer',
    translatedFileKey: docxKey || htmlKey,
    translatedFormat: docxKey ? 'docx' : 'html',
    translatedHtmlKey: htmlKey
  };
  await updateTranslation(translationId, ownerId, statusPatch);
  return statusPatch;
}

async function handleDownload(translationId, ownerId, type) {
  const item = await getTranslation(translationId, ownerId);
  if (!item) throw new Error('Translation not found');
  const mapping = {
    original: item.originalFileKey,
    machine: item.machineFileKey,
    translated: item.translatedFileKey || item.machineFileKey,
    translatedHtml: item.translatedHtmlKey || item.machineFileKey
  };
  const key = mapping[type] || mapping.original;
  if (!key) {
    throw new Error('Requested asset not available');
  }
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: RAW_BUCKET, Key: key }), { expiresIn: 900 });
  return { url, key };
}

exports.handler = async (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false;

  if (event?.requestContext?.http?.method === 'OPTIONS') {
    return ok(200, { ok: true }, callback);
  }

  const method = event?.requestContext?.http?.method || event?.httpMethod || 'GET';
  const path = event?.requestContext?.http?.path || event?.resource || '';
  const ownerId = ownerFrom(event);
  const reviewer = reviewerFrom(event);

  try {
    console.log('translations handler request', { method, path, ownerId, query: event?.queryStringParameters, bodyLength: event?.body ? String(event.body).length : 0 });
    if (method === 'POST' && path.endsWith('/translations/upload-url')) {
      const body = parseBody(event);
      console.log('generate upload url', { ownerId, filename: body.filename, contentType: body.contentType });
      const result = await generateUploadUrl(body, ownerId);
      return ok(200, result, callback);
    }

    if (method === 'POST' && path.endsWith('/translations')) {
      const body = parseBody(event);
      console.log('create translation request', { ownerId, translationId: body.translationId, fileKey: body.fileKey });
      const item = await createTranslation(body, ownerId, reviewer);
      return ok(201, item, callback);
    }

    if (method === 'GET' && path.endsWith('/translations')) {
      console.log('list translations', { ownerId });
      const items = await listTranslations(ownerId);
      return ok(200, { items }, callback);
    }

    const match = path.match(/\/translations\/(\w[\w-]+)/);
    if (!match) {
      return ok(404, { message: 'Not found' }, callback);
    }
    const translationId = match[1];

    if (method === 'GET' && path.endsWith('/chunks')) {
      const item = await getTranslation(translationId, ownerId);
      if (!item?.chunkFileKey) {
        return ok(404, { message: 'No chunks found' }, callback);
      }
      console.log('fetching chunks', { translationId, chunkFileKey: item.chunkFileKey });
      const chunkData = await loadChunks(item.chunkFileKey);
      return ok(200, chunkData, callback);
    }

    if (method === 'PUT' && path.endsWith('/chunks')) {
      console.log('update chunks', { translationId });
      const data = await handleChunkUpdate(event, translationId, ownerId, reviewer);
      return ok(200, data, callback);
    }

    if (method === 'POST' && path.endsWith('/approve')) {
      console.log('approve translation', { translationId });
      const result = await handleApprove(translationId, ownerId, reviewer);
      return ok(200, result, callback);
    }

    if (method === 'GET' && path.endsWith('/download')) {
      const type = event?.queryStringParameters?.type || 'original';
      console.log('download request', { translationId, type });
      const res = await handleDownload(translationId, ownerId, type);
      return ok(200, res, callback);
    }

    if (method === 'GET') {
      const item = await getTranslation(translationId, ownerId);
      if (!item) {
        return ok(404, { message: 'Not found' }, callback);
      }
      return ok(200, item, callback);
    }

    if (method === 'PUT') {
      const body = parseBody(event);
      const patch = {};
      if (body.title) patch.title = body.title;
      if (body.description) patch.description = body.description;
      await updateTranslation(translationId, ownerId, patch);
      const updated = await getTranslation(translationId, ownerId);
      return ok(200, updated, callback);
    }

    return ok(405, { message: 'Method not allowed' }, callback);
  } catch (error) {
    console.error('translations handler error', error);
    return ok(500, { message: error.message || 'Server error' }, callback);
  }
};
