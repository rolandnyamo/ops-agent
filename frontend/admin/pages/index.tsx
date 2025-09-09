import Layout from '../components/Layout';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createAgent } from '../lib/api';
import { useRouter } from 'next/router';
import { useApp } from '../context/AppContext';
import { AgentCardSkeleton } from '../components/Skeletons';

export default function Home(){
  const router = useRouter();
  const { state, loadAgents } = useApp();
  const [error, setError] = useState<string|undefined>();
  const [creating, setCreating] = useState(false);
  const [useCase, setUseCase] = useState('');

  useEffect(() => {
    loadAgents().catch(() => setError('Failed to load agents'));
  }, []);

  async function onCreate(){
    if (creating) return;
    setCreating(true); setError(undefined);
    try{ const r = await createAgent(useCase || undefined); await router.push(`/agents/${encodeURIComponent(r.agentId)}`); }
    catch(e:any){ setError('Create failed'); }
    finally{ setCreating(false); }
  }

  return (
    <Layout>
      <div className="grid cols-2">
        <div className="card">
          <h3 className="card-title">Your Agents</h3>
          {error && <div className="chip" style={{borderColor:'#744'}}>{error}</div>}
          {state.agentsLoading ? (
            <div className="grid cols-2" style={{marginTop:8}}>
              {[...Array(4)].map((_, i) => (
                <AgentCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="grid cols-2" style={{marginTop:8}}>
              {state.agents.map(a => (
                <Link key={a.agentId} href={`/agents/${a.agentId}`} className="card" style={{display:'block'}}>
                  <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
                    <div style={{fontWeight:600}}>{a.name}</div>
                    <div className="chip mini">{a.agentId}</div>
                  </div>
                  {a.desc && <div className="muted" style={{marginTop:8}}>{a.desc}</div>}
                  {!a.desc && <div className="muted mini" style={{marginTop:8}}>View details</div>}
                </Link>
              ))}
              {state.agents.length===0 && (
                <div className="muted">No agents yet. Create one to get started.</div>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="card-title">Add Agent</h3>
          <p className="muted">Briefly describe the agent’s use case. We’ll prefill settings.</p>
          <textarea className="textarea" rows={5} placeholder="e.g., A school information assistant helping students and parents with admissions, financial aid, housing, and key deadlines."
            value={useCase} onChange={e=>setUseCase(e.target.value)} />
          <div className="row" style={{marginTop:10}}>
            <button className="btn" onClick={onCreate} disabled={creating}>Create Agent</button>
            <div className="muted mini">You can edit settings later.</div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
