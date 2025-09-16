const { validateBotApiKey } = require('../bots');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

// Create Cognito JWT verifier
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  clientId: process.env.COGNITO_USER_POOL_CLIENT_ID,
  tokenUse: 'id'
});

// Help function to generate an IAM policy
const generatePolicy = function(principalId, effect, resource, context = {}) {
  // Required output:
  const authResponse = {};
  authResponse.principalId = principalId;
  if (effect && resource) {
    const policyDocument = {};
    policyDocument.Version = '2012-10-17'; // default version
    policyDocument.Statement = [];
    const statementOne = {};
    statementOne.Action = 'execute-api:Invoke'; // default action
    statementOne.Effect = effect;
    statementOne.Resource = resource;
    policyDocument.Statement[0] = statementOne;
    authResponse.policyDocument = policyDocument;
  }
  // Optional output with custom properties
  authResponse.context = context;
  return authResponse;
};

const generateAllow = function(principalId, resource, context = {}) {
  return generatePolicy(principalId, 'Allow', resource, context);
};

const generateDeny = function(principalId, resource) {
  return generatePolicy(principalId, 'Deny', resource);
};

exports.handler = async (event, context, callback) => {
  console.log('Bot Auth - Received event:', JSON.stringify(event, null, 2));

  try {
    // Retrieve request parameters from the Lambda function input
    const headers = event.headers || {};
    const queryStringParameters = event.queryStringParameters || {};

    // Parse the input for the parameter values
    const tmp = event.methodArn.split(':');
    const apiGatewayArnTmp = tmp[5].split('/');
    const awsAccountId = tmp[4];
    const region = tmp[3];
    const restApiId = apiGatewayArnTmp[0];
    const stage = apiGatewayArnTmp[1];
    const method = apiGatewayArnTmp[2];
    let resource = '/'; // root resource
    if (apiGatewayArnTmp[3]) {
      resource += apiGatewayArnTmp[3];
    }

    console.log('Bot Auth - Method ARN:', event.methodArn);
    console.log('Bot Auth - Resource:', resource);

    // Normalize headers to lowercase
    const normalizedHeaders = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );

    const authHeader = normalizedHeaders['authorization'];
    const botApiKey = normalizedHeaders['x-bot-api-key'] || queryStringParameters['x-bot-api-key'];

    console.log('Bot Auth - checking authentication:', {
      hasAuthHeader: !!authHeader,
      hasBotApiKey: !!botApiKey
    });

    // Option 1: Authorization header (Bearer token for admin testing)
    if (authHeader && authHeader.startsWith('Bearer ')) {
      console.log('Bot Auth - validating admin jwt');
      const token = authHeader.split(' ')[1];

      try {
        const payload = await verifier.verify(token);
        console.log('Bot Auth - valid admin token for user:', payload.sub);

        const authContext = {
          authType: 'admin',
          userId: payload.sub,
          email: payload.email || '',
          username: payload.username || payload['cognito:username'] || ''
        };

        callback(null, generateAllow(payload.sub, event.methodArn, authContext));
        return;
      } catch (err) {
        console.log('Bot Auth - invalid admin token:', err.message);
        callback(null, generateDeny('user', event.methodArn));
        return;
      }
    }

    // Option 2: Bot API Key (for external bots like WordPress)
    if (botApiKey) {
      console.log('Bot Auth - validating bot API key');
      try {
        const botInfo = await validateBotApiKey(botApiKey);
        if (!botInfo || botInfo.status !== 'active') {
          console.log('Bot Auth - invalid or inactive bot API key');
          callback(null, generateDeny('bot', event.methodArn));
          return;
        }

        const agentId = botInfo.PK.replace('AGENT#', '');
        
        const authContext = {
          authType: 'bot',
          botId: botInfo.botId,
          agentId: agentId,
          siteUrl: botInfo.siteUrl || '',
          platform: botInfo.platform || ''
        };

        console.log('Bot Auth - valid bot API key for agent:', agentId);
        callback(null, generateAllow(botInfo.botId, event.methodArn, authContext));
        return;
      } catch (err) {
        console.log('Bot Auth - error validating bot API key:', err.message);
        callback(null, generateDeny('bot', event.methodArn));
        return;
      }
    }

    console.log('Bot Auth - no valid authentication found');
    callback(null, generateDeny('anonymous', event.methodArn));

  } catch (e) {
    console.error('Bot Auth - error:', e);
    callback(null, generateDeny('error', event.methodArn));
  }
};
