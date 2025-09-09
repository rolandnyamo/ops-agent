import dynamic from 'next/dynamic';
import React, { useEffect } from 'react';
import { ensureAmplifyConfigured } from '../lib/amplify';
import '@aws-amplify/ui-react/styles.css';

const Authenticator = dynamic(() => import('@aws-amplify/ui-react').then(m => m.Authenticator), { ssr: false });

export default function AuthGate({ children }: { children: React.ReactNode }){
  useEffect(() => { ensureAmplifyConfigured(); }, []);
  return (
    <Authenticator 
      socialProviders={[]} 
      loginMechanisms={['email']} 
      signUpAttributes={['email']} 
      hideSignUp={true}
      components={{
        SignIn: {
          Header() {
            return (
              <div style={{
                textAlign: 'center' as const,
                marginBottom: '30px'
              }}>
                <h1 style={{
                  margin: '0 0 10px 0',
                  fontSize: '28px',
                  fontWeight: '700',
                  color: '#333'
                }}>
                  Ops Agent
                </h1>
                <p style={{
                  margin: '0',
                  color: '#666',
                  fontSize: '16px'
                }}>
                  Admin Portal
                </p>
              </div>
            );
          },
          Footer() {
            return (
              <div style={{ 
                textAlign: 'center' as const, 
                marginTop: '20px',
                fontSize: '14px',
                color: '#888'
              }}>
                Contact your administrator for access
              </div>
            );
          }
        }
      }}
    >
      {children}
    </Authenticator>
  );
}

