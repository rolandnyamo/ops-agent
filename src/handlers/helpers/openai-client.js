const OpenAI = require('openai');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

// Cache for the OpenAI API key and client
let cachedApiKey = null;
let cachedClient = null;
let ssmClient = null;

// Initialize SSM client only when needed
function getSSMClient() {
  if (!ssmClient) {
    ssmClient = new SSMClient({});
  }
  return ssmClient;
}

// Function to get OpenAI API key from SSM or environment
async function getOpenAIApiKey() {
  if (cachedApiKey) {
    return cachedApiKey;
  }

  // First try environment variable (for local development)
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) {
    cachedApiKey = envKey;
    console.log('Using OpenAI API key from environment variable');
    return cachedApiKey;
  }

  // If no environment variable, try SSM parameter (for cloud deployment)
  console.log('No environment variable found, trying SSM parameter /openai/key');
  try {
    const ssmClient = getSSMClient();
    const command = new GetParameterCommand({
      Name: '/openai/key',
      WithDecryption: true
    });
    
    const response = await ssmClient.send(command);
    cachedApiKey = response.Parameter?.Value;
    
    if (!cachedApiKey) {
      throw new Error('SSM parameter /openai/key not found or empty');
    }
    
    console.log('Using OpenAI API key from SSM parameter /openai/key');
    return cachedApiKey;
  } catch (error) {
    console.error('Failed to retrieve OpenAI API key from SSM:', error);
    throw new Error('OpenAI API key not available from environment variable or SSM parameter /openai/key');
  }
}

// Function to get OpenAI client (cached)
async function getOpenAIClient() {
  if (!cachedClient) {
    const apiKey = await getOpenAIApiKey();
    cachedClient = new OpenAI({ apiKey });
  }
  return cachedClient;
}

module.exports = {
  getOpenAIApiKey,
  getOpenAIClient
};
