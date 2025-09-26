const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { response } = require('./helpers/utils');
const crypto = require('node:crypto');

const s3 = new S3Client({});
const BUCKET = process.env.RAW_BUCKET || 'ops-agent-prod-raw-326445141506-us-east-1';

function parse(event){
  try { return event && event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : {}; }
  catch { return {}; }
}

exports.handler = async (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false;

  if (!BUCKET) {
    response.statusCode = 500;
    response.body = JSON.stringify({ message: 'RAW_BUCKET not set' });
    return callback(null, response);
  }
  const body = parse(event);
  const agentId = (event?.queryStringParameters?.agentId) || body.agentId || 'default';
  const filename = (body.filename || 'upload.bin').replace(/[^A-Za-z0-9._-]/g, '_');
  const contentType = body.contentType || 'application/octet-stream';
  const allow = [
    // Text formats
    'text/plain',
    'text/html',
    'text/markdown',
    'text/csv',
    'text/xml',
    // PDF
    'application/pdf',
    // Microsoft Word
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
    'application/msword', // DOC
    // Other office formats
    'application/rtf',
    'application/vnd.oasis.opendocument.text', // ODT
    // Data formats
    'application/json',
    'application/xml'
  ];
  
  if (!allow.includes(contentType)) {
    response.statusCode = 400;
    response.body = JSON.stringify({ 
      message: `Unsupported contentType ${contentType}`, 
      supportedFormats: [
        'PDF', 'Word (DOC/DOCX)', 'HTML', 'Plain Text', 'Markdown', 
        'RTF', 'ODT', 'CSV', 'XML', 'JSON'
      ]
    });
    return callback(null, response);
  }
  const docId = (body.docId && String(body.docId)) || crypto.randomUUID();
  const key = `raw/${agentId}/${docId}/${filename}`;
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 });
  console.log(`upload URL generated for agentId=${agentId}, docId=${docId}, key=${key}`);
  console.log(`upload URL: ${uploadUrl}`);
  console.log(`content type: ${contentType}`);
  console.log(`bucket: ${BUCKET}`);
  console.log(`key: ${key}`);
  console.log(`filename: ${filename}`);
  response.statusCode = 200;
  response.body = JSON.stringify({ agentId, docId, fileKey: key, uploadUrl, contentType });
  return callback(null, response);
};
