import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { createUploadUrl, deleteDoc, ingestDoc, listDocs, updateDoc, inferDoc, getSettings, listDocumentationLogs, type DocItem, type JobLogEntry } from '../lib/api';
import { useAgent } from '../lib/agent';
import TranslationLogsIcon from '../components/TranslationLogsIcon';

export default function Sources(){
  const { agentId } = useAgent();
  const [items, setItems] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: '', audience: 'All', year: String(new Date().getFullYear()), version: 'v1' });
  const fileRef = useRef<HTMLInputElement|null>(null);
  const [knownCategories, setKnownCategories] = useState<string[]>([]);
  const [editing, setEditing] = useState<string|null>(null);
  const [logsModal, setLogsModal] = useState<LogsModalState>(LOGS_MODAL_DEFAULT);

function getStatusClass(status: string): string {
  const statusMap: Record<string, string> = {
    'READY': 'ready',
    'UPLOADED': 'uploaded', 
    'PROCESSING': 'processing',
    'ERROR': 'error'
  };
  return statusMap[status] || 'uploaded';
}

const CATEGORY_ORDER = [
  'submission',
  'processing-kickoff',
  'processing',
  'chunk-processing',
  'reassembly',
  'publication',
  'distribution',
  'notifications',
  'health-monitoring',
  'uncategorized'
];

const CATEGORY_LABELS: Record<string, string> = {
  submission: 'Submission & Intake',
  'processing-kickoff': 'Processing Kickoff',
  processing: 'Processing Updates',
  'chunk-processing': 'Chunk Processing',
  reassembly: 'Reassembly & Assets',
  publication: 'Publication & Availability',
  distribution: 'Distribution & Cleanup',
  notifications: 'Notifications',
  'health-monitoring': 'Health Monitoring',
  uncategorized: 'Other'
};

const STAGE_LABELS: Record<string, string> = {
  intake: 'Intake',
  start: 'Start',
  'document-parse': 'Document Parsing',
  'chunk-persist': 'Chunk Persist',
  'chunking': 'Chunking',
  embedding: 'Embedding',
  indexing: 'Indexing',
  'metadata-update': 'Metadata Update',
  cleanup: 'Cleanup',
  'auto-restart': 'Automatic Restart',
  'auto-fail': 'Automatic Failure'
};

function formatCategory(category?: string | null): string {
  if (!category) return CATEGORY_LABELS.uncategorized;
  return CATEGORY_LABELS[category] || category.split(/[-_]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function formatStage(stage?: string | null): string {
  if (!stage) return '—';
  return STAGE_LABELS[stage] || stage.split(/[-_]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function groupLogs(entries: JobLogEntry[]): Record<string, JobLogEntry[]> {
  return entries.reduce<Record<string, JobLogEntry[]>>((acc, entry) => {
    const key = entry.category || 'uncategorized';
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});
}

function sortCategories(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function formatActor(actor?: JobLogEntry['actor']): string {
  if (!actor) return 'Unknown';
  return actor.name || actor.email || actor.sub || actor.source || (actor.type === 'system' ? 'System' : actor.type) || 'Unknown';
}

type LogsModalState = {
  open: boolean;
  docId: string | null;
  agentId: string | null;
  title: string;
  entries: JobLogEntry[];
  loading: boolean;
  loadingMore: boolean;
  nextToken: string | null;
  error: string | null;
  expanded: Record<string, boolean>;
};

const LOGS_MODAL_DEFAULT: LogsModalState = {
  open: false,
  docId: null,
  agentId: null,
  title: '',
  entries: [],
  loading: false,
  loadingMore: false,
  nextToken: null,
  error: null,
  expanded: {}
};

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
    try {
      const r = await listDocs(agentId);
      setItems(r.items);
    } catch (e:any) { setError('Failed to load sources'); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ refresh(); },[agentId]);
  useEffect(()=>{ (async()=>{ try{ const s=await getSettings(agentId); setKnownCategories(((s as any).categories)||[]);}catch{} })(); },[agentId]);
  useEffect(()=>{
    const id = setInterval(()=>{
      const hasActive = items.some(i => (i.status==='UPLOADED' || i.status==='PROCESSING'));
      if (hasActive) refresh();
    }, 7000);
    return ()=> clearInterval(id);
  }, [items.map(i=>i.status).join(',')]);

  async function add(){
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error('File required');
      if (!form.title) throw new Error('Title required');
      const { docId, uploadUrl, fileKey, contentType } = await createUploadUrl(file.name, file.type || 'application/octet-stream', agentId);
      await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
      await ingestDoc({ docId, title: form.title, description: form.description, category: form.category, audience: form.audience, year: form.year, version: form.version, fileKey }, agentId);
      setForm({ title:'', description:'', category:'', audience:'All', year:String(new Date().getFullYear()), version:'v1' }); if (fileRef.current) fileRef.current.value = '';
      await refresh();
    } catch (e:any) { setError(e.message || 'Add failed'); }
    finally { setBusy(false); }
  }

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    try{
      const sampleBlob = file.slice(0, 4000);
      const sampleText = await sampleBlob.text();
      const inf = await inferDoc(file.name, sampleText, knownCategories);
      setForm({
        title: inf.title || file.name,
        category: inf.category || (knownCategories[0] || ''),
        audience: inf.audience || 'All',
        year: String(inf.year || new Date().getFullYear()),
        version: inf.version || 'v1',
        description: inf.description || ''
      });
    } catch(err:any){ setError('Could not infer document details'); }
  }, [knownCategories]);
  const prevent = (e:any)=>{ e.preventDefault(); e.stopPropagation(); };

  const openLogs = useCallback(async (doc: DocItem) => {
    if (!doc.docId) return;
    const scopedAgent = agentId || 'default';
    setLogsModal({
      ...LOGS_MODAL_DEFAULT,
      open: true,
      docId: doc.docId,
      agentId: scopedAgent,
      title: doc.title || doc.docId,
      loading: true
    });
    try {
      const res = await listDocumentationLogs(doc.docId, scopedAgent);
      const entries = res.items || [];
      const grouped = groupLogs(entries);
      const expanded = Object.keys(grouped).reduce<Record<string, boolean>>((acc, key) => {
        acc[key] = true;
        return acc;
      }, {});
      setLogsModal(prev => ({
        ...prev,
        loading: false,
        entries,
        nextToken: res.nextToken || null,
        expanded
      }));
    } catch (err: any) {
      setLogsModal(prev => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to load logs'
      }));
    }
  }, [agentId]);

  const closeLogsModal = useCallback(() => {
    setLogsModal(LOGS_MODAL_DEFAULT);
  }, []);

  const loadMoreLogs = useCallback(async () => {
    if (!logsModal.docId || !logsModal.nextToken || logsModal.loadingMore) return;
    const docId = logsModal.docId;
    const token = logsModal.nextToken;
    const scopeAgent = logsModal.agentId || agentId || 'default';
    setLogsModal(prev => ({ ...prev, loadingMore: true, error: null }));
    try {
      const res = await listDocumentationLogs(docId, scopeAgent, token);
      setLogsModal(prev => {
        const mergedEntries = [...prev.entries, ...(res.items || [])];
        const grouped = groupLogs(mergedEntries);
        const expanded = { ...prev.expanded };
        Object.keys(grouped).forEach(key => {
          if (typeof expanded[key] === 'undefined') expanded[key] = true;
        });
        return {
          ...prev,
          loadingMore: false,
          entries: mergedEntries,
          nextToken: res.nextToken || null,
          expanded
        };
      });
    } catch (err: any) {
      setLogsModal(prev => ({
        ...prev,
        loadingMore: false,
        error: err.message || 'Failed to load more logs'
      }));
    }
  }, [logsModal.docId, logsModal.nextToken, logsModal.loadingMore, logsModal.agentId, agentId]);

  const groupedLogs = useMemo(() => groupLogs(logsModal.entries), [logsModal.entries]);
  const orderedCategories = useMemo(() => sortCategories(Object.keys(groupedLogs)), [groupedLogs]);

  const toggleCategoryVisibility = useCallback((category: string) => {
    setLogsModal(prev => ({
      ...prev,
      expanded: {
        ...prev.expanded,
        [category]: !prev.expanded?.[category]
      }
    }));
  }, []);

  async function saveEdit(id:string, patch: Partial<DocItem>){
    setBusy(true); setError(undefined);
    try { await updateDoc(id, patch, agentId); setEditing(null); await refresh(); } catch(e:any){ setError('Update failed'); } finally { setBusy(false); }
  }

  async function remove(id:string){
    if (!confirm('Delete this source?')) return;
    setBusy(true); setError(undefined);
    try { await deleteDoc(id, agentId); await refresh(); } catch(e:any){ setError('Delete failed'); } finally { setBusy(false); }
  }

  return (
    <Layout>
      <div className="grid cols-2" style={{gap: 32}}>
        <div className="card">
          <h3 className="card-title">Add Source</h3>
          {error && (
            <div className="chip" style={{borderColor:'var(--danger)', background: 'rgba(220,38,38,.1)', marginBottom: 20}}>
              {error}
            </div>
          )}
          
          <div 
            className={`upload-zone`}
            onDrop={onDrop} 
            onDragOver={prevent} 
            onDragEnter={prevent}
            onClick={() => fileRef.current?.click()}
          >
            <div className="upload-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17,8 12,3 7,8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div style={{fontSize: 16, fontWeight: 500, marginBottom: 8}}>
              Drag & drop file here
            </div>
            <div className="muted" style={{marginBottom: 16}}>
              or click to browse
            </div>
            <div className="muted mini">
              Supported: pdf, docx, html, md, txt, json, csv
            </div>
            <input 
              type="file" 
              ref={fileRef} 
              style={{display: 'none'}}
              accept=".pdf,.docx,.html,.md,.txt,.json,.csv"
            />
          </div>
          
          <div style={{marginTop: 24}}>
            <div className="row" style={{gap: 16, marginBottom: 16}}>
              <input 
                className="input" 
                placeholder="Title" 
                value={form.title} 
                onChange={e=>setForm({...form, title:e.target.value})}
                style={{flex: 2}} 
              />
              <input 
                className="input" 
                placeholder="Category" 
                value={form.category} 
                onChange={e=>setForm({...form, category:e.target.value})}
                style={{flex: 1}} 
              />
            </div>
            
            <div className="row" style={{gap: 16, marginBottom: 16}}>
              <input 
                className="input" 
                placeholder="Audience" 
                value={form.audience} 
                onChange={e=>setForm({...form, audience:e.target.value})}
                style={{flex: 1}} 
              />
              <input 
                className="input" 
                placeholder="Year" 
                value={form.year} 
                onChange={e=>setForm({...form, year:e.target.value})}
                style={{flex: 1}} 
              />
              <input 
                className="input" 
                placeholder="Version" 
                value={form.version} 
                onChange={e=>setForm({...form, version:e.target.value})}
                style={{flex: 1}} 
              />
            </div>
            
            <textarea 
              className="textarea" 
              placeholder="Description (optional)" 
              rows={3} 
              value={form.description} 
              onChange={e=>setForm({...form, description:e.target.value})}
              style={{marginBottom: 20}} 
            />
            
            <button className="btn" onClick={add} disabled={busy} style={{width: '100%'}}>
              {busy ? 'Uploading...' : 'Upload Source'}
            </button>
          </div>
          
          <div className="muted mini" style={{marginTop: 12}}>
            Files are uploaded to S3 and queued for processing.
          </div>
        </div>

        <div className="card">
          <div className="row" style={{justifyContent:'space-between', alignItems:'center', marginBottom: 24}}>
            <div>
              <h3 className="card-title" style={{margin: 0}}>Sources</h3>
              <div className="muted mini" style={{marginTop: 4}}>
                {items.length} source{items.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          
          {loading ? (
            <div className="muted" style={{padding: 40, textAlign: 'center'}}>Loading sources…</div>
          ) : items.length === 0 ? (
            <div style={{textAlign: 'center', padding: 40}}>
              <div className="muted" style={{fontSize: 16, marginBottom: 8}}>No sources yet</div>
              <div className="muted mini">Upload your first document to get started</div>
            </div>
          ) : (
            <div className="table-container">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Category</th>
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
                      <td className="muted mini">
                        {it.updatedAt ? formatDate(it.updatedAt) : '—'}
                      </td>
                      <td>
                        <div className="row" style={{gap: 8}}>
                          <button
                            className="btn ghost"
                            onClick={() => openLogs(it)}
                            title="View ingestion logs"
                            style={{ padding: '6px 10px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <TranslationLogsIcon style={{ width: 16, height: 16 }} />
                          </button>
                          {editing===it.docId ? (
                            <button className="btn ghost" onClick={()=>setEditing(null)} style={{padding: '6px 12px', fontSize: 12}}>
                              Done
                            </button>
                          ) : (
                            <>
                              <button className="btn ghost" onClick={()=>setEditing(it.docId)} style={{padding: '6px 12px', fontSize: 12}}>
                                Edit
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
      </div>

      {logsModal.open && (
        <div className="modal-backdrop" onClick={closeLogsModal}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '720px',
              background: '#0f172a',
              color: '#f8fafc',
              maxHeight: '80vh',
              overflowY: 'auto'
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, color: '#f8fafc' }}>Ingestion activity</h3>
                <div className="muted mini" style={{ color: '#94a3b8' }}>{logsModal.title}</div>
              </div>
              <button
                className="btn ghost mini"
                onClick={closeLogsModal}
                style={{
                  color: '#cbd5e1',
                  borderColor: 'rgba(148, 163, 184, 0.4)'
                }}
              >
                Close
              </button>
            </div>

            {logsModal.error && (
              <div className="chip" style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,.08)', marginBottom: 16 }}>
                {logsModal.error}
              </div>
            )}

            {logsModal.loading ? (
              <div className="muted" style={{ padding: '24px 0' }}>Loading logs…</div>
            ) : orderedCategories.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {orderedCategories.map(category => {
                  const entries = groupedLogs[category] || [];
                  const key = category || 'uncategorized';
                  const expanded = logsModal.expanded[key] ?? true;
                  const latest = entries[0];
                  const latestSummary = latest ? (latest.message || latest.eventType) : 'No activity yet';
                  const latestStatus = latest?.status || '—';
                  return (
                    <div
                      key={key}
                      style={{
                        border: '1px solid rgba(148,163,184,0.25)',
                        borderRadius: 10,
                        padding: 12,
                        background: 'rgba(15,23,42,0.65)'
                      }}
                    >
                      <button
                        onClick={() => toggleCategoryVisibility(key)}
                        style={{
                          width: '100%',
                          border: 'none',
                          background: 'transparent',
                          color: '#f8fafc',
                          textAlign: 'left',
                          padding: 0,
                          cursor: 'pointer'
                        }}
                      >
                        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 15 }}>{formatCategory(category)}</div>
                            <div className="muted mini" style={{ color: '#94a3b8' }}>
                              Latest: {latestSummary} · Status: {latestStatus}
                            </div>
                          </div>
                          <div className="muted mini" style={{ color: '#cbd5e1' }}>{expanded ? 'Hide' : 'Show'}</div>
                        </div>
                      </button>
                      {expanded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                          {entries.map((entry, idx) => {
                            const actorLabel = formatActor(entry.actor);
                            const chunk = entry.chunkProgress;
                            const total = chunk?.total ?? null;
                            const completed = chunk?.completed ?? null;
                            const failed = chunk?.failed ?? null;
                            const percent = total && completed !== null ? Math.round((completed / total) * 100) : null;
                            return (
                              <div
                                key={entry.logId || `${entry.createdAt}-${idx}`}
                                style={{
                                  border: '1px solid rgba(148,163,184,0.2)',
                                  borderRadius: 8,
                                  padding: 12,
                                  background: 'rgba(15,23,42,0.48)'
                                }}
                              >
                                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                                  <div style={{ fontWeight: 600 }}>{entry.message || entry.eventType}</div>
                                  <div className="muted mini" style={{ color: '#94a3b8' }}>{new Date(entry.createdAt).toLocaleString()}</div>
                                </div>
                                <div className="muted mini" style={{ color: '#a5b4fc', marginBottom: 6 }}>
                                  Stage: {formatStage(entry.stage)} · Status: {entry.status || '—'} · Actor: {actorLabel}
                                  {typeof entry.attempt === 'number' && entry.attempt > 0 && (
                                    <> · Attempt #{entry.attempt}</>
                                  )}
                                  {typeof entry.retryCount === 'number' && entry.retryCount > 0 && (
                                    <> · Retries {entry.retryCount}</>
                                  )}
                                </div>
                                {chunk && total && (
                                  <div className="muted mini" style={{ color: '#cbd5e1', marginBottom: 6 }}>
                                    Progress: {completed ?? 0}/{total} {failed ? `(failed ${failed})` : ''} {percent !== null ? `· ${percent}%` : ''}
                                  </div>
                                )}
                                {entry.failureReason && (
                                  <div className="chip mini" style={{
                                    marginBottom: 6,
                                    borderColor: 'rgba(220,38,38,0.5)',
                                    background: 'rgba(220,38,38,0.12)',
                                    color: '#fecaca'
                                  }}>
                                    Failure: {entry.failureReason}
                                  </div>
                                )}
                                {entry.metadata && (
                                  <details style={{ marginTop: 6 }}>
                                    <summary className="muted mini" style={{ color: '#cbd5e1', cursor: 'pointer' }}>Metadata</summary>
                                    <pre
                                      style={{
                                        margin: '6px 0 0',
                                        padding: 12,
                                        borderRadius: 6,
                                        background: 'rgba(30,41,59,0.85)',
                                        border: '1px solid rgba(148,163,184,0.2)',
                                        fontSize: 12,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word'
                                      }}
                                    >
                                      {JSON.stringify(entry.metadata, null, 2)}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="muted" style={{ padding: '24px 0' }}>No activity recorded in the last 10 days.</div>
            )}

            {logsModal.nextToken && (
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn ghost mini"
                  onClick={loadMoreLogs}
                  disabled={logsModal.loadingMore}
                  style={{
                    color: '#cbd5e1',
                    borderColor: 'rgba(148, 163, 184, 0.4)'
                  }}
                >
                  {logsModal.loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
