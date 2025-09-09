import { useEffect, useState } from 'react';
import Layout from '../../../components/Layout';
import DocumentViewer from '../../../components/DocumentViewer';
import { deleteDoc, updateDoc, type DocItem } from '../../../lib/api';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useApp } from '../../../context/AppContext';
import { SourcesTableSkeleton, SourcesHeaderSkeleton } from '../../../components/Skeletons';

export default function AgentSources(){
  const { query, push } = useRouter();
  const agentId = String(query.id || '');
  const { getAgentById, loadAgentSources, updateAgentSources, isSourcesLoading, refreshAgentSources } = useApp();
  const [error, setError] = useState<string|undefined>();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string|null>(null);
  const [viewingDocument, setViewingDocument] = useState<DocItem | null>(null);

  const agent = getAgentById(agentId);
  const sources = agent?.sources || [];
  const loading = isSourcesLoading(agentId);

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

  useEffect(()=>{ 
    if (agentId) {
      loadAgentSources(agentId).catch(() => setError('Failed to load sources'));
      // Silent background refresh after initial load
      setTimeout(() => { refreshAgentSources(agentId); }, 500);
    }
  },[agentId]);
  
  useEffect(()=>{
    const id = setInterval(()=>{
      const hasActive = sources.some(i => (i.status==='UPLOADED' || i.status==='PROCESSING'));
      if (hasActive) {
        loadAgentSources(agentId).catch(() => {});
      }
    }, 7000);
    return ()=> clearInterval(id);
  }, [sources.map(i=>i.status).join(','), agentId]);

  // Show loading if we don't have sources yet and we're currently loading
  const shouldShowLoading = loading || (sources.length === 0 && !agent?.sourcesLastFetched);

  async function refresh(){
    try { 
      await loadAgentSources(agentId);
    } catch { 
      setError('Failed to refresh sources'); 
    }
  }

  async function saveEdit(id:string, patch: Partial<DocItem>){
    setBusy(true); setError(undefined);
    try { 
      await updateDoc(id, patch, agentId); 
      setEditing(null); 
      await refresh(); 
    }
    catch { setError('Update failed'); }
    finally { setBusy(false); }
  }
  
  async function remove(id:string){
    if (!confirm('Delete this source?')) return;
    setBusy(true); setError(undefined);
    try { 
      await deleteDoc(id, agentId); 
      // Update local state immediately
      const updatedSources = sources.filter(item => item.docId !== id);
      updateAgentSources(agentId, updatedSources);
    }
    catch { setError('Delete failed'); }
    finally { setBusy(false); }
  }

  return (
    <Layout>
      <div className="card">
        <div className="row" style={{justifyContent:'space-between', alignItems:'center', marginBottom: 24}}>
          <div className="row" style={{alignItems: 'center', gap: 16}}>
            <button 
              onClick={() => push(`/agents/${agentId}`)}
              className="btn ghost"
              style={{
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 14
              }}
            >
              ← Back to Agent
            </button>
            <div>
              <h3 className="card-title" style={{margin: 0}}>Sources</h3>
              <div className="muted mini" style={{marginTop: 4}}>
                {shouldShowLoading ? '...' : `${sources.length} item${sources.length !== 1 ? 's' : ''}`}
              </div>
            </div>
          </div>
          <div>
            <Link href={`/agents/${agentId}/add-content`} className="btn">Add Source</Link>
          </div>
        </div>
        
        {error && (
          <div className="chip" style={{borderColor:'var(--danger)', background: 'rgba(220,38,38,.1)', marginBottom: 20}}>
            {error}
          </div>
        )}
        
        {shouldShowLoading ? (
          <>
            <SourcesHeaderSkeleton />
            <SourcesTableSkeleton />
          </>
        ) : sources.length === 0 ? (
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
                {sources.map(it => (
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
                            {it.fileKey && (
                              <button 
                                className="btn ghost" 
                                onClick={() => setViewingDocument(it)} 
                                style={{padding: '6px 12px', fontSize: 12}}
                              >
                                View
                              </button>
                            )}
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

      {/* Document Viewer Modal */}
      {viewingDocument && (
        <DocumentViewer 
          document={viewingDocument} 
          isOpen={!!viewingDocument}
          onClose={() => setViewingDocument(null)}
          agentId={agentId}
        />
      )}
    </Layout>
  );
}

