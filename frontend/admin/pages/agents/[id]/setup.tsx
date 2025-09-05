import { useEffect, useState } from 'react';
import Layout from '../../../components/Layout';
import { getSettings, putSettings, inferSettings, type Settings } from '../../../lib/api';
import { useRouter } from 'next/router';

export default function Setup(){
  const { query } = useRouter();
  const agentId = String(query.id || '');
  const [useCase, setUseCase] = useState('');
  const [agentName, setAgentName] = useState('Agent');
  const [confidence, setConfidence] = useState(0.45);
  const [fallback, setFallback] = useState('Sorry, I could not find this in the documentation.');
  const [orgType, setOrgType] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [audiences, setAudiences] = useState<string[]>(['All']);
  const [origins, setOrigins] = useState('https://www.example.edu');
  const [emails, setEmails] = useState('info@example.edu');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;
    (async () => {
      try {
        const s = await getSettings(agentId);
        setAgentName(s.agentName || 'Agent');
        setConfidence(typeof s.confidenceThreshold === 'number' ? s.confidenceThreshold : 0.45);
        setFallback(s.fallbackMessage || fallback);
        setOrgType((s as any).organizationType || '');
        setCategories(((s as any).categories || []) as string[]);
        setAudiences(((s as any).audiences || ['All']) as string[]);
        setOrigins((s.allowedOrigins || []).join(', '));
        setEmails((s.notifyEmails || []).join(', '));
      } catch (e:any) {
        setError('Could not load settings (showing defaults).');
      } finally {
        setLoading(false);
      }
    })();
  }, [agentId]);

  async function save(){
    setError(null);
    try {
      const dto: Settings = {
        agentName,
        confidenceThreshold: confidence,
        fallbackMessage: fallback,
        allowedOrigins: origins.split(',').map(s=>s.trim()).filter(Boolean),
        notifyEmails: emails.split(',').map(s=>s.trim()).filter(Boolean),
      };
      (dto as any).organizationType = orgType;
      (dto as any).categories = categories;
      (dto as any).audiences = audiences;
      await putSettings(dto, agentId);
      setSaved(true);
      setTimeout(()=>setSaved(false), 1200);
    } catch (e:any) {
      setError('Save failed. Please check values and try again.');
    }
  }

  return (
    <Layout>
      <div className="grid cols-2">
        <div className="card">
          <h3 className="card-title">Describe Your Use Case</h3>
          <textarea className="textarea" rows={4} placeholder="e.g., A school information assistant helping students and parents with admissions, financial aid, housing, and key deadlines."
            value={useCase} onChange={e=>setUseCase(e.target.value)} />
          <div className="row" style={{marginTop:10}}>
            <button className="btn" onClick={async ()=>{
              setError(null);
              try {
                const inf = await inferSettings(useCase);
                setAgentName(inf.agentName || agentName);
                setConfidence(inf.confidenceThreshold ?? confidence);
                setFallback(inf.fallbackMessage || fallback);
                setOrgType((inf as any).organizationType || '');
                setCategories(inf.categories || []);
                setAudiences(inf.audiences || ['All']);
              } catch(e:any){ setError('Could not infer settings.'); }
            }}>Generate</button>
            <div className="muted mini">Uses your AI provider to propose settings.</div>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Global Settings</h3>
          {loading && <div className="muted">Loading settings…</div>}
          {error && <div className="chip" style={{borderColor:'#553'}}>{error}</div>}
          <label>Agent Name</label>
          <input className="input" value={agentName} onChange={e=>setAgentName(e.target.value)} />
          <div className="row" style={{marginTop:12}}>
            <div style={{flex:1}}>
              <label>Confidence Threshold</label>
              <input className="input" type="number" step="0.05" min="0" max="1" value={confidence} onChange={e=>setConfidence(Number(e.target.value))} />
            </div>
            <div style={{flex:1}}>
              <label>Notify Emails (comma-separated)</label>
              <input className="input" value={emails} onChange={e=>setEmails(e.target.value)} />
            </div>
          </div>
          <label style={{marginTop:12}}>Fallback Message</label>
          <textarea className="textarea" rows={3} value={fallback} onChange={e=>setFallback(e.target.value)} />
          <div className="row" style={{marginTop:12}}>
            <div style={{flex:1}}>
              <label>Organization Type</label>
              <input className="input" value={orgType} onChange={e=>setOrgType(e.target.value)} />
            </div>
            <div style={{flex:1}}>
              <label>Audiences (comma-separated)</label>
              <input className="input" value={audiences.join(', ')} onChange={e=>setAudiences(e.target.value.split(',').map(x=>x.trim()).filter(Boolean))} />
            </div>
          </div>
          <label style={{marginTop:12}}>Categories (comma-separated)</label>
          <input className="input" value={categories.join(', ')} onChange={e=>setCategories(e.target.value.split(',').map(x=>x.trim()).filter(Boolean))} />
          <label style={{marginTop:12}}>Allowed Origins (CORS)</label>
          <textarea className="textarea" rows={2} value={origins} onChange={e=>setOrigins(e.target.value)} />
          <div className="row" style={{marginTop:14}}>
            <button className="btn" onClick={save} disabled={loading}>Save</button>
            {saved && <div className="chip">Saved ✓</div>}
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Look & Feel</h3>
          <p className="muted">Summer × Fall, soft gradients, crisp edges.</p>
          <div className="row" style={{marginTop:8, gap:14}}>
            <div className="chip"><span style={{display:'inline-block',height:12,width:12,borderRadius:6, background:'var(--summer)'}}/> Summer</div>
            <div className="chip"><span style={{display:'inline-block',height:12,width:12,borderRadius:6, background:'var(--fall)'}}/> Fall</div>
            <div className="chip"><span style={{display:'inline-block',height:12,width:12,borderRadius:6, background:'var(--sea)'}}/> Sea</div>
          </div>
          <div style={{marginTop:18}} className="muted mini">Design is mocked; values won’t persist yet.</div>
        </div>
      </div>
    </Layout>
  );
}

