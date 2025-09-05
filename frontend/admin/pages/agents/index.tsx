import Layout from '../../components/Layout';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createAgent, getAgent, listAgents } from '../../lib/api';
import { useRouter } from 'next/router';

export default function AgentsHome(){
  const router = useRouter();
  const [items, setItems] = useState<Array<{agentId:string; name:string; desc:string}>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();
  const [creating, setCreating] = useState(false);
  const [useCase, setUseCase] = useState('');

  useEffect(()=>{
    (async()=>{
      setLoading(true); setError(undefined);
      try{
        const res = await listAgents();
        const details = await Promise.all(res.items.map(async it => {
          try{ const s = await getAgent(it.agentId); return { agentId: it.agentId, name: s.agentName || it.agentId, desc: s?.notes || '' }; }
          catch{ return { agentId: it.agentId, name: it.agentId, desc: '' }; }
        }));
        setItems(details);
      }catch(e:any){ setError('Failed to load agents'); }
      finally{ setLoading(false); }
    })();
  },[]);

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
          {loading ? <div className="muted">Loading…</div> : (
            <div className="grid cols-2" style={{marginTop:8}}>
              {items.map(a => (
                <Link key={a.agentId} href={`/agents/${a.agentId}`} className="card" style={{display:'block'}}>
                  <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
                    <div style={{fontWeight:600}}>{a.name}</div>
                    <div className="chip mini">{a.agentId}</div>
                  </div>
                  {a.desc && <div className="muted" style={{marginTop:8}}>{a.desc}</div>}
                  {!a.desc && <div className="muted mini" style={{marginTop:8}}>View details</div>}
                </Link>
              ))}
              {items.length===0 && (
                <div className="muted">No agents yet. Create one to get started.</div>
              )}
            </div>
          )}
        </div>
        <div className="card">
          <h3 className="card-title">Add Agent</h3>
          <p className="muted">Briefly describe the agent’s use case. We’ll prefill settings.</p>
          <textarea className="textarea" rows={5} value={useCase} onChange={e=>setUseCase(e.target.value)} placeholder="Describe the use case"/>
          <div className="row" style={{marginTop:10}}>
            <button className="btn" onClick={onCreate} disabled={creating}>Create Agent</button>
            <div className="muted mini">You can edit settings later.</div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

