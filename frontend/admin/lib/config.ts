export const cfg = {
  region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '',
  userPoolWebClientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_WEB_CLIENT_ID || '',
  apiBase: process.env.NEXT_PUBLIC_API_BASE || 'https://qekhbnlpti.execute-api.us-east-1.amazonaws.com/prod',
};
