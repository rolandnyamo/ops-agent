const { PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { assetStorageKey } = require('./assets');

function now() {
  return new Date().toISOString();
}

async function ensureS3Object({ s3, bucket, key, body, contentType }) {
  if (!s3 || !bucket || !key) return null;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { bucket, key, uploaded: false };
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status !== 404 && status !== 400) {
      throw err;
    }
  }
  if (!body) {
    return { bucket, key: null, uploaded: false };
  }
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return { bucket, key, uploaded: true };
}

function clean(obj) {
  const copy = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined) continue;
    copy[key] = value;
  }
  return copy;
}

async function upsertAssetMetadata({ ddb, tableName, translationId, ownerId, asset, bucket, key }) {
  if (!ddb || !tableName) return null;
  const timestamp = now();
  const bytes = asset.bytes ?? (asset.buffer ? asset.buffer.length : 0);
  const values = clean({
    ':updatedAt': timestamp,
    ':createdAt': timestamp,
    ':assetId': asset.assetId,
    ':mime': asset.mime,
    ':bytes': bytes,
    ':widthPx': asset.widthPx ?? null,
    ':heightPx': asset.heightPx ?? null,
    ':keep': Boolean(asset.keepOriginalLanguage),
    ':labels': Array.isArray(asset.labels) ? asset.labels : [],
    ':altText': asset.altText ? { source: asset.altText } : {},
    ':caption': asset.caption ? { source: asset.caption } : {},
    ':s3Bucket': bucket || null,
    ':s3Key': key || null,
    ':originalName': asset.originalName || null,
  });
  const names = {
    '#updatedAt': 'updatedAt',
    '#createdAt': 'createdAt',
    '#assetId': 'assetId',
    '#mime': 'mime',
    '#bytes': 'bytes',
    '#widthPx': 'widthPx',
    '#heightPx': 'heightPx',
    '#keep': 'keepOriginalLanguage',
    '#labels': 'labels',
    '#altText': 'altText',
    '#caption': 'caption',
    '#s3Bucket': 's3Bucket',
    '#s3Key': 's3Key',
    '#originalName': 'originalName'
  };
  const sets = [
    '#updatedAt = :updatedAt',
    '#createdAt = if_not_exists(#createdAt, :createdAt)',
    '#assetId = if_not_exists(#assetId, :assetId)',
    '#mime = if_not_exists(#mime, :mime)',
    '#bytes = if_not_exists(#bytes, :bytes)',
    '#widthPx = if_not_exists(#widthPx, :widthPx)',
    '#heightPx = if_not_exists(#heightPx, :heightPx)',
    '#keep = if_not_exists(#keep, :keep)',
    '#labels = if_not_exists(#labels, :labels)',
    '#altText = if_not_exists(#altText, :altText)',
    '#caption = if_not_exists(#caption, :caption)',
    '#s3Bucket = :s3Bucket',
    '#s3Key = :s3Key',
    '#originalName = if_not_exists(#originalName, :originalName)'
  ];

  await ddb.send(new UpdateItemCommand({
    TableName: tableName,
    Key: marshall({
      PK: `TRANSLATION#${translationId}`,
      SK: `ASSET#${asset.assetId}`
    }),
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(values),
  }));

  return {
    assetId: asset.assetId,
    mime: asset.mime,
    bytes,
    widthPx: asset.widthPx || null,
    heightPx: asset.heightPx || null,
    keepOriginalLanguage: Boolean(asset.keepOriginalLanguage),
    altText: asset.altText || '',
    caption: asset.caption || null,
    s3Bucket: bucket || null,
    s3Key: key || null,
    originalName: asset.originalName || null
  };
}

async function upsertAnchorMetadata({ ddb, tableName, translationId, ownerId, anchor, sequence }) {
  if (!ddb || !tableName) return null;
  const timestamp = now();
  const values = clean({
    ':updatedAt': timestamp,
    ':createdAt': timestamp,
    ':anchorId': anchor.anchorId,
    ':assetId': anchor.assetId,
    ':blockId': anchor.blockId || null,
    ':chunkOrder': anchor.order ?? null,
    ':beforeSpanId': anchor.beforeSpanId || null,
    ':afterSpanId': anchor.afterSpanId || null,
    ':textWindowHash': anchor.textWindowHash || null,
    ':captionRef': anchor.captionRef || null,
    ':style': clean({
      align: anchor.style?.align || null,
      widthPx: anchor.style?.widthPx ?? null
    }),
    ':sequence': typeof sequence === 'number' ? sequence : anchor.sequence || 0
  });
  const names = {
    '#updatedAt': 'updatedAt',
    '#createdAt': 'createdAt',
    '#anchorId': 'anchorId',
    '#assetId': 'assetId',
    '#blockId': 'blockId',
    '#chunkOrder': 'chunkOrder',
    '#beforeSpanId': 'beforeSpanId',
    '#afterSpanId': 'afterSpanId',
    '#textWindowHash': 'textWindowHash',
    '#captionRef': 'captionRef',
    '#style': 'style',
    '#sequence': 'sequence'
  };
  const sets = [
    '#updatedAt = :updatedAt',
    '#createdAt = if_not_exists(#createdAt, :createdAt)',
    '#anchorId = if_not_exists(#anchorId, :anchorId)',
    '#assetId = :assetId',
    '#blockId = :blockId',
    '#chunkOrder = :chunkOrder',
    '#beforeSpanId = :beforeSpanId',
    '#afterSpanId = :afterSpanId',
    '#textWindowHash = :textWindowHash',
    '#captionRef = :captionRef',
    '#style = :style',
    '#sequence = :sequence'
  ];

  await ddb.send(new UpdateItemCommand({
    TableName: tableName,
    Key: marshall({
      PK: `TRANSLATION#${translationId}`,
      SK: `ANCHOR#${anchor.anchorId}`
    }),
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(values)
  }));

  return {
    anchorId: anchor.anchorId,
    assetId: anchor.assetId,
    blockId: anchor.blockId || null,
    chunkOrder: anchor.order ?? null,
    beforeSpanId: anchor.beforeSpanId || null,
    afterSpanId: anchor.afterSpanId || null,
    textWindowHash: anchor.textWindowHash || null,
    captionRef: anchor.captionRef || null,
    style: anchor.style || {},
    sequence: typeof sequence === 'number' ? sequence : anchor.sequence || 0
  };
}

async function persistAssetsAndAnchors({
  s3,
  ddb,
  bucket,
  tableName,
  translationId,
  ownerId = 'default',
  assets = [],
  anchors = []
}) {
  if (!translationId) {
    throw new Error('translationId is required to persist assets');
  }
  const storedAssets = [];
  const storedAnchors = [];
  for (const asset of assets) {
    const hash = String(asset.assetId || '').replace(/^sha256:/, '');
    const filename = asset.originalName || `${hash.slice(0, 12)}`;
    const key = assetStorageKey(asset.assetId || hash, filename);
    if (bucket && asset.buffer) {
      await ensureS3Object({
        s3,
        bucket,
        key,
        body: asset.buffer,
        contentType: asset.mime || 'application/octet-stream'
      });
    }
    const metadata = await upsertAssetMetadata({
      ddb,
      tableName,
      translationId,
      ownerId,
      asset,
      bucket,
      key: asset.buffer ? key : null
    });
    if (metadata) {
      storedAssets.push(metadata);
    }
  }

  let anchorSeq = 0;
  for (const anchor of anchors) {
    const metadata = await upsertAnchorMetadata({
      ddb,
      tableName,
      translationId,
      ownerId,
      anchor,
      sequence: anchor.sequence ?? anchorSeq
    });
    anchorSeq += 1;
    if (metadata) {
      storedAnchors.push(metadata);
    }
  }

  return { assets: storedAssets, anchors: storedAnchors };
}

module.exports = {
  persistAssetsAndAnchors,
};
