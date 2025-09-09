import Layout from '../../../components/Layout';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useApp } from '../../../context/AppContext';
import { AgentDetailsSkeleton } from '../../../components/Skeletons';
import AgentChat from '../../../components/AgentChat';
import { deleteAgent } from '../../../lib/api';

export default function AgentDetail(){
  const { query, push } = useRouter();
  const agentId = String(query.id || '');
  const { getAgentById, loadAgentDetails, isAgentLoading, setCurrentAgent, refreshAgentDetails } = useApp();
  const [error, setError] = useState<string|undefined>();
  const [deleting, setDeleting] = useState(false);
  
  const agent = getAgentById(agentId);
  const loading = isAgentLoading(agentId);

  useEffect(()=>{
    if (!agentId) return;
    setCurrentAgent(agentId);
    loadAgentDetails(agentId).catch(() => setError('Failed to load agent'));
    // Silent background refresh after initial load
    setTimeout(() => { refreshAgentDetails(agentId); }, 500);
  },[agentId]);

  async function onDelete(){
    if (deleting || !confirm(`Delete agent "${agent?.settings?.agentName || agentId}"? This will delete all settings and associated data. This cannot be undone.`)) return;
    
    setDeleting(true); setError(undefined);
    try{ 
      await deleteAgent(agentId); 
      await push('/');
    }
    catch(e:any){ 
      setError('Delete failed'); 
      setDeleting(false);
    }
  }

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
      
      <div className="grid cols-2" style={{ marginBottom: 24 }}>
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
          
          <div style={{marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)'}}>
            <button 
              onClick={onDelete}
              disabled={deleting}
              className="btn ghost"
              style={{
                color: 'var(--danger)',
                borderColor: 'rgba(220,38,38,.3)',
                fontSize: '14px'
              }}
            >
              {deleting ? 'Deleting...' : 'Delete Agent'}
            </button>
            <div className="muted mini" style={{marginTop:4}}>Permanently delete this agent and all associated data.</div>
          </div>
        </div>
      </div>
      
      {/* Chat Component */}
      <AgentChat agentId={agentId} />
    </Layout>
  );
}

