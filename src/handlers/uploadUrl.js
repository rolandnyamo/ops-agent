const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('node:crypto');

const s3 = new S3Client({});
const BUCKET = process.env.RAW_BUCKET;

function parse(event){
  try { return event && event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : {}; }
  catch { return {}; }
}

exports.handler = async (event) => {
  if (!BUCKET) return { statusCode: 500, body: JSON.stringify({ message: 'RAW_BUCKET not set' }) };
  const body = parse(event);
  const filename = (body.filename || 'upload.bin').replace(/[^A-Za-z0-9._-]/g, '_');
  const contentType = body.contentType || 'application/octet-stream';
  const docId = (body.docId && String(body.docId)) || crypto.randomUUID();
  const key = `raw/${docId}/${filename}`;
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 });
  return { statusCode: 200, body: JSON.stringify({ docId, fileKey: key, uploadUrl, contentType }) };
};
