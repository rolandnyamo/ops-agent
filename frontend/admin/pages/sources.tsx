import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { createUploadUrl, deleteDoc, ingestDoc, listDocs, updateDoc, inferDoc, getSettings, listDocumentationLogs, type DocItem, type JobLogEntry } from '../lib/api';
import { useAgent } from '../lib/agent';
import TranslationLogsIcon from '../components/TranslationLogsIcon';

import LogViewToggle from '../components/logs/LogViewToggle';
import LogsListView from '../components/logs/LogsListView';
import LogsGroupedView from '../components/logs/LogsGroupedView';
import {
  groupLogs,
  sortCategories,
  mergeLogEntries,
  type LogViewMode
} from '../components/logs/utils';

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
  expandedGroups: Record<string, boolean>;
  expandedEntries: Record<string, boolean>;
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
  expandedGroups: {},
  expandedEntries: {}
};

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
  const [logsViewMode, setLogsViewMode] = useState<LogViewMode>('grouped');

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
      const expandedGroups = Object.keys(grouped).reduce<Record<string, boolean>>((acc, key) => {
        const safeKey = key || 'uncategorized';
        acc[safeKey] = true;
        return acc;
      }, {});
      setLogsModal(prev => ({
        ...prev,
        loading: false,
        entries,
        nextToken: res.nextToken || null,
        expandedGroups,
        expandedEntries: {}
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
    setLogsModal({ ...LOGS_MODAL_DEFAULT });
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
        const mergedEntries = mergeLogEntries(prev.entries, res.items || []);
        const grouped = groupLogs(mergedEntries);
        const expandedGroups = { ...prev.expandedGroups };
        Object.keys(grouped).forEach(key => {
          const safeKey = key || 'uncategorized';
          if (typeof expandedGroups[safeKey] === 'undefined') expandedGroups[safeKey] = true;
        });
        return {
          ...prev,
          loadingMore: false,
          entries: mergedEntries,
          nextToken: res.nextToken || null,
          expandedGroups
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
      expandedGroups: {
        ...prev.expandedGroups,
        [category]: !prev.expandedGroups?.[category]
      }
    }));
  }, []);

  const toggleEntryVisibility = useCallback((key: string) => {
    setLogsModal(prev => ({
      ...prev,
      expandedEntries: {
        ...prev.expandedEntries,
        [key]: !prev.expandedEntries?.[key]
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
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, color: '#f8fafc' }}>Ingestion activity</h3>
                <div className="muted mini" style={{ color: '#94a3b8' }}>{logsModal.title}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <LogViewToggle mode={logsViewMode} onChange={setLogsViewMode} disabled={logsModal.loading} />
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
            </div>

            {logsModal.error && (
              <div className="chip" style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,.08)', marginBottom: 16 }}>
                {logsModal.error}
              </div>
            )}

            {logsModal.loading ? (
              <div className="muted" style={{ padding: '24px 0' }}>Loading logs…</div>
            ) : logsViewMode === 'grouped' ? (
              <LogsGroupedView
                groupedLogs={groupedLogs}
                orderedCategories={orderedCategories}
                expandedGroups={logsModal.expandedGroups}
                onToggleGroup={toggleCategoryVisibility}
              />
            ) : (
              <LogsListView
                entries={logsModal.entries}
                expanded={logsModal.expandedEntries}
                onToggle={toggleEntryVisibility}
              />
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
