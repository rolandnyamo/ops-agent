import Layout from '../components/Layout';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useApp } from '../context/AppContext';
import { AgentCardSkeleton } from '../components/Skeletons';
import CreateAgentModal from '../components/CreateAgentModal';

export default function Home(){
  const router = useRouter();
  const { state, loadAgents, forceRefreshAgents } = useApp();
  const [error, setError] = useState<string|undefined>();
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadAgents().catch(() => setError('Failed to load agents'));
  }, []);

  const handleAgentCreated = async (agentId: string) => {
    setShowCreateModal(false);
    // Force refresh the agents list to include the new agent
    await forceRefreshAgents();
    await router.push(`/agents/${encodeURIComponent(agentId)}`);
  };

  return (
    <Layout>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>Your Agents</h3>
            <div className="muted mini" style={{ marginTop: 4 }}>
              {state.agentsLoading ? 'Loading...' : `${state.agents.length} agent${state.agents.length !== 1 ? 's' : ''}`}
            </div>
          </div>
          <button 
            className="btn" 
            onClick={() => setShowCreateModal(true)}
          >
            Add Agent
          </button>
        </div>

        {error && <div className="chip" style={{borderColor:'#744', marginBottom: 16}}>{error}</div>}
        
        {state.agentsLoading ? (
          <div className="grid cols-3" style={{gap: 16}}>
            {[...Array(6)].map((_, i) => (
              <AgentCardSkeleton key={i} />
            ))}
          </div>
        ) : state.agents.length === 0 ? (
          <div style={{textAlign: 'center', padding: 60}}>
            <div className="muted" style={{fontSize: 16, marginBottom: 8}}>No agents yet</div>
            <div className="muted mini" style={{marginBottom: 16}}>Create your first agent to get started</div>
            <button 
              className="btn" 
              onClick={() => setShowCreateModal(true)}
            >
              Add Agent
            </button>
          </div>
        ) : (
          <div className="grid cols-3" style={{gap: 16}}>
            {state.agents.map(a => (
              <Link key={a.agentId} href={`/agents/${a.agentId}`} className="card" style={{display:'block', padding: '16px'}}>
                <div className="row" style={{justifyContent:'space-between', alignItems:'center', marginBottom: 8}}>
                  <div style={{fontWeight:600, fontSize: 16}}>{a.name}</div>
                  <div className="chip mini">{a.agentId.slice(0, 8)}</div>
                </div>
                {a.desc && <div className="muted" style={{fontSize: 14, lineHeight: 1.4}}>{a.desc}</div>}
                {!a.desc && <div className="muted mini">View details</div>}
              </Link>
            ))}
          </div>
        )}
      </div>

      <CreateAgentModal 
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleAgentCreated}
      />
    </Layout>
  );
}
