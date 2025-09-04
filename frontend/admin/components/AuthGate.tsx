import dynamic from 'next/dynamic';
import React, { useEffect } from 'react';
import { ensureAmplifyConfigured } from '../lib/amplify';
import '@aws-amplify/ui-react/styles.css';

const Authenticator = dynamic(() => import('@aws-amplify/ui-react').then(m => m.Authenticator), { ssr: false });

export default function AuthGate({ children }: { children: React.ReactNode }){
  useEffect(() => { ensureAmplifyConfigured(); }, []);
  return (
    <Authenticator socialProviders={[]} loginMechanisms={[ 'email' ]} signUpAttributes={[ 'email' ]} hideSignUp={false}>
      {children}
    </Authenticator>
  );
}

