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

export async function getSettings(): Promise<Settings> {
  const res = await fetch(`${cfg.apiBase}/settings`, { headers: { 'Content-Type': 'application/json', ...(await authHeader()) } });
  if (!res.ok) throw new Error(`GET /settings ${res.status}`);
  return res.json();
}

export async function putSettings(data: Settings): Promise<Settings> {
  const res = await fetch(`${cfg.apiBase}/settings`, {
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

export async function createUploadUrl(filename: string, contentType: string){
  const res = await fetch(`${cfg.apiBase}/docs/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ filename, contentType })
  });
  if (!res.ok) throw new Error(`upload-url ${res.status}`);
  return res.json() as Promise<{ docId: string; fileKey: string; uploadUrl: string; contentType: string }>;
}

export async function ingestDoc(payload: { docId: string; title: string; description?: string; category?: string; audience?: string; year?: string; version?: string; fileKey?: string; url?: string; }){
  const res = await fetch(`${cfg.apiBase}/docs/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`ingest ${res.status}`);
  return res.json() as Promise<DocItem>;
}

export async function listDocs(){
  const res = await fetch(`${cfg.apiBase}/docs`, { headers: { ...(await authHeader()) } });
  if (!res.ok) throw new Error(`list ${res.status}`);
  return res.json() as Promise<{ items: DocItem[]; count: number; nextToken?: string|null }>;
}

export async function updateDoc(docId: string, patch: Partial<DocItem>){
  const res = await fetch(`${cfg.apiBase}/docs/${docId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error(`update ${res.status}`);
  return res.json() as Promise<DocItem>;
}

export async function deleteDoc(docId: string){
  const res = await fetch(`${cfg.apiBase}/docs/${docId}`, { method: 'DELETE', headers: { ...(await authHeader()) } });
  if (!res.ok) throw new Error(`delete ${res.status}`);
  return res.json() as Promise<{ ok: boolean }>;
}
