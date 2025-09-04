export const cfg = {
  region: process.env.NEXT_PUBLIC_AWS_REGION || null,
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || null,
  userPoolWebClientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_WEB_CLIENT_ID || null,
};

