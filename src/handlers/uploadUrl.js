const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('node:crypto');

const s3 = new S3Client({});
const BUCKET = process.env.RAW_BUCKET || 'ops-agent-prod-raw-326445141506-us-east-1';

function parse(event){
  try { return event && event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : {}; }
  catch { return {}; }
}

exports.handler = async (event) => {
  if (!BUCKET) return { statusCode: 500, body: JSON.stringify({ message: 'RAW_BUCKET not set' }) };
  const body = parse(event);
  const filename = (body.filename || 'upload.bin').replace(/[^A-Za-z0-9._-]/g, '_');
  const contentType = body.contentType || 'application/octet-stream';
  const allow = ['text/plain','text/html','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (!allow.includes(contentType)) {
    return { statusCode: 400, body: JSON.stringify({ message: `Unsupported contentType ${contentType}` }) };
  }
  const docId = (body.docId && String(body.docId)) || crypto.randomUUID();
  const key = `raw/${docId}/${filename}`;
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 });
  console.log(`upload URL generated for docId=${docId}, key=${key}`);
  console.log(`upload URL: ${uploadUrl}`);
  console.log(`content type: ${contentType}`);
  console.log(`bucket: ${BUCKET}`);
  console.log(`key: ${key}`);
  console.log(`filename: ${filename}`);
  return { statusCode: 200, body: JSON.stringify({ docId, fileKey: key, uploadUrl, contentType }) };
};
