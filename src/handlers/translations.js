const { DynamoDBClient, QueryCommand, GetItemCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const HtmlDocx = require('html-docx-js');
const crypto = require('node:crypto');
const { response } = require('./helpers/utils');
const { assembleHtmlDocument } = require('./helpers/documentParser');
const { listChunks, updateChunkState, deleteAllChunks, summariseChunks } = require('./helpers/translationStore');
const { sendJobNotification } = require('./helpers/notifications');
const { appendJobLog, listJobLogs } = require('./helpers/jobLogs');
const { restartTranslation: publishTranslationRestart } = require('./helpers/jobMonitor');

const ddb = new DynamoDBClient({});
const s3 = new S3Client({});
const sqs = new SQSClient({});

const DOCS_TABLE = process.env.DOCS_TABLE;
const RAW_BUCKET = process.env.RAW_BUCKET;
const TRANSLATION_QUEUE_URL = process.env.TRANSLATION_QUEUE_URL;

function now() {
  return new Date().toISOString();
}

function parseBody(event) {
  if (!event || !event.body) {return {};}
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
    sub: claims['sub'] || null
  };
}

function actorFrom(reviewer, role = 'user') {
  if (!reviewer) {return { type: 'system', role };}
  const { email = null, name = null, sub = null } = reviewer;
  if (!email && !name && !sub) {
    return { type: 'system', role };
  }
  return {
    type: 'user',
    email,
    name,
    sub,
    role
  };
}

function actorLabel(actor) {
  if (!actor) {return null;}
  return actor.email || actor.name || actor.sub || actor.role || actor.type || null;
}

async function recordLog(entry) {
  try {
    await appendJobLog({
      jobType: 'translation',
      jobId: entry.translationId,
      ownerId: entry.ownerId,
      category: entry.category,
      stage: entry.stage,
      eventType: entry.eventType,
      status: entry.status,
      statusCode: entry.statusCode,
      message: entry.message,
      actor: entry.actor,
      metadata: entry.metadata,
      context: entry.context,
      attempt: entry.attempt,
      retryCount: entry.retryCount,
      failureReason: entry.failureReason,
      chunkProgress: entry.chunkProgress
    });
  } catch (err) {
    console.warn('translation log append failed', err?.message || err);
  }
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
    requestedByEmail: input.requestedByEmail || null,
    requestedByName: input.requestedByName || null,
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
    // PDF
    'application/pdf',
    // Microsoft Word
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
    'application/msword', // DOC
    // Text formats
    'text/plain',
    'text/html',
    'text/markdown',
    'text/csv',
    'text/xml',
    // Other office formats
    'application/rtf',
    'application/vnd.oasis.opendocument.text', // ODT
    // Data formats
    'application/json',
    'application/xml'
  ]);
  if (!allow.has(contentType)) {
    throw new Error(`Unsupported content type ${contentType}. Supported formats: PDF, Word (DOC/DOCX), HTML, Plain Text, Markdown, RTF, ODT, CSV, XML, JSON`);
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
  if (!TRANSLATION_QUEUE_URL) {
    throw new Error('TRANSLATION_QUEUE_URL not configured');
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
    requestedByEmail: requester?.email || null,
    requestedByName: requester?.name || null,
    createdAt: now()
  });

  await ddb.send(new PutItemCommand({ TableName: DOCS_TABLE, Item: marshall(item) }));
  console.log('translation created', { translationId, ownerId, originalFileKey: fileKey });

  await sqs.send(new SendMessageCommand({
    QueueUrl: TRANSLATION_QUEUE_URL,
    MessageBody: JSON.stringify({
      action: 'start',
      translationId,
      ownerId
    })
  }));

  await sendJobNotification({
    jobType: 'translation',
    status: 'started',
    fileName: filename,
    jobId: translationId,
    ownerId
  });

  await recordLog({
    translationId,
    ownerId,
    category: 'submission',
    stage: 'intake',
    eventType: 'submitted',
    status: 'PROCESSING',
    message: 'Translation request submitted',
    actor: actorFrom(requester, 'submitter'),
    metadata: {
      sourceLanguage,
      targetLanguage,
      originalFilename: filename
    }
  });

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
  if (!res.Item) {return null;}
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

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: RAW_BUCKET, Key: key }));
    return true;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || status === 400) {
      return false;
    }
    throw err;
  }
}

function normaliseChunkRecord(record) {
  return {
    id: record.chunkId,
    order: record.order,
    sourceHtml: record.sourceHtml,
    sourceText: record.sourceText,
    machineHtml: record.machineHtml,
    reviewerHtml: record.reviewerHtml || null,
    lastUpdatedBy: record.lastUpdatedBy || null,
    lastUpdatedAt: record.lastUpdatedAt || record.updatedAt || null,
    reviewerName: record.reviewerName || null,
    blockId: record.blockId || null,
    assetAnchors: record.assetAnchors || []
  };
}

async function fetchChunkState(item, ownerId) {
  const records = await listChunks(item.translationId, ownerId);
  if (!records.length) {return null;}
  const sorted = records.sort((a, b) => (a.order || 0) - (b.order || 0));
  return sorted.map(normaliseChunkRecord);
}

function buildChunkPayload(item, chunks) {
  return {
    translationId: item.translationId,
    generatedAt: now(),
    sourceLanguage: item.sourceLanguage,
    targetLanguage: item.targetLanguage,
    provider: item.provider || null,
    model: item.model || null,
    headHtml: item.headHtml || '<head><meta charset="utf-8"/></head>',
    chunks
  };
}

async function persistChunkPayload(item, ownerId, chunks) {
  if (!RAW_BUCKET) {return;}
  const payload = buildChunkPayload(item, chunks);
  const key = item.chunkFileKey || `translations/chunks/${ownerId}/${item.translationId}.json`;
  await s3.send(new PutObjectCommand({ Bucket: RAW_BUCKET, Key: key, Body: JSON.stringify(payload), ContentType: 'application/json' }));
  if (!item.chunkFileKey) {
    await updateTranslation(item.translationId, ownerId, { chunkFileKey: key });
  }
}

async function handleChunkUpdate(event, translationId, ownerId, reviewer) {
  const body = parseBody(event);
  if (!body.chunks || !Array.isArray(body.chunks)) {
    throw new Error('chunks array required');
  }

  const item = await getTranslation(translationId, ownerId);
  if (!item) {
    const err = new Error('Translation not found');
    err.statusCode = 404;
    throw err;
  }
  if (item.status === 'APPROVED') {
    const err = new Error('Translation already approved; review is read-only');
    err.statusCode = 403;
    throw err;
  }
  if (item.status !== 'READY_FOR_REVIEW') {
    const err = new Error('Translation not ready for review');
    err.statusCode = 409;
    throw err;
  }
  const records = await listChunks(translationId, ownerId);
  if (!records.length) {
    const err = new Error('No chunk data found for translation');
    err.statusCode = 404;
    throw err;
  }
  const chunkMap = new Map(records.map(record => [record.chunkId, record]));
  const updatedAt = now();
  for (const incoming of body.chunks) {
    const record = chunkMap.get(incoming.id);
    if (!record) {continue;}
    let nextHtml = record.machineHtml;
    if (Object.prototype.hasOwnProperty.call(incoming, 'reviewerHtml')) {
      nextHtml = typeof incoming.reviewerHtml === 'string' ? incoming.reviewerHtml : record.machineHtml;
    } else if (Object.prototype.hasOwnProperty.call(incoming, 'html')) {
      nextHtml = typeof incoming.html === 'string' ? incoming.html : record.machineHtml;
    } else if (Object.prototype.hasOwnProperty.call(incoming, 'text')) {
      nextHtml = typeof incoming.text === 'string' ? incoming.text : record.machineHtml;
    }
    const updated = await updateChunkState({
      translationId,
      ownerId,
      chunkOrder: record.order,
      chunkId: record.chunkId,
      patch: {
        reviewerHtml: nextHtml,
        lastUpdatedBy: reviewer.email || reviewer.name || reviewer.sub || 'reviewer',
        lastUpdatedAt: updatedAt,
        reviewerName: reviewer.name || record.reviewerName || null
      }
    });
    if (updated?.chunkId) {
      chunkMap.set(updated.chunkId, updated);
    }
  }

  const sortedRecords = Array.from(chunkMap.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
  const normalized = sortedRecords.map(normaliseChunkRecord);
  await persistChunkPayload(item, ownerId, normalized);

  const summary = summariseChunks(sortedRecords);
  await updateTranslation(translationId, ownerId, {
    lastReviewedAt: updatedAt,
    processedChunks: summary.completed,
    failedChunks: summary.failed
  });

  await recordLog({
    translationId,
    ownerId,
    category: 'review',
    stage: 'chunk-edit',
    eventType: 'chunks-updated',
    status: 'IN_REVIEW',
    message: `Reviewer updated ${body.chunks.length} chunk(s)`,
    actor: actorFrom(reviewer, 'reviewer'),
    metadata: {
      updatedChunkIds: body.chunks.map(chunk => chunk.id)
    },
    chunkProgress: {
      completed: summary.completed,
      failed: summary.failed,
      total: summary.total
    }
  });

  return {
    headHtml: item.headHtml,
    chunks: normalized,
    lastReviewedAt: updatedAt,
    sourceLanguage: item.sourceLanguage,
    targetLanguage: item.targetLanguage
  };
}

async function handleApprove(translationId, ownerId, reviewer) {
  const item = await getTranslation(translationId, ownerId);
  if (!item) {
    throw new Error('Translation not found');
  }
  if (item.status === 'APPROVED') {
    console.log('translation already approved, skipping reprocessing', { translationId, ownerId });
    await deleteAllChunks(translationId, ownerId);
    if (item.chunkFileKey) {
      await updateTranslation(translationId, ownerId, { chunkFileKey: null });
      await deleteS3Object(item.chunkFileKey);
    }
    return {
      status: 'APPROVED',
      approvedAt: item.approvedAt,
      approvedBy: item.approvedBy,
      translatedFileKey: item.translatedFileKey,
      translatedHtmlKey: item.translatedHtmlKey,
      translatedFormat: item.translatedFormat,
      alreadyApproved: true
    };
  }
  const records = await listChunks(translationId, ownerId);
  if (!records.length) {
    throw new Error('No chunk data found for translation');
  }
  const normalized = records
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(normaliseChunkRecord);
  const finalHtml = assembleHtmlDocument({ headHtml: item.headHtml, chunks: normalized, reviewer: true });
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
    translatedHtmlKey: htmlKey,
    chunkFileKey: null
  };
  await updateTranslation(translationId, ownerId, statusPatch);
  await deleteAllChunks(translationId, ownerId);
  if (item.chunkFileKey) {
    await deleteS3Object(item.chunkFileKey);
  }
  await recordLog({
    translationId,
    ownerId,
    category: 'review',
    stage: 'approval',
    eventType: 'approved',
    status: 'APPROVED',
    message: 'Translation approved',
    actor: actorFrom(reviewer, 'reviewer'),
    metadata: {
      translatedFileKey: docxKey || htmlKey,
      translatedFormat: docxKey ? 'docx' : 'html'
    },
    chunkProgress: {
      completed: normalized.length,
      failed: 0,
      total: normalized.length
    }
  });
  return statusPatch;
}

async function handleDownload(translationId, ownerId, type, requester) {
  const item = await getTranslation(translationId, ownerId);
  if (!item) {throw new Error('Translation not found');}
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
  const exists = await objectExists(key);
  if (!exists) {
    throw Object.assign(new Error('Requested asset missing from storage'), { code: 'NotFound', key });
  }
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: RAW_BUCKET, Key: key }), { expiresIn: 900 });
  await recordLog({
    translationId,
    ownerId,
    category: 'distribution',
    stage: 'download',
    eventType: 'download-request',
    status: 'SUCCESS',
    message: `Download URL generated for ${type}`,
    actor: actorFrom(requester, 'user'),
    metadata: { key, type }
  });
  return { url, key };
}

async function deleteS3Object(key) {
  if (!key) {return;}
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: RAW_BUCKET, Key: key }));
    console.log('deleted S3 object', { key });
  } catch (err) {
    console.warn('failed to delete S3 object', { key, error: err.message });
  }
}

async function handleDelete(translationId, ownerId, reviewer) {
  const item = await getTranslation(translationId, ownerId);
  if (!item) {
    throw new Error('Translation not found');
  }

  // Delete all S3 assets associated with this translation
  const keysToDelete = [
    item.originalFileKey,
    item.machineFileKey,
    item.chunkFileKey,
    item.translatedFileKey,
    item.translatedHtmlKey
  ].filter(Boolean);

  // Also delete any files in the translation's directory
  const machinePrefix = `translations/machine/${ownerId}/${translationId}`;
  const chunksPrefix = `translations/chunks/${ownerId}/${translationId}`;
  const outputPrefix = `translations/output/${ownerId}/${translationId}`;

  // Delete specific keys
  await Promise.all(keysToDelete.map(key => deleteS3Object(key)));

  // Delete common pattern files
  await Promise.all([
    deleteS3Object(`${machinePrefix}.html`),
    deleteS3Object(`${machinePrefix}.json`),
    deleteS3Object(`${chunksPrefix}.json`),
    deleteS3Object(`${outputPrefix}.html`),
    deleteS3Object(`${outputPrefix}.docx`)
  ]);

  // Delete DynamoDB record
  await deleteAllChunks(translationId, ownerId);
  await ddb.send(new DeleteItemCommand({
    TableName: DOCS_TABLE,
    Key: marshall({ PK: `TRANSLATION#${translationId}`, SK: `TRANSLATION#${ownerId}` })
  }));

  console.log('deleted translation', { translationId, ownerId, deletedKeys: keysToDelete.length });
  await recordLog({
    translationId,
    ownerId,
    category: 'distribution',
    stage: 'cleanup',
    eventType: 'deleted',
    status: 'DELETED',
    message: 'Translation deleted',
    actor: actorFrom(reviewer, 'admin'),
    metadata: {
      deletedKeys: keysToDelete.length,
      statusBeforeDelete: item.status
    }
  });
  return { translationId, deleted: true };
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
    console.log('full event path info', {
      path,
      pathParameters: event?.pathParameters,
      rawPath: event?.rawPath,
      resource: event?.resource
    });
    if (method === 'OPTIONS') {
      return ok(200, { ok: true }, callback);
    }

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

    // Try to extract translationId from path parameters first, then fall back to regex
    let translationId = event?.pathParameters?.translationId;
    if (!translationId) {
      const match = path.match(/\/translations\/([^/]+)/);
      if (!match) {
        return ok(404, { message: 'Not found' }, callback);
      }
      translationId = match[1];
    }

    // Skip if we got the literal path parameter placeholder
    if (translationId === '{translationId}') {
      console.log('Got literal path parameter placeholder, skipping');
      return ok(404, { message: 'Translation ID not provided' }, callback);
    }

    console.log('extracted translationId', { translationId });

    if (method === 'POST' && path.endsWith('/pause')) {
      const item = await getTranslation(translationId, ownerId);
      if (!item) {
        return ok(404, { message: 'Translation not found' }, callback);
      }
      if (item.status === 'PAUSED') {
        return ok(200, { message: 'Translation already paused', status: item.status }, callback);
      }
      if (item.status === 'PAUSE_REQUESTED') {
        return ok(202, { message: 'Pause request already in progress' }, callback);
      }
      if (item.status !== 'PROCESSING') {
        return ok(409, { message: 'Translation cannot be paused from the current state' }, callback);
      }
      const actor = actorFrom(reviewer, 'admin');
      const patch = {
        status: 'PAUSE_REQUESTED',
        pauseRequestedAt: now(),
        pauseRequestedBy: actorLabel(actor),
        pauseRequestedByEmail: actor.email || null,
        pauseRequestedBySub: actor.sub || null
      };
      await updateTranslation(translationId, ownerId, patch);
      await recordLog({
        translationId,
        ownerId,
        category: 'processing-control',
        stage: 'pause',
        eventType: 'pause-requested',
        status: 'PAUSE_REQUESTED',
        message: 'Pause requested by administrator',
        actor
      });
      return ok(202, { message: 'Pause requested' }, callback);
    }

    if (method === 'POST' && path.endsWith('/resume')) {
      const item = await getTranslation(translationId, ownerId);
      if (!item) {
        return ok(404, { message: 'Translation not found' }, callback);
      }
      if (!['PAUSED', 'PAUSE_REQUESTED'].includes(item.status)) {
        return ok(409, { message: 'Translation cannot be resumed from the current state' }, callback);
      }
      const actor = actorFrom(reviewer, 'admin');
      const patch = {
        status: 'PROCESSING',
        resumedAt: now(),
        resumedBy: actorLabel(actor),
        resumedByEmail: actor.email || null,
        resumedBySub: actor.sub || null,
        pauseRequestedAt: null,
        pauseRequestedBy: null,
        pauseRequestedByEmail: null,
        pauseRequestedBySub: null,
        pausedAt: null,
        pausedBy: null,
        pausedByEmail: null,
        pausedBySub: null,
        healthCheckRetries: 0,
        healthCheckReason: null
      };
      await updateTranslation(translationId, ownerId, patch);
      await recordLog({
        translationId,
        ownerId,
        category: 'processing-control',
        stage: 'resume',
        eventType: 'resume-requested',
        status: 'PROCESSING',
        message: 'Resume requested by administrator',
        actor
      });
      await publishTranslationRestart(translationId, ownerId);
      await sendJobNotification({
        jobType: 'translation',
        status: 'resumed',
        fileName: item.originalFilename || item.title || item.translationId,
        jobId: translationId,
        ownerId
      });
      return ok(202, { message: 'Resume requested' }, callback);
    }

    if (method === 'POST' && (path.endsWith('/stop') || path.endsWith('/cancel'))) {
      const item = await getTranslation(translationId, ownerId);
      if (!item) {
        return ok(404, { message: 'Translation not found' }, callback);
      }
      if (item.status === 'CANCELLED') {
        return ok(200, { message: 'Translation already cancelled' }, callback);
      }
      if (item.status === 'CANCEL_REQUESTED') {
        return ok(202, { message: 'Cancellation already requested' }, callback);
      }
      if (!['PROCESSING', 'PAUSE_REQUESTED', 'PAUSED'].includes(item.status)) {
        return ok(409, { message: 'Translation cannot be cancelled from the current state' }, callback);
      }
      const actor = actorFrom(reviewer, 'admin');
      const body = parseBody(event);
      const patch = {
        status: 'CANCEL_REQUESTED',
        cancelRequestedAt: now(),
        cancelRequestedBy: actorLabel(actor),
        cancelRequestedByEmail: actor.email || null,
        cancelRequestedBySub: actor.sub || null,
        cancelReason: body?.reason || null
      };
      await updateTranslation(translationId, ownerId, patch);
      await recordLog({
        translationId,
        ownerId,
        category: 'processing-control',
        stage: 'cancel',
        eventType: 'cancel-requested',
        status: 'CANCEL_REQUESTED',
        message: body?.reason ? `Cancellation requested: ${body.reason}` : 'Cancellation requested by administrator',
        actor
      });
      await publishTranslationRestart(translationId, ownerId);
      return ok(202, { message: 'Cancellation requested' }, callback);
    }

    if (method === 'POST' && path.endsWith('/restart')) {
      const item = await getTranslation(translationId, ownerId);
      if (!item) {
        return ok(404, { message: 'Translation not found' }, callback);
      }
      if (!['FAILED', 'PROCESSING', 'CANCELLED'].includes(item.status)) {
        return ok(409, { message: 'Translation cannot be restarted from the current state' }, callback);
      }
      await updateTranslation(translationId, ownerId, {
        status: 'PROCESSING',
        errorMessage: null,
        errorContext: null,
        restartedAt: now(),
        healthCheckRetries: 0,
        healthCheckReason: null,
        cancelRequestedAt: null,
        cancelRequestedBy: null,
        cancelRequestedByEmail: null,
        cancelRequestedBySub: null,
        cancelReason: null
      });
      await recordLog({
        translationId,
        ownerId,
        category: 'health-monitoring',
        stage: 'manual-restart',
        eventType: 'restart-requested',
        status: 'PROCESSING',
        message: 'Manual restart requested by administrator',
        actor: actorFrom(reviewer, 'admin')
      });
      await publishTranslationRestart(translationId, ownerId);
      return ok(202, { message: 'Restart queued' }, callback);
    }

    if (method === 'GET' && path.endsWith('/logs')) {
      const item = await getTranslation(translationId, ownerId);
      if (!item) {
        return ok(404, { message: 'Translation not found' }, callback);
      }
      const limit = Number(event?.queryStringParameters?.limit) || 50;
      const nextToken = event?.queryStringParameters?.nextToken || null;
      const logs = await listJobLogs({ jobType: 'translation', jobId: translationId, limit, nextToken });
      return ok(200, logs, callback);
    }

    if (method === 'GET' && path.endsWith('/chunks')) {
      const item = await getTranslation(translationId, ownerId);
      if (!item) {
        return ok(404, { message: 'Translation not found' }, callback);
      }
      if (item.status === 'APPROVED') {
        return ok(200, {
          translationId,
          headHtml: item.headHtml,
          sourceLanguage: item.sourceLanguage,
          targetLanguage: item.targetLanguage,
          chunks: [],
          reviewLocked: true,
          message: 'Translation has been approved and chunk review is read-only.'
        }, callback);
      }
      const chunks = await fetchChunkState(item, ownerId);
      if (!chunks) {
        return ok(404, { message: 'No chunks found' }, callback);
      }
      return ok(200, {
        translationId,
        headHtml: item.headHtml,
        sourceLanguage: item.sourceLanguage,
        targetLanguage: item.targetLanguage,
        chunks,
        reviewLocked: false
      }, callback);
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
      const res = await handleDownload(translationId, ownerId, type, reviewer);
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
      if (body.title) {patch.title = body.title;}
      if (body.description) {patch.description = body.description;}
      await updateTranslation(translationId, ownerId, patch);
      const updated = await getTranslation(translationId, ownerId);
      return ok(200, updated, callback);
    }

    if (method === 'DELETE') {
      console.log('delete translation', { translationId });
      const result = await handleDelete(translationId, ownerId, reviewer);
      return ok(200, result, callback);
    }

    return ok(405, { message: 'Method not allowed' }, callback);
  } catch (error) {
    if (error?.code === 'NotFound') {
      console.warn('translations handler asset missing', { path, method, ownerId, message: error.message, key: error.key });
      return ok(404, { message: error.message || 'Asset not found', key: error.key }, callback);
    }
    if (error?.statusCode) {
      console.warn('translations handler request error', { statusCode: error.statusCode, message: error.message });
      return ok(error.statusCode, { message: error.message || 'Request failed' }, callback);
    }
    console.error('translations handler error', error);
    return ok(500, { message: error.message || 'Server error' }, callback);
  }
};
