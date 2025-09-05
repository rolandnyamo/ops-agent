import Layout from '../../../components/Layout';
import { useEffect, useRef, useState } from 'react';
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

  useEffect(()=>{ if (!agentId) return; (async()=>{ try{ const s=await getSettings(agentId); setCategories(((s as any).categories)||[]);}catch{} })(); },[agentId]);

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
        <div className="row" style={{gap:8, marginBottom:12}}>
          <StepPill n={1} active={step===1} label="Source" onClick={()=>setStep(1)} />
          <StepPill n={2} active={step===2} label="Details" onClick={()=>setStep(2)} />
        </div>
        {error && <div className="chip" style={{borderColor:'#744'}}>{error}</div>}
        {step===1 && (
          <div className="grid cols-2">
            <div>
              <div className="row" style={{gap:10, marginBottom:12}}>
                <button className={`btn ${mode==='upload'?'':'ghost'}`} onClick={()=>setMode('upload')}>Upload File</button>
                <button className={`btn ${mode==='url'?'':'ghost'}`} onClick={()=>setMode('url')}>From URL</button>
              </div>
              {mode==='upload' ? (
                <div style={{border:'1px dashed var(--line)', borderRadius:12, padding:18, background:'rgba(255,255,255,.02)'}}>
                  <div className="muted mini">Choose a file (PDF, DOCX, TXT)</div>
                  <input className="input" type="file" onChange={e=>setFile(e.target.files?.[0]||undefined)} style={{marginTop:10}} />
                </div>
              ) : (
                <div>
                  <input className="input" placeholder="https://example.com/handbook.pdf" value={url} onChange={e=>setUrl(e.target.value)} />
                  <div className="muted mini" style={{marginTop:6}}>We’ll fetch and ingest from the URL.</div>
                </div>
              )}
            </div>
            <div>
              <div className="muted">Tip: After you choose a file, click Infer to prefill details.</div>
              <div className="row" style={{marginTop:10}}>
                <button className="btn ghost" onClick={onInfer} disabled={mode!=='upload' || !file}>Infer</button>
                <button className="btn" onClick={()=>setStep(2)} disabled={mode==='upload' && !file}>Next</button>
              </div>
            </div>
          </div>
        )}
        {step===2 && (
          <div className="grid cols-2">
            <div>
              <label>Title</label>
              <input className="input" value={form.title} onChange={e=>setForm({...form, title:e.target.value})} />
              <label style={{marginTop:10}}>Category</label>
              <input className="input" list="categories" value={form.category} onChange={e=>setForm({...form, category:e.target.value})} />
              <datalist id="categories">
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </datalist>
              <label style={{marginTop:10}}>Audience</label>
              <input className="input" value={form.audience} onChange={e=>setForm({...form, audience:e.target.value})} />
            </div>
            <div>
              <div className="row" style={{gap:10}}>
                <div style={{flex:1}}>
                  <label>Year</label>
                  <input className="input" value={form.year} onChange={e=>setForm({...form, year:e.target.value})} />
                </div>
                <div style={{flex:1}}>
                  <label>Version</label>
                  <input className="input" value={form.version} onChange={e=>setForm({...form, version:e.target.value})} />
                </div>
              </div>
              <label style={{marginTop:10}}>Description</label>
              <textarea className="textarea" rows={4} value={form.description} onChange={e=>setForm({...form, description:e.target.value})} />
              <div className="row" style={{marginTop:12}}>
                <button className="btn ghost" onClick={()=>setStep(1)}>Back</button>
                <button className="btn" onClick={onSubmit} disabled={busy}>{busy?'Submitting…':'Submit'}</button>
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
    <button className={`chip ${active?'':'muted'}`} onClick={onClick}>
      <span className="pill mini" style={{background:'rgba(255,183,3,.25)'}}>{n}</span>
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

