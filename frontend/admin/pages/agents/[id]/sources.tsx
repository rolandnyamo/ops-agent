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

  function getStatusClass(status: string): string {
    const statusMap: Record<string, string> = {
      'READY': 'ready',
      'UPLOADED': 'uploaded', 
      'PROCESSING': 'processing',
      'ERROR': 'error'
    };
    return statusMap[status] || 'uploaded';
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }

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
        <div className="row" style={{justifyContent:'space-between', alignItems:'center', marginBottom: 24}}>
          <div>
            <h3 className="card-title" style={{margin: 0}}>Sources</h3>
            <div className="muted mini" style={{marginTop: 4}}>
              {items.length} item{items.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div className="row" style={{gap: 12}}>
            <button className="btn ghost">Add new</button>
            <Link href={`/agents/${agentId}/add-content`} className="btn">Add Source</Link>
          </div>
        </div>
        
        {error && (
          <div className="chip" style={{borderColor:'var(--danger)', background: 'rgba(220,38,38,.1)', marginBottom: 20}}>
            {error}
          </div>
        )}
        
        {loading ? (
          <div className="muted" style={{padding: 40, textAlign: 'center'}}>Loading sources…</div>
        ) : items.length === 0 ? (
          <div style={{textAlign: 'center', padding: 60}}>
            <div className="muted" style={{fontSize: 16, marginBottom: 8}}>No sources yet</div>
            <div className="muted mini">Get started by adding your first document or content source</div>
            <Link href={`/agents/${agentId}/add-content`} className="btn" style={{marginTop: 16}}>
              Add Source
            </Link>
          </div>
        ) : (
          <div className="table-container">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Category</th>
                  <th>Audience</th>
                  <th>Version</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.docId}>
                    <td>
                      <div>
                        {editing===it.docId ? (
                          <input 
                            className="input" 
                            defaultValue={it.title} 
                            onBlur={(e)=>saveEdit(it.docId, { title: e.target.value })}
                            style={{fontSize: 14, padding: '6px 8px'}} 
                          />
                        ) : (
                          <div style={{fontWeight: 500}}>{it.title}</div>
                        )}
                        {it.category && (
                          <div className="muted mini" style={{marginTop: 4}}>
                            {it.category}{it.version ? ` • ${it.version}` : ''}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className={`status ${getStatusClass(it.status || 'UPLOADED')}`}>
                        {it.status || 'UPLOADED'}
                      </div>
                    </td>
                    <td className="muted">{it.category || '—'}</td>
                    <td className="muted">{it.audience || 'All'}</td>
                    <td className="muted">{it.version || 'v1'}</td>
                    <td className="muted mini">
                      {it.updatedAt ? formatDate(it.updatedAt) : '—'}
                    </td>
                    <td>
                      <div className="row" style={{gap: 8}}>
                        {editing===it.docId ? (
                          <button className="btn ghost" onClick={()=>setEditing(null)} style={{padding: '6px 12px', fontSize: 12}}>
                            Done
                          </button>
                        ) : (
                          <>
                            <button className="btn ghost" onClick={()=>setEditing(it.docId)} style={{padding: '6px 12px', fontSize: 12}}>
                              Update
                            </button>
                            <button className="btn ghost" onClick={()=>remove(it.docId)} style={{padding: '6px 12px', fontSize: 12, color: 'var(--danger)', borderColor: 'rgba(220,38,38,.3)'}}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

