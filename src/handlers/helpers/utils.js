const corsHeaders = () => {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization,content-type,access-control-allow-origin,x-bot-signature,x-bot-timestamp,x-bot-api-key',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  };
};

const response = {
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    ...corsHeaders()
  },
  isBase64Encoded: false,
  body: JSON.stringify({ message: ''})
};
module.exports = {
  corsHeaders,
  response
};
