const { validateBotApiKey } = require('../bots');

exports.handler = async (event) => {
  try {
    const headers = Object.fromEntries(
      Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
    );
    
    const botApiKey = headers['x-bot-api-key'];
    if (!botApiKey) {
      return { isAuthorized: false };
    }

    // Validate the bot API key
    const botInfo = await validateBotApiKey(botApiKey);
    if (!botInfo || botInfo.status !== 'active') {
      return { isAuthorized: false };
    }

    // Extract agent ID from bot info for context
    const agentId = botInfo.PK.replace('AGENT#', '');
    
    return { 
      isAuthorized: true,
      context: {
        botId: botInfo.botId,
        agentId: agentId,
        siteUrl: botInfo.siteUrl,
        platform: botInfo.platform
      }
    };
  } catch (e) {
    console.error('BotAuth error', e);
    return { isAuthorized: false };
  }
};
