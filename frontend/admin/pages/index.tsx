import Layout from '../components/Layout';
import ChatPanel from '../components/ChatPanel';
import Link from 'next/link';

export default function Home(){
  return (
    <Layout>
      <div className="grid cols-2">
        <div className="card">
          <h3 className="card-title">Quick Start</h3>
          <p className="muted">Set up your agent in minutes.</p>
          <div className="row" style={{marginTop:12, flexWrap:'wrap', gap:10}}>
            <Link href="/setup" className="btn">Initial Setup</Link>
            <Link href="/sources" className="btn ghost">Add Content</Link>
            <Link href="/bot" className="btn ghost">Bot Integration</Link>
          </div>
        </div>
        <ChatPanel/>
      </div>
    </Layout>
  );
}
