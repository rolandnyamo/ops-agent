import React, { useMemo, useState } from 'react';
import { ask } from '../lib/api';
import { useAgent } from '../lib/agent';

type Msg = { id: string; role: 'me'|'bot'; text: string };

export default function ChatPanel(){
  const { agentId } = useAgent();
  const seed: Msg[] = useMemo(() => ([
    { id: 'm1', role: 'bot', text: 'Hi! Ask anything grounded in your docs.' },
  ]), []);
  const [messages, setMessages] = useState<Msg[]>(seed);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(){
    if(!q.trim() || busy) return;
    const id = Math.random().toString(36).slice(2);
    const mine: Msg = { id, role: 'me', text: q };
    setMessages(m => [...m, mine]);
    setQ('');
    setBusy(true);
    try{
      const r = await ask(q, agentId);
      const answer = r.answer || 'No answer';
      const cites = (r.citations||[]).map(c=>`[${c.docId} #${c.chunk}] (${c.score})`).join(' ');
      setMessages(m => [...m, { id: 'b'+id, role: 'bot', text: `${answer}\n\n${cites}` }]);
    } catch(e:any){
      setMessages(m => [...m, { id: 'b'+id, role: 'bot', text: 'Error calling /qa' }]);
    }
    setBusy(false);
  }

  return (
    <div className="card">
      <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
        <h3 className="card-title" style={{margin:0}}>Chat</h3>
        <div className="chip mini"><span style={{height:8,width:8,borderRadius:4,background:'var(--sea)'}}/> Mocked</div>
      </div>
      <div className="chat">
        {messages.map(m => (
          <div key={m.id} className={`bubble ${m.role}`}>{m.text}</div>
        ))}
      </div>
      <div className="footer">
        <input className="input" placeholder="Ask a question..." value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') send(); }} />
        <button className="btn" onClick={send} disabled={busy}>{busy?'...':'Send'}</button>
      </div>
    </div>
  );
}
