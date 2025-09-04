import crypto from 'node:crypto';

export const handler = async (event) => {
  const body = event?.body && typeof event.body === 'string' ? JSON.parse(event.body) : event?.body || {};
  const title = body?.title;
  if (!title) return { statusCode: 400, body: JSON.stringify({ message: 'title is required' }) };

  const docId = crypto.randomUUID();
  // Placeholder: write doc metadata to DynamoDB and raw to S3

  return { statusCode: 202, body: JSON.stringify({ ok: true, docId }) };
};

