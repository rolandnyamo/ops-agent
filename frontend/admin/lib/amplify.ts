import { Amplify } from 'aws-amplify';
import { cfg } from './config';

let configured = false;
export function ensureAmplifyConfigured(){
  if (configured) return;
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: cfg.userPoolId,
        userPoolClientId: cfg.userPoolWebClientId,
        loginWith: { email: true },
      }
    }
  });
  configured = true;
}
