const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const s3 = new S3Client({});
const ddb = new DynamoDBClient({});

const TABLE = process.env.DOCS_TABLE || 'ops-agent-prod-docs-326445141506-us-east-1';
const BUCKET = process.env.RAW_BUCKET || 'ops-agent-prod-raw-326445141506-us-east-1';

exports.handler = async (event) => {
  console.log('viewDoc handler:', JSON.stringify(event, null, 2));

  const method = event?.requestContext?.http?.method || event?.httpMethod || 'GET';
  const docId = event?.pathParameters?.docId;

  if (method !== 'GET' || !docId) {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Method Not Allowed' })
    };
  }

  try {
    const agentId = event?.queryStringParameters?.agentId || 'default';

    // First, get the document metadata from DynamoDB
    const docKey = { PK: `DOC#${docId}`, SK: `DOC#${agentId}` };
    const docRes = await ddb.send(new GetItemCommand({ 
      TableName: TABLE, 
      Key: marshall(docKey) 
    }));

    if (!docRes.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Document not found' })
      };
    }

    const doc = unmarshall(docRes.Item);
    
    // If the document doesn't have a fileKey, it might be a URL-based document
    if (!doc.fileKey) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Document has no associated file' })
      };
    }

    // Get the actual file from S3
    try {
      const s3Response = await s3.send(new GetObjectCommand({
        Bucket: BUCKET,
        Key: doc.fileKey
      }));

      // Stream the S3 object body to a buffer
      const chunks = [];
      for await (const chunk of s3Response.Body) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Determine content type
      let contentType = s3Response.ContentType;
      if (!contentType && doc.fileKey) {
        // Infer from file extension
        const ext = doc.fileKey.toLowerCase().split('.').pop();
        const typeMap = {
          'pdf': 'application/pdf',
          'txt': 'text/plain',
          'md': 'text/markdown',
          'html': 'text/html',
          'htm': 'text/html',
          'json': 'application/json',
          'csv': 'text/csv',
          'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'png': 'image/png',
          'gif': 'image/gif',
          'webp': 'image/webp',
          'svg': 'image/svg+xml'
        };
        contentType = typeMap[ext] || 'application/octet-stream';
      }

      // Sanitize filename for HTTP header (remove non-ASCII characters)
      const sanitizedTitle = (doc.title || 'document').replace(/[^\x20-\x7E]/g, '_');

      return {
        statusCode: 200,
        headers: {
          'Content-Type': contentType || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${sanitizedTitle}"`,
          'Cache-Control': 'public, max-age=3600'
        },
        body: buffer.toString('base64'),
        isBase64Encoded: true
      };

    } catch (s3Error) {
      console.error('S3 error:', s3Error);
      
      // If the exact file isn't found, try to find any file under the document's directory
      // This handles cases where the filename might have been modified during upload
      try {
        const prefix = `raw/${agentId}/${docId}/`;
        const listResponse = await s3.send(new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: prefix,
          MaxKeys: 1
        }));

        if (listResponse.Contents && listResponse.Contents.length > 0) {
          const actualKey = listResponse.Contents[0].Key;
          
          const s3Response = await s3.send(new GetObjectCommand({
            Bucket: BUCKET,
            Key: actualKey
          }));

          const chunks = [];
          for await (const chunk of s3Response.Body) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);

          // Determine content type from actual key
          let contentType = s3Response.ContentType;
          if (!contentType && actualKey) {
            const ext = actualKey.toLowerCase().split('.').pop();
            const typeMap = {
              'pdf': 'application/pdf',
              'txt': 'text/plain',
              'md': 'text/markdown',
              'html': 'text/html',
              'htm': 'text/html',
              'json': 'application/json',
              'csv': 'text/csv',
              'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'png': 'image/png',
              'gif': 'image/gif',
              'webp': 'image/webp',
              'svg': 'image/svg+xml'
            };
            contentType = typeMap[ext] || 'application/octet-stream';
          }

          // Sanitize filename for HTTP header (remove non-ASCII characters)
          const sanitizedTitle = (doc.title || 'document').replace(/[^\x20-\x7E]/g, '_');

          return {
            statusCode: 200,
            headers: {
              'Content-Type': contentType || 'application/octet-stream',
              'Content-Disposition': `inline; filename="${sanitizedTitle}"`,
              'Cache-Control': 'public, max-age=3600'
            },
            body: buffer.toString('base64'),
            isBase64Encoded: true
          };
        }
      } catch (listError) {
        console.error('List objects error:', listError);
      }

      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Document file not found' })
      };
    }

  } catch (error) {
    console.error('viewDoc error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Internal server error' })
    };
  }
};
