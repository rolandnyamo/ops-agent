import Layout from '../../../components/Layout';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { getSynonymsDraft, putSynonymsDraft, publishSynonyms, generateSynonyms, type SynonymGroup, getSettings, putSettings, type Settings } from '../../../lib/api';

export default function SynonymsPage(){
  const { query } = useRouter();
  const agentId = String(query.id || '');
  const [groups, setGroups] = useState<SynonymGroup[]>([]);
  const [version, setVersion] = useState<string|undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string|undefined>();
  const [autoApprove, setAutoApprove] = useState<boolean>(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    (async () => {
      try {
        const [draft, settings] = await Promise.all([
          getSynonymsDraft(agentId),
          getSettings(agentId)
        ]);
        const d = draft?.draft;
        setGroups(d?.groups || []);
        setVersion(d?.version);
        setAutoApprove(!!settings?.search?.synonyms?.autoApprove);
        setSettingsLoaded(true);
      } catch (e:any) {
        setError('Failed to load synonyms draft');
      } finally {
        setLoading(false);
      }
    })();
  }, [agentId]);

  function addGroup(){
    setGroups(g => [...g, { canonical: '', variants: [], weight: 1 }]);
  }
  function removeGroup(idx: number){
    setGroups(g => g.filter((_,i)=>i!==idx));
  }
  function updateGroup(idx: number, patch: Partial<SynonymGroup>){
    setGroups(g => g.map((row,i)=> i===idx ? { ...row, ...patch } : row));
  }
  function updateVariants(idx: number, text: string){
    const variants = text.split(',').map(s=>s.trim()).filter(Boolean);
    updateGroup(idx, { variants });
  }

  async function saveDraft(){
    setSaving(true); setError(undefined);
    try {
      await putSynonymsDraft(agentId, groups, version);
    } catch (e:any) {
      setError('Failed to save draft');
    } finally { setSaving(false); }
  }

  async function doPublish(){
    setPublishing(true); setError(undefined);
    try {
      await publishSynonyms(agentId);
    } catch (e:any) {
      setError('Publish failed');
    } finally { setPublishing(false); }
  }

  async function regen(){
    setGenerating(true); setError(undefined);
    try {
      await generateSynonyms(agentId);
      const { draft } = await getSynonymsDraft(agentId);
      setGroups(draft?.groups || []);
      setVersion(draft?.version);
    } catch (e:any) {
      setError('Generation failed');
    } finally { setGenerating(false); }
  }

  async function saveAutoApprove(next: boolean){
    try {
      const s = await getSettings(agentId);
      const payload: Settings = { ...s, allowedOrigins: s.allowedOrigins||[], notifyEmails: s.notifyEmails||[] } as Settings;
      payload.search = { ...(s.search||{}), synonyms: { ...(s.search?.synonyms||{}), autoApprove: next } };
      await putSettings(payload, agentId);
      setAutoApprove(next);
    } catch (e:any) {
      setError('Failed to update auto-approve');
    }
  }

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <Link href={`/agents/${encodeURIComponent(agentId)}`} className="btn">← Back to Agent</Link>
      </div>

      <div className="card">
        <h3 className="card-title">Synonyms</h3>
        {error && <div className="chip" style={{borderColor:'#744'}}>{error}</div>}
        {loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <>
            <div className="row" style={{alignItems:'center', gap: 12, marginBottom: 12}}>
              <label style={{display:'inline-flex', alignItems:'center', gap:8}}>
                <input type="checkbox" checked={autoApprove} disabled={!settingsLoaded} onChange={e=>saveAutoApprove(e.target.checked)} />
                Auto-approve generated synonyms
              </label>
              <button className="btn ghost" onClick={regen} disabled={generating}>{generating ? 'Generating…' : 'Regenerate'}</button>
              <button className="btn" onClick={saveDraft} disabled={saving}>{saving ? 'Saving…' : 'Save Draft'}</button>
              <button className="btn" onClick={doPublish} disabled={publishing}>{publishing ? 'Publishing…' : 'Publish'}</button>
            </div>
            <div className="muted mini" style={{marginBottom:8}}>Version: {version || '—'}</div>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left', borderBottom:'1px solid var(--line)', padding:'6px'}}>Canonical</th>
                  <th style={{textAlign:'left', borderBottom:'1px solid var(--line)', padding:'6px'}}>Variants (comma-separated)</th>
                  <th style={{textAlign:'left', borderBottom:'1px solid var(--line)', padding:'6px', width:100}}>Weight</th>
                  <th style={{textAlign:'left', borderBottom:'1px solid var(--line)', padding:'6px', width:80}}></th>
                </tr>
              </thead>
              <tbody>
              {groups.map((g, idx) => (
                <tr key={idx}>
                  <td style={{padding:'6px'}}>
                    <input className="input" value={g.canonical} onChange={e=>updateGroup(idx, { canonical: e.target.value })} />
                  </td>
                  <td style={{padding:'6px'}}>
                    <input className="input" value={(g.variants||[]).join(', ')} onChange={e=>updateVariants(idx, e.target.value)} />
                  </td>
                  <td style={{padding:'6px'}}>
                    <input className="input" type="number" min={0} step={1} value={g.weight||1} onChange={e=>updateGroup(idx, { weight: Number(e.target.value) })} />
                  </td>
                  <td style={{padding:'6px'}}>
                    <button className="btn ghost" onClick={()=>removeGroup(idx)}>Remove</button>
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
            <div style={{marginTop:12}}>
              <button className="btn ghost" onClick={addGroup}>Add Group</button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

