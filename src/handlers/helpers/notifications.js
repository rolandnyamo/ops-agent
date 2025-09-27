const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const ses = new SESClient({});
const ddb = new DynamoDBClient({});

const SETTINGS_TABLE = process.env.SETTINGS_TABLE;
const SES_SENDER = process.env.SES_SENDER || process.env.SES_FROM_ADDRESS || process.env.SES_FROM;

function now() {
  return new Date().toISOString();
}

function normalisePreferences(input = {}) {
  const defaults = {
    translation: { started: false, completed: true, failed: true },
    documentation: { started: false, completed: true, failed: true }
  };
  const out = {};
  for (const jobType of Object.keys(defaults)) {
    const base = defaults[jobType];
    const provided = input[jobType] || {};
    out[jobType] = {
      started: Boolean(provided.started ?? base.started),
      completed: Boolean(provided.completed ?? base.completed),
      failed: Boolean(provided.failed ?? base.failed)
    };
  }
  return out;
}

async function getUserNotificationPreferences(userId) {
  if (!SETTINGS_TABLE || !userId) return null;
  const key = { PK: `USER#${userId}`, SK: 'NOTIFY#v1' };
  const res = await ddb.send(new GetItemCommand({ TableName: SETTINGS_TABLE, Key: marshall(key) }));
  if (!res.Item) return null;
  const item = unmarshall(res.Item);
  return {
    userId,
    email: item.email || null,
    preferences: normalisePreferences(item.preferences || {}),
    updatedAt: item.updatedAt || null
  };
}

async function putUserNotificationPreferences({ userId, email, preferences }) {
  if (!SETTINGS_TABLE || !userId) return null;
  const item = {
    PK: `USER#${userId}`,
    SK: 'NOTIFY#v1',
    userId,
    email: email || null,
    preferences: normalisePreferences(preferences || {}),
    updatedAt: now()
  };
  await ddb.send(new PutItemCommand({ TableName: SETTINGS_TABLE, Item: marshall(item) }));
  return item;
}

async function scanNotificationPreferences() {
  if (!SETTINGS_TABLE) return [];
  const res = await ddb.send(new ScanCommand({
    TableName: SETTINGS_TABLE,
    FilterExpression: 'begins_with(#pk, :pkPrefix) AND #sk = :sk',
    ExpressionAttributeNames: {
      '#pk': 'PK',
      '#sk': 'SK'
    },
    ExpressionAttributeValues: marshall({
      ':pkPrefix': 'USER#',
      ':sk': 'NOTIFY#v1'
    })
  }));
  return (res.Items || []).map(item => unmarshall(item));
}

async function recipientsFor(jobType, status) {
  const items = await scanNotificationPreferences();
  const out = [];
  for (const item of items) {
    const prefs = normalisePreferences(item.preferences || {});
    if (prefs?.[jobType]?.[status] && item.email) {
      out.push({ email: item.email, userId: item.userId || item.PK?.replace('USER#', '') || null });
    }
  }
  return out;
}

function buildEmail({ jobType, status, fileName, jobId }) {
  const subject = `[Ops Agent] ${jobType === 'documentation' ? 'Documentation ingestion' : 'Translation'} ${status}`;
  const lines = [
    `Job type: ${jobType === 'documentation' ? 'documentation' : 'translation'}`,
    `Status: ${status}`,
    fileName ? `File: ${fileName}` : null,
    jobId ? `Job ID: ${jobId}` : null,
    `Timestamp: ${now()}`
  ].filter(Boolean);
  return { subject, body: lines.join('\n') };
}

async function sendJobNotification({ jobType, status, fileName, jobId }) {
  if (!SES_SENDER) {
    console.warn('sendJobNotification skipped - SES_SENDER not configured');
    return { sent: false, reason: 'no-sender' };
  }
  try {
    const recipients = await recipientsFor(jobType, status);
    if (!recipients.length) {
      return { sent: false, reason: 'no-recipients' };
    }
    const { subject, body } = buildEmail({ jobType, status, fileName, jobId });
    await ses.send(new SendEmailCommand({
      Destination: { ToAddresses: recipients.map(r => r.email) },
      Source: SES_SENDER,
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Text: { Data: body, Charset: 'UTF-8' } }
      }
    }));
    return { sent: true, recipients: recipients.length };
  } catch (error) {
    console.error('sendJobNotification failed', error);
    return { sent: false, error: error.message };
  }
}

module.exports = {
  getUserNotificationPreferences,
  putUserNotificationPreferences,
  recipientsFor,
  sendJobNotification,
  normalisePreferences
};

