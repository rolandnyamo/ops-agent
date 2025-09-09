import type { AppProps } from 'next/app';
import '../styles/globals.css';
import AuthGate from '../components/AuthGate';
import { AgentProvider } from '../lib/agent';
import { AppProvider } from '../context/AppContext';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthGate>
      <AppProvider>
        <AgentProvider>
          <Component {...pageProps} />
        </AgentProvider>
      </AppProvider>
    </AuthGate>
  );
}
