import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getSettings, putSettings, inferSettings, ask, type Settings } from '../lib/api';
import { useAgent } from '../lib/agent';

export default function Setup(){
  const { agentId } = useAgent();
  const [useCase, setUseCase] = useState('');
  const [agentName, setAgentName] = useState('Agent');
  const [confidence, setConfidence] = useState(0.45);
  const [fallback, setFallback] = useState('Sorry, I could not find this in the documentation.');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [orgType, setOrgType] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [audiences, setAudiences] = useState<string[]>(['All']);
  const [origins, setOrigins] = useState('https://www.example.edu');
  const [emails, setEmails] = useState('info@example.edu');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Testing state
  const [testQuestion, setTestQuestion] = useState('');
  const [testResults, setTestResults] = useState<{ current?: any }>({});
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await getSettings(agentId);
        setAgentName(s.agentName || 'Agent');
        setConfidence(typeof s.confidenceThreshold === 'number' ? s.confidenceThreshold : 0.45);
        setFallback(s.fallbackMessage || fallback);
        setSystemPrompt(s.systemPrompt || '');
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
  }, []);

  async function save(){
    setError(null);
    try {
      const dto: Settings = {
        agentName,
        confidenceThreshold: confidence,
        fallbackMessage: fallback,
        systemPrompt,
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

  async function testPrompt() {
    if (!testQuestion.trim()) return;
    
    setTesting(true);
    setTestResults({});
    setError(null);
    
    try {
      // Test with current (unsaved) settings by temporarily saving them
      const tempSettings: Settings = {
        agentName,
        confidenceThreshold: confidence,
        fallbackMessage: fallback,
        systemPrompt,
        allowedOrigins: origins.split(',').map(s=>s.trim()).filter(Boolean),
        notifyEmails: emails.split(',').map(s=>s.trim()).filter(Boolean),
      };
      (tempSettings as any).organizationType = orgType;
      (tempSettings as any).categories = categories;
      (tempSettings as any).audiences = audiences;
      
      await putSettings(tempSettings, agentId);
      
      // Get current result with new system prompt
      const currentResult = await ask(testQuestion, agentId, '', true);
      
      setTestResults({ current: currentResult });
    } catch (e: any) {
      setError(`Test failed: ${e.message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Layout>
      <div>
        <div className="grid cols-2" style={{marginBottom:16}}>
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
            <h3 className="card-title">Test Your System Prompt</h3>
            <p className="muted">Test how your system prompt affects AI responses.</p>
            
            <label>Test Question</label>
            <input className="input" placeholder="Ask a question to test the prompt..." 
              value={testQuestion} onChange={e=>setTestQuestion(e.target.value)} />
            
            <div className="row" style={{marginTop:12}}>
              <button className="btn" onClick={testPrompt} disabled={testing || !testQuestion.trim()}>
                {testing ? 'Testing...' : 'Test Prompt'}
              </button>
            </div>
            
            {testResults.current && (
              <div style={{marginTop:16}}>
                <h4>Test Result</h4>
                <div style={{padding:12, background:'#f8f9fa', borderRadius:6, marginTop:8}}>
                  <div><strong>Answer:</strong> {testResults.current.answer}</div>
                  <div style={{marginTop:8}}><strong>Confidence:</strong> {(testResults.current.confidence * 100).toFixed(1)}%</div>
                  <div><strong>Grounded:</strong> {testResults.current.grounded ? 'Yes' : 'No'}</div>
                  {testResults.current.citations?.length > 0 && (
                    <div><strong>Citations:</strong> {testResults.current.citations.map((c: any) => c.docId).join(', ')}</div>
                  )}
                </div>
              </div>
            )}
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
          
          <label style={{marginTop:12}}>System Prompt</label>
          <textarea className="textarea" rows={8} placeholder="Enter the system prompt that will guide how the AI responds to questions..." 
            value={systemPrompt} onChange={e=>setSystemPrompt(e.target.value)} />
          <div className="muted mini" style={{marginTop:4}}>This prompt will be sent to the AI to define its behavior and response style.</div>
          
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
