import { useEffect, useState } from 'react';
import Layout from '../../../components/Layout';
import { deleteDoc, listDocs, updateDoc, type DocItem } from '../../../lib/api';
import { useRouter } from 'next/router';
import Link from 'next/link';

export default function AgentSources(){
  const { query } = useRouter();
  const agentId = String(query.id || '');
  const [items, setItems] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string|null>(null);

  async function refresh(){
    setLoading(true);
    try { const r = await listDocs(agentId); setItems(r.items); }
    catch { setError('Failed to load sources'); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ if (agentId) refresh(); },[agentId]);
  useEffect(()=>{
    const id = setInterval(()=>{
      const hasActive = items.some(i => (i.status==='UPLOADED' || i.status==='PROCESSING'));
      if (hasActive) refresh();
    }, 7000);
    return ()=> clearInterval(id);
  }, [items.map(i=>i.status).join(',')]);

  async function saveEdit(id:string, patch: Partial<DocItem>){
    setBusy(true); setError(undefined);
    try { await updateDoc(id, patch, agentId); setEditing(null); await refresh(); }
    catch { setError('Update failed'); }
    finally { setBusy(false); }
  }
  async function remove(id:string){
    if (!confirm('Delete this source?')) return;
    setBusy(true); setError(undefined);
    try { await deleteDoc(id, agentId); await refresh(); }
    catch { setError('Delete failed'); }
    finally { setBusy(false); }
  }

  return (
    <Layout>
      <div className="card">
        <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
          <h3 className="card-title">My Sources</h3>
          <Link href={`/agents/${agentId}/add-content`} className="btn">Add Content</Link>
        </div>
        {error && <div className="chip" style={{borderColor:'#744'}}>{error}</div>}
        {loading ? <div className="muted">Loading…</div> : (
          <div style={{maxHeight:420, overflow:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr style={{textAlign:'left'}}>
                  <th>Title</th><th>Status</th><th>Updated</th><th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.docId}>
                    <td>
                      {editing===it.docId ? (
                        <input className="input" defaultValue={it.title} onBlur={(e)=>saveEdit(it.docId, { title: e.target.value })} />
                      ) : it.title}
                      {it.category && <div className="muted mini">{it.category}{it.version?` • ${it.version}`:''}</div>}
                    </td>
                    <td className="muted mini">{it.status || 'UPLOADED'}</td>
                    <td className="muted mini">{it.updatedAt?.slice(0,19).replace('T',' ')}</td>
                    <td style={{whiteSpace:'nowrap'}}>
                      {editing===it.docId ? (
                        <button className="btn ghost" onClick={()=>setEditing(null)}>Done</button>
                      ) : (
                        <>
                          <button className="btn ghost" onClick={()=>setEditing(it.docId)}>Edit</button>
                          <button className="btn" style={{marginLeft:8}} onClick={()=>remove(it.docId)}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {items.length===0 && !loading && <tr><td className="muted" colSpan={4}>No sources yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

