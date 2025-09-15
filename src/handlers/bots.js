const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, UpdateCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { response } = require('./helpers/utils');
const crypto = require('crypto');

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.SETTINGS_TABLE;

/**
 * Generate a secure API key for bot authentication
 */
function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a unique bot ID
 */
function generateBotId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Validate bot data
 */
function validateBotData(data) {
  const errors = [];

  if (!data.botName || typeof data.botName !== 'string' || data.botName.trim().length < 1) {
    errors.push('Bot name is required');
  }

  if (!data.platform || !['wordpress', 'generic'].includes(data.platform)) {
    errors.push('Platform must be wordpress or generic');
  }

  if (!data.siteUrl || typeof data.siteUrl !== 'string') {
    errors.push('Site URL is required');
  } else {
    try {
      new URL(data.siteUrl);
    } catch (e) {
      errors.push('Site URL must be a valid URL');
    }
  }

  return errors;
}

/**
 * Create a new bot for an agent
 */
async function createBot(agentId, botData) {
  const errors = validateBotData(botData);
  if (errors.length > 0) {
    throw new Error(`Validation errors: ${errors.join(', ')}`);
  }

  const botId = generateBotId();
  const apiKey = generateApiKey();
  const now = new Date().toISOString();

  const bot = {
    PK: `AGENT#${agentId}`,
    SK: `BOT#${botId}`,
    botId,
    botName: botData.botName.trim(),
    platform: botData.platform,
    siteUrl: botData.siteUrl.trim(),
    apiKey,
    status: 'active',
    createdAt: now,
    lastUsed: null,
    configuration: {
      theme: 'light',
      position: 'bottom-right',
      primaryColor: '#007cba',
      welcomeMessage: 'Hi! How can I help you today?'
    }
  };

  await dynamo.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: bot
  }));

  return bot;
}

/**
 * List all bots for an agent
 */
async function listBots(agentId) {
  const result = await dynamo.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `AGENT#${agentId}`,
      ':sk': 'BOT#'
    }
  }));

  return result.Items || [];
}

/**
 * Get a specific bot
 */
async function getBot(agentId, botId) {
  const result = await dynamo.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `AGENT#${agentId}`,
      SK: `BOT#${botId}`
    }
  }));

  return result.Item || null;
}

/**
 * Update a bot
 */
async function updateBot(agentId, botId, updates) {
  const bot = await getBot(agentId, botId);
  if (!bot) {
    throw new Error('Bot not found');
  }

  // Validate updates
  const updateData = { ...bot, ...updates };
  const errors = validateBotData(updateData);
  if (errors.length > 0) {
    throw new Error(`Validation errors: ${errors.join(', ')}`);
  }

  const allowedUpdates = ['botName', 'siteUrl', 'status', 'configuration'];
  const updateExpression = [];
  const expressionAttributeValues = {};
  const expressionAttributeNames = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedUpdates.includes(key)) {
      updateExpression.push(`#${key} = :${key}`);
      expressionAttributeValues[`:${key}`] = value;
      expressionAttributeNames[`#${key}`] = key;
    }
  }

  if (updateExpression.length === 0) {
    return bot;
  }

  await dynamo.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `AGENT#${agentId}`,
      SK: `BOT#${botId}`
    },
    UpdateExpression: `SET ${updateExpression.join(', ')}`,
    ExpressionAttributeValues: expressionAttributeValues,
    ExpressionAttributeNames: expressionAttributeNames
  }));

  return await getBot(agentId, botId);
}

/**
 * Delete a bot
 */
async function deleteBot(agentId, botId) {
  await dynamo.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `AGENT#${agentId}`,
      SK: `BOT#${botId}`
    }
  }));

  return true;
}

/**
 * Get all bots for all agents (for dashboard)
 */
async function getAllBots() {
  const result = await dynamo.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':sk': 'BOT#'
    }
  }));

  return result.Items || [];
}

/**
 * Validate bot API key and return bot info
 */
async function validateBotApiKey(apiKey) {
  // Scan for bot with this API key
  const result = await dynamo.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'apiKey = :apiKey AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':apiKey': apiKey,
      ':sk': 'BOT#'
    }
  }));

  if (result.Items && result.Items.length > 0) {
    const bot = result.Items[0];

    // Update last used timestamp
    await dynamo.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: bot.PK,
        SK: bot.SK
      },
      UpdateExpression: 'SET lastUsed = :now',
      ExpressionAttributeValues: {
        ':now': new Date().toISOString()
      }
    }));

    return bot;
  }

  return null;
}

/**
 * Main Lambda handler
 */
exports.handler = async (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false;

  // Handle CORS preflight
  if ((event.httpMethod || event?.requestContext?.http?.method) === 'OPTIONS') {
    response.statusCode = 204;
    response.body = '';
    return callback(null, response);
  }

  // Handle both API Gateway and local SAM event formats
  const httpMethod = event.httpMethod || event.requestContext?.http?.method;
  const pathParameters = event.pathParameters;
  const body = event.body;
  const agentId = pathParameters?.agentId;
  const botId = pathParameters?.botId;

  console.log('Bot handler event:', { httpMethod, pathParameters, hasBody: !!body });

  try {
    switch (httpMethod) {
    case 'POST':
      console.log('POST request - agentId:', agentId, 'body:', body);
      // Create new bot
      if (!agentId) {
        response.statusCode = 400;
        response.body = JSON.stringify({ error: 'Agent ID is required' });
        return callback(null, response);
      }

      const botData = JSON.parse(body || '{}');
      console.log('Parsed bot data:', botData);
      const newBot = await createBot(agentId, botData);

      response.statusCode = 201;
      response.body = JSON.stringify(newBot);
      return callback(null, response);

    case 'GET':
      if (!agentId) {
        // Get all bots for dashboard (no agentId provided)
        const allBots = await getAllBots();
        response.statusCode = 200;
        response.body = JSON.stringify(allBots);
        return callback(null, response);
      }

      if (botId) {
        // Get specific bot
        const bot = await getBot(agentId, botId);
        if (!bot) {
          response.statusCode = 404;
          response.body = JSON.stringify({ error: 'Bot not found' });
          return callback(null, response);
        }
        response.statusCode = 200;
        response.body = JSON.stringify(bot);
        return callback(null, response);
      } else {
        // List all bots for agent
        const bots = await listBots(agentId);
        response.statusCode = 200;
        response.body = JSON.stringify(bots);
        return callback(null, response);
      }

    case 'PUT':
      // Update bot
      if (!agentId || !botId) {
        response.statusCode = 400;
        response.body = JSON.stringify({ error: 'Agent ID and Bot ID are required' });
        return callback(null, response);
      }

      const updates = JSON.parse(body || '{}');
      const updatedBot = await updateBot(agentId, botId, updates);

      response.statusCode = 200;
      response.body = JSON.stringify(updatedBot);
      return callback(null, response);

    case 'DELETE':
      // Delete bot
      if (!agentId || !botId) {
        response.statusCode = 400;
        response.body = JSON.stringify({ error: 'Agent ID and Bot ID are required' });
        return callback(null, response);
      }

      await deleteBot(agentId, botId);

      response.statusCode = 204;
      response.body = '';
      return callback(null, response);

    default:
      response.statusCode = 405;
      response.body = JSON.stringify({ error: 'Method not allowed' });
      return callback(null, response);
    }
  } catch (error) {
    console.error('Bot handler error:', error);
    response.statusCode = 500;
    response.body = JSON.stringify({ error: error.message });
    return callback(null, response);
  }
};

// Export functions for use in other handlers
module.exports = {
  createBot,
  listBots,
  getAllBots,
  getBot,
  updateBot,
  deleteBot,
  validateBotApiKey,
  handler: exports.handler
};
