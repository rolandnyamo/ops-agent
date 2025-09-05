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

export async function ask(q: string, agentId?: string, filter?: string){
  const res = await fetch(`${cfg.apiBase}/qa`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify({ q, agentId, filter }) });
  if (!res.ok) throw new Error(`qa ${res.status}`);
  return res.json() as Promise<{ answer: string; grounded: boolean; confidence: number; citations: Array<{docId:string; chunk:number; score:number}> } >;
}
