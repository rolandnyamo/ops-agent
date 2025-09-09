import Layout from '../../../components/Layout';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createUploadUrl, ingestDoc, inferDoc, getSettings } from '../../../lib/api';
import { useRouter } from 'next/router';

type Step = 1|2;

export default function AddContent(){
  const { query, push } = useRouter();
  const agentId = String(query.id || '');
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<'upload'|'url'>('upload');
  const [file, setFile] = useState<File|undefined>();
  const [url, setUrl] = useState('');
  const [form, setForm] = useState({ title:'', description:'', category:'', audience:'All', year:String(new Date().getFullYear()), version:'v1' });
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string|undefined>();
  const [dragOver, setDragOver] = useState(false);

  useEffect(()=>{ if (!agentId) return; (async()=>{ try{ const s=await getSettings(agentId); setCategories(((s as any).categories)||[]);}catch{} })(); },[agentId]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setFile(files[0]);
    }
  }, []);

  async function onInfer(){
    setError(undefined);
    try{
      if (mode==='upload' && file){
        const sample = await file.slice(0, 4000).text();
        const inf = await inferDoc(file.name, sample, categories);
        setForm({
          title: inf.title || file.name,
          category: inf.category || (categories[0] || ''),
          audience: inf.audience || 'All',
          year: String(inf.year || new Date().getFullYear()),
          version: inf.version || 'v1',
          description: inf.description || ''
        });
      }
    }catch{ setError('Could not infer details'); }
  }

  async function onSubmit(){
    if (busy) return;
    setBusy(true); setError(undefined);
    try{
      if (!form.title) throw new Error('Title required');
      if (mode==='upload'){
        if (!file) throw new Error('File required');
        const { uploadUrl, fileKey, contentType, docId } = await createUploadUrl(file.name, file.type || 'application/octet-stream', agentId);
        await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
        await ingestDoc({ docId, title: form.title, description: form.description, category: form.category, audience: form.audience, year: form.year, version: form.version, fileKey }, agentId);
      } else {
        if (!url) throw new Error('URL required');
        await ingestDoc({ docId: cryptoRandom(12), title: form.title, description: form.description, category: form.category, audience: form.audience, year: form.year, version: form.version, url }, agentId);
      }
      await push(`/agents/${agentId}/sources`);
    }catch(e:any){ setError(e.message || 'Submit failed'); }
    finally{ setBusy(false); }
  }

  return (
    <Layout>
      <div className="card">
        <h3 className="card-title">Add Content</h3>
        <div className="row" style={{gap:8, marginBottom:24}}>
          <StepPill n={1} active={step===1} label="Source" onClick={()=>setStep(1)} />
          <StepPill n={2} active={step===2} label="Details" onClick={()=>setStep(2)} />
        </div>
        
        {error && (
          <div className="chip" style={{borderColor:'var(--danger)', background: 'rgba(220,38,38,.1)', marginBottom: 20}}>
            {error}
          </div>
        )}
        
        {step===1 && (
          <div className="grid cols-2" style={{gap: 32}}>
            <div>
              <div className="row" style={{gap:12, marginBottom:24}}>
                <button className={`btn ${mode==='upload'?'':'ghost'}`} onClick={()=>setMode('upload')}>
                  Upload File
                </button>
                <button className={`btn ${mode==='url'?'':'ghost'}`} onClick={()=>setMode('url')}>
                  From URL
                </button>
              </div>
              
              {mode==='upload' ? (
                <div 
                  className={`upload-zone ${dragOver ? 'dragover' : ''}`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onClick={() => document.getElementById('file-input')?.click()}
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
                    id="file-input"
                    type="file" 
                    onChange={e=>setFile(e.target.files?.[0]||undefined)} 
                    style={{display: 'none'}}
                    accept=".pdf,.docx,.html,.md,.txt,.json,.csv"
                  />
                  {file && (
                    <div className="chip" style={{marginTop: 16, background: 'rgba(59,130,246,.1)', borderColor: 'var(--summer)'}}>
                      <div style={{width: 8, height: 8, borderRadius: '50%', background: 'var(--summer)'}} />
                      {file.name}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <input 
                    className="input" 
                    placeholder="https://example.com/handbook.pdf" 
                    value={url} 
                    onChange={e=>setUrl(e.target.value)} 
                    style={{fontSize: 16, padding: 16}}
                  />
                  <div className="muted" style={{marginTop: 12, fontSize: 14}}>
                    We'll fetch and process content from the URL.
                  </div>
                </div>
              )}
            </div>
            
            <div style={{padding: 24, background: 'rgba(255,255,255,.02)', borderRadius: 'var(--radius)', border: '1px solid var(--line)'}}>
              <div className="muted" style={{marginBottom: 16, fontSize: 14}}>
                💡 <strong>Pro tip:</strong> After selecting a file, click "Auto-fill" to automatically detect title, category, and other metadata.
              </div>
              <div className="row" style={{marginTop:20, gap: 12}}>
                <button 
                  className="btn ghost" 
                  onClick={onInfer} 
                  disabled={mode!=='upload' || !file}
                  style={{flex: 1}}
                >
                  Auto-fill Details
                </button>
                <button 
                  className="btn" 
                  onClick={()=>setStep(2)} 
                  disabled={mode==='upload' && !file}
                  style={{flex: 1}}
                >
                  Next Step →
                </button>
              </div>
            </div>
          </div>
        )}
        
        {step===2 && (
          <div className="grid cols-2" style={{gap: 32}}>
            <div>
              <label style={{marginBottom: 8, display: 'block', fontWeight: 500}}>Title</label>
              <input className="input" value={form.title} onChange={e=>setForm({...form, title:e.target.value})} style={{marginBottom: 16}} />
              
              <label style={{marginBottom: 8, display: 'block', fontWeight: 500}}>Category</label>
              <input className="input" list="categories" value={form.category} onChange={e=>setForm({...form, category:e.target.value})} style={{marginBottom: 16}} />
              <datalist id="categories">
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </datalist>
              
              <label style={{marginBottom: 8, display: 'block', fontWeight: 500}}>Audience</label>
              <input className="input" value={form.audience} onChange={e=>setForm({...form, audience:e.target.value})} />
            </div>
            
            <div>
              <div className="row" style={{gap:16, marginBottom: 16}}>
                <div style={{flex:1}}>
                  <label style={{marginBottom: 8, display: 'block', fontWeight: 500}}>Year</label>
                  <input className="input" value={form.year} onChange={e=>setForm({...form, year:e.target.value})} />
                </div>
                <div style={{flex:1}}>
                  <label style={{marginBottom: 8, display: 'block', fontWeight: 500}}>Version</label>
                  <input className="input" value={form.version} onChange={e=>setForm({...form, version:e.target.value})} />
                </div>
              </div>
              
              <label style={{marginBottom: 8, display: 'block', fontWeight: 500}}>Description</label>
              <textarea className="textarea" rows={4} value={form.description} onChange={e=>setForm({...form, description:e.target.value})} style={{marginBottom: 24}} />
              
              <div className="row" style={{gap:12}}>
                <button className="btn ghost" onClick={()=>setStep(1)} style={{flex: 1}}>
                  ← Back
                </button>
                <button className="btn" onClick={onSubmit} disabled={busy} style={{flex: 2}}>
                  {busy ? 'Submitting…' : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function StepPill({ n, label, active, onClick }:{ n:number; label:string; active:boolean; onClick: ()=>void }){
  return (
    <button 
      className={`chip ${active ? '' : 'muted'}`} 
      onClick={onClick}
      style={{
        background: active ? 'rgba(59,130,246,.1)' : 'transparent',
        borderColor: active ? 'var(--summer)' : 'var(--line)',
        cursor: 'pointer'
      }}
    >
      <span className="pill mini" style={{background: active ? 'var(--summer)' : 'rgba(156,163,175,.25)'}}>{n}</span>
      {label}
    </button>
  );
}

function cryptoRandom(len:number){
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i=0;i<len;i++){ out += alphabet[Math.floor(Math.random()*alphabet.length)]; }
  return out;
}
