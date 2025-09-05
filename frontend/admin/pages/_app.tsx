import type { AppProps } from 'next/app';
import '../styles/globals.css';
import AuthGate from '../components/AuthGate';
import { AgentProvider } from '../lib/agent';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthGate>
      <AgentProvider>
        <Component {...pageProps} />
      </AgentProvider>
    </AuthGate>
  );
}
