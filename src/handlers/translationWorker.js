const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { prepareTranslationDocument, assembleHtmlDocument } = require('./helpers/documentParser');
const { getTranslationEngine } = require('./helpers/translationEngine');

const s3 = new S3Client({});
const ddb = new DynamoDBClient({});

const RAW_BUCKET = process.env.RAW_BUCKET;
const DOCS_TABLE = process.env.DOCS_TABLE;

function now() {
  return new Date().toISOString();
}

async function readObject(bucket, key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buffer = Buffer.from(await res.Body.transformToByteArray());
  const contentType = res.ContentType || undefined;
  return { buffer, contentType };
}

async function putObject(bucket, key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

async function getTranslationItem(translationId, ownerId = 'default') {
  const key = { PK: `TRANSLATION#${translationId}`, SK: `TRANSLATION#${ownerId}` };
  const res = await ddb.send(new GetItemCommand({ TableName: DOCS_TABLE, Key: marshall(key) }));
  if (!res.Item) {
    throw new Error(`Translation ${translationId} not found`);
  }
  return unmarshall(res.Item);
}

async function updateTranslationItem(translationId, ownerId = 'default', patch) {
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

exports.handler = async (event) => {
  const detail = event?.detail || {};
  const translationId = detail.translationId;
  const ownerId = detail.ownerId || 'default';
  if (!translationId) {
    console.warn('translationWorker invoked without translationId');
    return;
  }

  try {
    const item = await getTranslationItem(translationId, ownerId);
    const originalKey = item.originalFileKey;
    if (!RAW_BUCKET || !originalKey) {
      throw new Error('Missing RAW_BUCKET or original file key');
    }

    await updateTranslationItem(translationId, ownerId, { status: 'PROCESSING' });

    const { buffer, contentType } = await readObject(RAW_BUCKET, originalKey);

    const document = await prepareTranslationDocument({
      buffer,
      contentType,
      filename: item.originalFilename || originalKey.split('/').pop() || 'document'
    });

    const engine = await getTranslationEngine();
    const translations = await engine.translate(document.chunks, {
      sourceLanguage: item.sourceLanguage || 'auto',
      targetLanguage: item.targetLanguage || 'en'
    });

    const chunks = document.chunks.map(chunk => {
      const translated = translations.find(t => t.id === chunk.id) || {};
      return {
        id: chunk.id,
        order: chunk.order,
        sourceHtml: chunk.sourceHtml,
        sourceText: chunk.sourceText,
        machineHtml: translated.translatedHtml || chunk.sourceHtml,
        reviewerHtml: null,
        provider: translated.provider || engine.name,
        model: translated.model || engine.model,
        lastUpdatedBy: 'machine',
        lastUpdatedAt: now()
      };
    });

    const chunksPayload = JSON.stringify({
      translationId,
      generatedAt: now(),
      sourceLanguage: item.sourceLanguage,
      targetLanguage: item.targetLanguage,
      provider: engine.name,
      model: engine.model,
      headHtml: document.headHtml,
      chunks
    });

    const chunkKey = `translations/chunks/${ownerId}/${translationId}.json`;
    await putObject(RAW_BUCKET, chunkKey, chunksPayload, 'application/json');

    const machineHtml = assembleHtmlDocument({
      headHtml: document.headHtml,
      chunks
    });
    const machineKey = `translations/machine/${ownerId}/${translationId}.html`;
    await putObject(RAW_BUCKET, machineKey, machineHtml, 'text/html');

    await updateTranslationItem(translationId, ownerId, {
      status: 'READY_FOR_REVIEW',
      chunkFileKey: chunkKey,
      machineFileKey: machineKey,
      totalChunks: chunks.length,
      translatedAt: now(),
      provider: engine.name,
      model: engine.model
    });
  } catch (error) {
    console.error('translationWorker failed', error);
    try {
      await updateTranslationItem(translationId, ownerId, {
        status: 'FAILED',
        errorMessage: error.message || 'Translation failed'
      });
    } catch (inner) {
      console.error('Failed to update translation status after error', inner);
    }
  }
};
