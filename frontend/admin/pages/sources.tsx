import { useCallback, useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { createUploadUrl, deleteDoc, ingestDoc, listDocs, updateDoc, inferDoc, getSettings, type DocItem } from '../lib/api';
import { useAgent } from '../lib/agent';

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
      <div className="grid cols-2">
        <div className="card" onDrop={onDrop} onDragOver={prevent} onDragEnter={prevent}>
          <h3 className="card-title">Add Source</h3>
          {error && <div className="chip" style={{borderColor:'#744'}}>{error}</div>}
          <div className="row" style={{gap:12, flexWrap:'wrap'}}>
            <div style={{flexBasis:'100%'}}>
              <div style={{border:'1px dashed var(--line)', borderRadius:12, padding:18, textAlign:'center', background:'rgba(255,255,255,.02)'}}>
                <div className="muted">Drag & drop to infer details, or choose a file</div>
                <input className="input" type="file" ref={fileRef} style={{marginTop:10}} />
              </div>
            </div>
            <input className="input" placeholder="Title" value={form.title} onChange={e=>setForm({...form, title:e.target.value})} />
            <input className="input" placeholder="Category" value={form.category} onChange={e=>setForm({...form, category:e.target.value})} />
            <input className="input" placeholder="Audience" value={form.audience} onChange={e=>setForm({...form, audience:e.target.value})} />
            <input className="input" placeholder="Year" value={form.year} onChange={e=>setForm({...form, year:e.target.value})} />
            <input className="input" placeholder="Version" value={form.version} onChange={e=>setForm({...form, version:e.target.value})} />
            <textarea className="textarea" placeholder="Description" rows={3} value={form.description} onChange={e=>setForm({...form, description:e.target.value})} />
            <input className="input" type="file" ref={fileRef} />
            <button className="btn" onClick={add} disabled={busy}>Upload</button>
          </div>
          <div className="muted mini" style={{marginTop:6}}>Uploads to S3, then queues ingestion (status: UPLOADED).</div>
        </div>

        <div className="card">
          <h3 className="card-title">Sources</h3>
          {loading ? <div className="muted">Loading…</div> : (
            <div style={{maxHeight:360, overflow:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{textAlign:'left'}}>
                    <th>Title</th><th>Status</th><th>Category</th><th>Audience</th><th>Version</th><th>Updated</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.docId}>
                      <td>
                        {editing===it.docId ? (
                          <input className="input" defaultValue={it.title} onBlur={(e)=>saveEdit(it.docId, { title: e.target.value })} />
                        ) : it.title}
                      </td>
                      <td className="muted mini">{it.status || 'UPLOADED'}</td>
                      <td>{editing===it.docId ? <input className="input" defaultValue={it.category||''} onBlur={(e)=>saveEdit(it.docId, { category: e.target.value })} /> : (it.category||'')}</td>
                      <td>{editing===it.docId ? <input className="input" defaultValue={it.audience||''} onBlur={(e)=>saveEdit(it.docId, { audience: e.target.value })} /> : (it.audience||'')}</td>
                      <td>{editing===it.docId ? <input className="input" defaultValue={it.version||''} onBlur={(e)=>saveEdit(it.docId, { version: e.target.value })} /> : (it.version||'')}</td>
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
                  {items.length===0 && !loading && <tr><td className="muted" colSpan={7}>No sources yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
