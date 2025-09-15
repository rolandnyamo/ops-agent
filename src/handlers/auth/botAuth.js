const { validateBotApiKey } = require('../bots');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

// Create Cognito JWT verifier
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  clientId: process.env.COGNITO_USER_POOL_CLIENT_ID,
  tokenUse: 'access'
});

exports.handler = async (event) => {
  try {
    const headers = Object.fromEntries(
      Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
    );

    const botApiKey = headers['x-bot-api-key'];
    const authHeader = headers['authorization'];

    console.log('Bot Auth - checking headers:', {
      hasBotApiKey: !!botApiKey,
      hasAuthHeader: !!authHeader
    });

    // Option 1: Bot API Key (for external bots like WordPress)
    if (botApiKey) {
      console.log('Bot Auth - validating bot API key');
      const botInfo = await validateBotApiKey(botApiKey);
      if (!botInfo || botInfo.status !== 'active') {
        console.log('Bot Auth - invalid or inactive bot API key');
        return { isAuthorized: false };
      }

      const agentId = botInfo.PK.replace('AGENT#', '');

      return {
        isAuthorized: true,
        context: {
          authType: 'bot',
          botId: botInfo.botId,
          agentId: agentId,
          siteUrl: botInfo.siteUrl,
          platform: botInfo.platform
        }
      };
    }

    // Option 2: Admin Access Token (for admin testing bot functionality)
    if (authHeader && authHeader.startsWith('Bearer ')) {
      console.log('Bot Auth - validating admin access token');
      const token = authHeader.split(' ')[1];

      try {
        const payload = await verifier.verify(token);
        console.log('Bot Auth - valid admin token for user:', payload.sub);

        return {
          isAuthorized: true,
          context: {
            authType: 'admin',
            userId: payload.sub,
            email: payload.email,
            username: payload.username,
            // For admin testing, we'll let the ask handler determine agentId from request body
            agentId: null
          }
        };
      } catch (err) {
        console.log('Bot Auth - invalid admin token:', err.message);
        return { isAuthorized: false };
      }
    }

    console.log('Bot Auth - no valid authentication found');
    return { isAuthorized: false };

  } catch (e) {
    console.error('BotAuth error', e);
    return { isAuthorized: false };
  }
};
