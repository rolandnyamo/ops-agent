import Link from 'next/link';
import { useRouter } from 'next/router';
import React from 'react';

const tabs = [
  { href: '/', label: 'Dashboard' },
  { href: '/setup', label: 'Setup' },
  { href: '/ingest', label: 'Ingest' },
  { href: '/bot', label: 'Bot' },
];

export default function Layout({ children }: { children: React.ReactNode }){
  const { pathname } = useRouter();
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
          <div style={{marginLeft:'auto'}} className="pill mini">summer ⇄ fall</div>
        </div>
      </nav>
      <header className="hero">
        <div className="container">
          <h1 style={{margin:'18px 0 6px 0'}}>Admin</h1>
          <div className="muted">Threads + Apple vibe, calm and crisp.</div>
        </div>
      </header>
      <main className="container" style={{paddingTop:18}}>
        {children}
      </main>
    </div>
  );
}

