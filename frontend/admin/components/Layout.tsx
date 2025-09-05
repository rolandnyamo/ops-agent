import Link from 'next/link';
import { useRouter } from 'next/router';
import React from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useAgent } from '../lib/agent';

const tabs = [
  { href: '/', label: 'Agents' },
  { href: '/bot', label: 'Bot' },
];

export default function Layout({ children }: { children: React.ReactNode }){
  const { pathname } = useRouter();
  const { signOut, user } = useAuthenticator((context) => [context.user]);
  // Route-based agents; remove global dropdown
  return (
    <div>
      <nav className="nav">
        <div className="nav-inner">
          <div className="brand"><span className="badge"/> Ops Agent</div>
          <div className="tabs">
            {tabs.map(t => (
              <Link key={t.href} href={t.href} className={`tab ${pathname === t.href ? 'active':''}`}>{t.label}</Link>
            ))}
          </div>
          <div style={{marginLeft:'auto'}} className="row">
            <div className="pill mini">{user?.signInDetails?.loginId || 'signed in'}</div>
            <button className="btn ghost" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </nav>
      <header className="hero">
        <div className="container">
          <h1 style={{margin:'18px 0 6px 0'}}>Admin</h1>
          <div className="muted">Create and manage your AI Agents.</div>
        </div>
      </header>
      <main className="container" style={{paddingTop:18}}>
        {children}
      </main>
    </div>
  );
}
