import React, { createContext, useContext, useEffect, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

type AgentCtx = { agentId: string; setAgentId: (id:string)=>void; agents: string[]; refresh: ()=>Promise<void> };
const Ctx = createContext<AgentCtx>({ agentId: 'default', setAgentId: ()=>{}, agents: [], refresh: async()=>{} });

export function AgentProvider({ children }: { children: React.ReactNode }){
  const [agentId, setAgentIdState] = useState<string>('default');
  const [agents, setAgents] = useState<string[]>([]);
  function setAgentId(id:string){ setAgentIdState(id); if (typeof window!=='undefined') localStorage.setItem('agentId', id); }
  async function refresh(){
    try{
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/agents`, { headers: await auth() });
      if (res.ok){ const j = await res.json(); setAgents((j.items||[]).map((x:any)=>x.agentId)); }
    }catch{}
  }
  useEffect(()=>{ const saved = typeof window!=='undefined' ? localStorage.getItem('agentId') : null; if (saved) setAgentIdState(saved); refresh(); },[]);
  return <Ctx.Provider value={{ agentId, setAgentId, agents, refresh }}>{children}</Ctx.Provider>;
}

export function useAgent(){ return useContext(Ctx); }

async function auth(){
  try { const { tokens } = await fetchAuthSession(); const id = tokens?.idToken?.toString(); return id ? { Authorization: `Bearer ${id}` } : {}; } catch { return {}; }
}

