import Layout from '../../../components/Layout';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { getAgent, type AgentSettings } from '../../../lib/api';

export default function AgentDetail(){
  const { query } = useRouter();
  const agentId = String(query.id || '');
  const [settings, setSettings] = useState<AgentSettings|undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();

  useEffect(()=>{
    if (!agentId) return;
    (async()=>{
      setLoading(true); setError(undefined);
      try{ const s = await getAgent(agentId); setSettings(s); }
      catch(e:any){ setError('Failed to load agent'); }
      finally{ setLoading(false); }
    })();
  },[agentId]);

  return (
    <Layout>
      <div className="grid cols-2">
        <div className="card">
          <h3 className="card-title">{settings?.agentName || 'Agent'}</h3>
          <div className="muted mini" style={{marginBottom:8}}>ID: {agentId}</div>
          {error && <div className="chip" style={{borderColor:'#744'}}>{error}</div>}
          {loading ? <div className="muted">Loading…</div> : (
            <>
              {settings?.fallbackMessage && <div style={{marginTop:6}}>
                <div className="muted mini">Fallback Message</div>
                <div style={{marginTop:4}}>{settings.fallbackMessage}</div>
              </div>}
              {settings?.updatedAt && <div className="muted mini" style={{marginTop:12}}>Last updated: {settings.updatedAt.slice(0,19).replace('T',' ')}</div>}
            </>
          )}
        </div>
        <div className="card">
          <h3 className="card-title">Manage</h3>
          <div className="row" style={{flexWrap:'wrap', gap:10}}>
            <Link href={`/agents/${agentId}/add-content`} className="btn">Add Content</Link>
            <Link href={`/agents/${agentId}/sources`} className="btn ghost">My Sources</Link>
            <Link href={`/agents/${agentId}/setup`} className="btn ghost">Setup</Link>
          </div>
          <div className="muted mini" style={{marginTop:8}}>Add documents, review sources, and configure settings for this agent.</div>
        </div>
      </div>
    </Layout>
  );
}

