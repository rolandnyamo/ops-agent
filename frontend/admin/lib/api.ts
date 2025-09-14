import { fetchAuthSession } from 'aws-amplify/auth';
import { cfg } from './config';

async function authHeader() {
  try {
    const { tokens } = await fetchAuthSession();
    const id = tokens?.idToken?.toString();
    return id ? { Authorization: `Bearer ${id}` } : {};
  } catch {
    return {};
  }
}

export type Settings = {
  agentName: string;
  confidenceThreshold: number;
  fallbackMessage: string;
  systemPrompt?: string;
  allowedOrigins: string[];
  notifyEmails: string[];
  updatedAt?: string;
};

export async function getSettings(agentId?: string): Promise<Settings> {
  const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  const res = await fetch(`${cfg.apiBase}/settings${qs}`, { headers: { 'Content-Type': 'application/json', ...(await authHeader()) } });
  if (!res.ok) throw new Error(`GET /settings ${res.status}`);
  return res.json();
}

export async function putSettings(data: Settings, agentId?: string): Promise<Settings> {
  const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  const res = await fetch(`${cfg.apiBase}/settings${qs}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`PUT /settings ${res.status}`);
  return res.json();
}

// Docs API
export type DocItem = {
  PK: string; SK: string; SK1?: string; SK2?: string;
  docId: string;
  title: string;
  description?: string;
  category?: string;
  audience?: string;
  year?: string;
  version?: string;
  sourceType?: 'upload'|'url'|'unknown';
  fileKey?: string;
  size?: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
};

export async function createUploadUrl(filename: string, contentType: string, agentId?: string){
  const res = await fetch(`${cfg.apiBase}/docs/upload-url${agentId?`?agentId=${encodeURIComponent(agentId)}`:''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ filename, contentType })
  });
  if (!res.ok) throw new Error(`upload-url ${res.status}`);
  return res.json() as Promise<{ docId: string; fileKey: string; uploadUrl: string; contentType: string }>;
}

export async function ingestDoc(payload: { docId: string; title: string; description?: string; category?: string; audience?: string; year?: string; version?: string; fileKey?: string; url?: string; }, agentId?: string){
  if (agentId) (payload as any).agentId = agentId;
  const res = await fetch(`${cfg.apiBase}/docs/ingest${agentId?`?agentId=${encodeURIComponent(agentId)}`:''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`ingest ${res.status}`);
  return res.json() as Promise<DocItem>;
}

export async function listDocs(agentId?: string){
  const res = await fetch(`${cfg.apiBase}/docs${agentId?`?agentId=${encodeURIComponent(agentId)}`:''}`, { headers: { ...(await authHeader()) } });
  if (!res.ok) throw new Error(`list ${res.status}`);
  return res.json() as Promise<{ items: DocItem[]; count: number; nextToken?: string|null }>;
}

export async function updateDoc(docId: string, patch: Partial<DocItem>, agentId?: string){
  const res = await fetch(`${cfg.apiBase}/docs/${docId}${agentId?`?agentId=${encodeURIComponent(agentId)}`:''}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error(`update ${res.status}`);
  return res.json() as Promise<DocItem>;
}

export async function deleteDoc(docId: string, agentId?: string){
  const res = await fetch(`${cfg.apiBase}/docs/${docId}${agentId?`?agentId=${encodeURIComponent(agentId)}`:''}`, { method: 'DELETE', headers: { ...(await authHeader()) } });
  if (!res.ok) throw new Error(`delete ${res.status}`);
  return res.json() as Promise<{ ok: boolean }>;
}

// Infer API
export async function inferSettings(useCase: string){
  const res = await fetch(`${cfg.apiBase}/infer?mode=settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify({ useCase }) });
  if (!res.ok) throw new Error(`infer settings ${res.status}`);
  return res.json() as Promise<{ agentName: string; confidenceThreshold: number; fallbackMessage: string; organizationType?: string; categories?: string[]; audiences?: string[]; notes?: string } >;
}

export async function inferDoc(filename: string, sampleText: string, categories?: string[]){
  const res = await fetch(`${cfg.apiBase}/infer?mode=doc`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify({ filename, sampleText, categories }) });
  if (!res.ok) throw new Error(`infer doc ${res.status}`);
  return res.json() as Promise<{ title: string; category: string; audience: string; year: number|string; version: string; description: string } >;
}

export async function ask(q: string, agentId?: string, filter?: string, debug?: boolean){
  const res = await fetch(`${cfg.apiBase}/qa`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify({ q, agentId, filter, debug }) });
  if (!res.ok) throw new Error(`qa ${res.status}`);
  return res.json() as Promise<{ 
    answer: string; 
    grounded: boolean; 
    confidence: number; 
    citations: Array<{docId:string; chunk:number; score:number}>;
    debug?: {
      timing: { total: number; vectorSearch: number; aiGeneration: number; embedding: number };
      vectorSearch: { resultsCount: number; appliedFilter: any; vectorLength: number; vectorSample: number[] };
      rawResults: Array<{ score: number; docId: string; chunkIdx: number; title: string; textPreview: string; fullTextLength: number }>;
      retrievedChunks: string[];
      confidenceAnalysis: { threshold: number; topScore: number; isGrounded: boolean; scoresAboveThreshold: number };
      agentSettings: { agentId: string; confidenceThreshold: number; fallbackMessage: string };
      aiProcessing?: { systemPrompt: string; userPrompt: string; snippetsUsed: number; totalSnippetLength: number };
    };
  }>;
}

// Agents API
export type AgentSummary = { agentId: string };
export type AgentSettings = Settings & { agentId?: string; notes?: string };

export async function listAgents(){
  const res = await fetch(`${cfg.apiBase}/agents`, { headers: { ...(await authHeader()) } });
  if (!res.ok) throw new Error(`list agents ${res.status}`);
  return res.json() as Promise<{ items: AgentSummary[] }>;
}

export async function getAgent(agentId: string){
  const res = await fetch(`${cfg.apiBase}/agents/${encodeURIComponent(agentId)}`, { headers: { ...(await authHeader()) } });
  if (!res.ok) throw new Error(`get agent ${res.status}`);
  return res.json() as Promise<AgentSettings>;
}

export async function createAgent(useCase?: string){
  const res = await fetch(`${cfg.apiBase}/agents`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify({ useCase }) });
  if (!res.ok) throw new Error(`create agent ${res.status}`);
  return res.json() as Promise<{ agentId: string }>;
}

export async function deleteAgent(agentId: string){
  const res = await fetch(`${cfg.apiBase}/agents/${encodeURIComponent(agentId)}`, { 
    method: 'DELETE', 
    headers: { ...(await authHeader()) } 
  });
  if (!res.ok) throw new Error(`delete agent ${res.status}`);
  return res.json() as Promise<{ success: boolean }>;
}

// User Management API
export type User = {
  userId: string;
  email: string;
  emailVerified: boolean;
  status: string;
  enabled: boolean;
  created: string;
  lastModified: string;
  displayStatus: string;
};

export async function getUsers(): Promise<{ users: User[] }> {
  const res = await fetch(`${cfg.apiBase}/users`, { 
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) } 
  });
  if (!res.ok) throw new Error(`GET /users ${res.status}`);
  return res.json();
}

export async function getUser(userId: string): Promise<{ user: User }> {
  const res = await fetch(`${cfg.apiBase}/users/${encodeURIComponent(userId)}`, { 
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) } 
  });
  if (!res.ok) throw new Error(`GET /users/${userId} ${res.status}`);
  return res.json();
}

export async function inviteUser(email: string): Promise<{ message: string; user: User }> {
  const res = await fetch(`${cfg.apiBase}/users/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`POST /users/invite ${res.status}`);
  return res.json();
}

export async function activateUser(userId: string): Promise<{ message: string }> {
  const res = await fetch(`${cfg.apiBase}/users/${encodeURIComponent(userId)}/activate`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(`PUT /users/${userId}/activate ${res.status}`);
  return res.json();
}

export async function deactivateUser(userId: string): Promise<{ message: string }> {
  const res = await fetch(`${cfg.apiBase}/users/${encodeURIComponent(userId)}/deactivate`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(`PUT /users/${userId}/deactivate ${res.status}`);
  return res.json();
}

export async function deleteUser(userId: string): Promise<{ message: string }> {
  const res = await fetch(`${cfg.apiBase}/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(`DELETE /users/${userId} ${res.status}`);
  return res.json();
}

// Bot Management API
export type Bot = {
  botId: string;
  botName: string;
  platform: string;
  siteUrl: string;
  apiKey: string;
  status: 'active' | 'inactive';
  createdAt: string;
  lastUsed: string | null;
  configuration: {
    theme: string;
    position: string;
    primaryColor: string;
    welcomeMessage: string;
  };
};

export type CreateBotRequest = {
  botName: string;
  platform: string;
  siteUrl: string;
};

export async function listBots(agentId: string): Promise<Bot[]> {
  const res = await fetch(`${cfg.apiBase}/agents/${encodeURIComponent(agentId)}/bots`, { 
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) } 
  });
  if (!res.ok) throw new Error(`GET /agents/${agentId}/bots ${res.status}`);
  return res.json();
}

export async function getBot(agentId: string, botId: string): Promise<Bot> {
  const res = await fetch(`${cfg.apiBase}/agents/${encodeURIComponent(agentId)}/bots/${encodeURIComponent(botId)}`, { 
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) } 
  });
  if (!res.ok) throw new Error(`GET /agents/${agentId}/bots/${botId} ${res.status}`);
  return res.json();
}

export async function createBot(agentId: string, botData: CreateBotRequest): Promise<Bot> {
  const res = await fetch(`${cfg.apiBase}/agents/${encodeURIComponent(agentId)}/bots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(botData),
  });
  if (!res.ok) throw new Error(`POST /agents/${agentId}/bots ${res.status}`);
  return res.json();
}

export async function updateBot(agentId: string, botId: string, updates: Partial<Bot>): Promise<Bot> {
  const res = await fetch(`${cfg.apiBase}/agents/${encodeURIComponent(agentId)}/bots/${encodeURIComponent(botId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`PUT /agents/${agentId}/bots/${botId} ${res.status}`);
  return res.json();
}

export async function deleteBot(agentId: string, botId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${cfg.apiBase}/agents/${encodeURIComponent(agentId)}/bots/${encodeURIComponent(botId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(`DELETE /agents/${agentId}/bots/${botId} ${res.status}`);
  return { success: true };
}

export async function getAllBots(): Promise<Bot[]> {
  const res = await fetch(`${cfg.apiBase}/bots`, { 
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) } 
  });
  if (!res.ok) throw new Error(`GET /bots ${res.status}`);
  return res.json();
}
