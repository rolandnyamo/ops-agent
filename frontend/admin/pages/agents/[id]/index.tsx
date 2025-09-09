import Layout from '../../../components/Layout';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useApp } from '../../../context/AppContext';
import { AgentDetailsSkeleton } from '../../../components/Skeletons';

export default function AgentDetail(){
  const { query } = useRouter();
  const agentId = String(query.id || '');
  const { getAgentById, loadAgentDetails, isAgentLoading, setCurrentAgent, refreshAgentDetails } = useApp();
  const [error, setError] = useState<string|undefined>();
  
  const agent = getAgentById(agentId);
  const loading = isAgentLoading(agentId);

  useEffect(()=>{
    if (!agentId) return;
    setCurrentAgent(agentId);
    loadAgentDetails(agentId).catch(() => setError('Failed to load agent'));
    // Silent background refresh after initial load
    setTimeout(() => { refreshAgentDetails(agentId); }, 500);
  },[agentId]);

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <Link 
          href="/" 
          className="btn" 
          style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            textDecoration: 'none',
            fontSize: '14px',
            padding: '8px 16px'
          }}
        >
          ← Back to Agents
        </Link>
      </div>
      
      <div className="grid cols-2">
        <div className="card">
          <h3 className="card-title">{agent?.settings?.agentName || agent?.name || 'Agent'}</h3>
          <div className="muted mini" style={{marginBottom:8}}>ID: {agentId}</div>
          {error && <div className="chip" style={{borderColor:'#744'}}>{error}</div>}
          {loading ? (
            <AgentDetailsSkeleton />
          ) : (
            <>
              {agent?.settings?.fallbackMessage && <div style={{marginTop:6}}>
                <div className="muted mini">Fallback Message</div>
                <div style={{marginTop:4}}>{agent.settings.fallbackMessage}</div>
              </div>}
              {agent?.settings?.updatedAt && <div className="muted mini" style={{marginTop:12}}>Last updated: {agent.settings.updatedAt.slice(0,19).replace('T',' ')}</div>}
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

