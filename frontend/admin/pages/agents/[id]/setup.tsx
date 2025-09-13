import { useEffect, useState } from 'react';
import Layout from '../../../components/Layout';
import { getSettings, putSettings, inferSettings, type Settings } from '../../../lib/api';
import { useRouter } from 'next/router';
import Link from 'next/link';

export default function Setup(){
  const { query } = useRouter();
  const agentId = String(query.id || '');
  const [agentName, setAgentName] = useState('Agent');
  const [confidence, setConfidence] = useState(0.45);
  const [fallback, setFallback] = useState('Sorry, I could not find this in the documentation.');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showSystemPromptModal, setShowSystemPromptModal] = useState(false);
  const [orgType, setOrgType] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [audiences, setAudiences] = useState<string[]>(['All']);
  const [origins, setOrigins] = useState('https://www.example.edu');
  const [emails, setEmails] = useState('info@example.edu');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
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
  }, [agentId]);

  async function save(){
    setError(null);
    setSaving(true);
    setSaved(false);
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
      setTimeout(()=>setSaved(false), 3000); // Show for 3 seconds
    } catch (e:any) {
      setError('Save failed. Please check values and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <Link 
          href={`/agents/${encodeURIComponent(agentId)}`} 
          className="btn" 
          style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            textDecoration: 'none',
            fontSize: '14px',
            padding: '8px 16px'
          }}
        >
          ← Back to Agent
        </Link>
      </div>
      
      <div className="card">
        <h3 className="card-title">Agent Settings</h3>
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
          <div style={{position: 'relative'}}>
            <textarea 
              className="textarea" 
              rows={4} 
              placeholder="Custom instructions for the AI assistant (leave empty to use default)"
              value={systemPrompt} 
              onChange={e=>setSystemPrompt(e.target.value)}
              style={{paddingRight: '80px'}}
            />
            <button 
              type="button"
              className="btn"
              onClick={() => setShowSystemPromptModal(true)}
              style={{
                position: 'absolute',
                right: '8px',
                top: '8px',
                padding: '4px 8px',
                fontSize: '12px',
                background: '#4f46e5',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Expand
            </button>
          </div>
          
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
            <button 
              className="btn" 
              onClick={save} 
              disabled={loading || saving}
              style={{
                opacity: (loading || saving) ? 0.6 : 1,
                cursor: (loading || saving) ? 'not-allowed' : 'pointer'
              }}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            {saved && <div className="chip" style={{color: 'green', fontWeight: 'bold'}}>✓ Settings saved successfully</div>}
            {error && <div style={{color: 'red', fontSize: '14px', marginLeft: '10px'}}>{error}</div>}
          </div>
        </div>

        {/* System Prompt Modal */}
        {showSystemPromptModal && (
          <div 
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowSystemPromptModal(false);
            }}
          >
            <div 
              style={{
                background: 'white',
                borderRadius: '8px',
                padding: '24px',
                width: '90vw',
                maxWidth: '800px',
                maxHeight: '90vh',
                overflow: 'auto',
                border: '1px solid #e5e7eb',
                color: '#1f2937'
              }}
            >
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px'}}>
                <h3 style={{margin: 0, fontSize: '18px', fontWeight: '600', color: '#1f2937'}}>Edit System Prompt</h3>
                <button 
                  onClick={() => setShowSystemPromptModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '24px',
                    cursor: 'pointer',
                    padding: '0',
                    color: '#6b7280'
                  }}
                >
                  ×
                </button>
              </div>
              
              <div style={{marginBottom: '16px'}}>
                <p style={{margin: '0 0 8px 0', color: '#6b7280', fontSize: '14px'}}>
                  This prompt controls how your AI agent responds to questions. It will be combined with the retrieved document context and user questions.
                </p>
              </div>

              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Enter your custom system prompt here. For example:

You are a helpful customer service assistant for [Company Name]. Always:
- Be friendly and professional
- Start with the most important information
- Use bullet points for lists
- Include relevant contact information when appropriate
- If you can't find specific information, guide users to the right resources

Format your responses to be clear and easy to read."
                style={{
                  width: '100%',
                  minHeight: '300px',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", monospace',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  color: '#1f2937',
                  backgroundColor: '#ffffff'
                }}
              />

              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px'}}>
                <div style={{fontSize: '12px', color: '#6b7280'}}>
                  Characters: {systemPrompt.length}
                </div>
                <div style={{display: 'flex', gap: '8px'}}>
                  <button 
                    onClick={() => {
                      setSystemPrompt('');
                    }}
                    style={{
                      padding: '8px 16px',
                      border: '1px solid #d1d5db',
                      background: 'white',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: '#374151'
                    }}
                  >
                    Clear
                  </button>
                  <button 
                    onClick={() => {
                      setSystemPrompt(`You are a helpful assistant that provides concise, well-formatted answers based on documentation. 

Guidelines:
- Keep answers brief and to the point
- Use bullet points or lists when presenting multiple items
- Start with the most important/direct information
- Format numbers and prices clearly
- If the context is incomplete, briefly mention what's missing

Format your response to be easily scannable.`);
                    }}
                    style={{
                      padding: '8px 16px',
                      border: '1px solid #d1d5db',
                      background: 'white',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: '#374151'
                    }}
                  >
                    Reset to Default
                  </button>
                  <button 
                    onClick={() => setShowSystemPromptModal(false)}
                    style={{
                      padding: '8px 16px',
                      background: '#4f46e5',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
    </Layout>
  );
}
