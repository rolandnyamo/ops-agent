import { useMemo, useState } from 'react';
import Layout from '../components/Layout';

const categories = ['Admissions','Academics','Housing','Finance'];
const audiences = ['Prospective','Student','Parent','Staff'];

export default function Ingest(){
  const [title, setTitle] = useState('Handbook');
  const [desc, setDesc] = useState('General policies and procedures.');
  const [category, setCategory] = useState(categories[0]);
  const [audience, setAudience] = useState(audiences[0]);
  const [year, setYear] = useState('2024');
  const [version, setVersion] = useState('v1');
  const [mode, setMode] = useState<'upload'|'url'>('upload');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('Paste a few paragraphs here to mock ingestion...');
  const [log, setLog] = useState('');

  function start(){
    const docId = Math.random().toString(36).slice(2,10);
    const payload = { title, desc, category, audience, year, version, mode, url, content };
    setLog(`Ingestion queued for ${docId}\n${JSON.stringify(payload, null, 2)}`);
  }

  const meta = useMemo(()=>[
    { label:'Category', value:category },
    { label:'Audience', value:audience },
    { label:'Year', value:year },
    { label:'Version', value:version },
  ],[category,audience,year,version]);

  return (
    <Layout>
      <div className="grid cols-2">
        <div className="card">
          <h3 className="card-title">Add Document</h3>
          <label>Title</label>
          <input className="input" value={title} onChange={e=>setTitle(e.target.value)} />
          <label style={{marginTop:10}}>Description</label>
          <textarea className="textarea" rows={3} value={desc} onChange={e=>setDesc(e.target.value)} />

          <div className="row" style={{marginTop:10}}>
            <div style={{flex:1}}>
              <label>Category</label>
              <select className="select" value={category} onChange={e=>setCategory(e.target.value)}>
                {categories.map(c=> <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={{flex:1}}>
              <label>Audience</label>
              <select className="select" value={audience} onChange={e=>setAudience(e.target.value)}>
                {audiences.map(a=> <option key={a}>{a}</option>)}
              </select>
            </div>
          </div>
          <div className="row" style={{marginTop:10}}>
            <div style={{flex:1}}>
              <label>Year</label>
              <input className="input" value={year} onChange={e=>setYear(e.target.value)} />
            </div>
            <div style={{flex:1}}>
              <label>Version</label>
              <input className="input" value={version} onChange={e=>setVersion(e.target.value)} />
            </div>
          </div>

          <div className="row" style={{marginTop:10}}>
            <button className={`btn ${mode==='upload'?'':'ghost'}`} onClick={()=>setMode('upload')}>Upload</button>
            <button className={`btn ${mode==='url'?'':'ghost'}`} onClick={()=>setMode('url')}>From URL</button>
          </div>

          {mode==='url' ? (
            <>
              <label style={{marginTop:10}}>URL</label>
              <input className="input" placeholder="https://..." value={url} onChange={e=>setUrl(e.target.value)} />
            </>
          ) : (
            <>
              <label style={{marginTop:10}}>Content (mock)</label>
              <textarea className="textarea" rows={6} value={content} onChange={e=>setContent(e.target.value)} />
            </>
          )}

          <div className="row" style={{marginTop:12}}>
            <button className="btn" onClick={start}>Start Ingestion</button>
            <div className="muted mini">Mocked: simulates queue → embed</div>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Preview</h3>
          <div className="row" style={{flexWrap:'wrap', gap:8}}>
            {meta.map(m => <div className="chip" key={m.label}>{m.label}: {m.value}</div>)}
          </div>
          <pre style={{marginTop:10, whiteSpace:'pre-wrap'}} className="muted mini">{log || 'No runs yet.'}</pre>
        </div>
      </div>
    </Layout>
  );
}

