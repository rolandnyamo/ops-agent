const corsHeaders = () => {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-BOT-API-KEY,X-Bot-Signature,X-Bot-Timestamp',
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
