exports.handler = async (_event) => {
  // Placeholder: fetch settings from DynamoDB later
  return { statusCode: 200, body: JSON.stringify({ name: 'Single Tenant', confidenceThreshold: 0.45 }) };
};
