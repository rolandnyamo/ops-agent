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

