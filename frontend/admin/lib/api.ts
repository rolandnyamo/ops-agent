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
  search?: {
    queryExpansion?: { enabled?: boolean; maxVariants?: number };
    lexicalBoost?: { enabled?: boolean; presenceBoost?: number; overlapBoost?: number };
    embeddingModel?: string;
    vectorIndex?: string;
  };
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

// Translation API
export type TranslationItem = {
  PK: string;
  SK: string;
  SK1?: string;
  translationId: string;
  ownerId: string;
  title: string;
  description?: string;
  sourceLanguage: string;
  targetLanguage: string;
  status: 'PROCESSING' | 'READY_FOR_REVIEW' | 'APPROVED' | 'FAILED';
  originalFilename?: string;
  originalFileKey?: string;
  machineFileKey?: string;
  translatedFileKey?: string;
  translatedHtmlKey?: string;
  provider?: string;
  model?: string;
  createdAt?: string;
  updatedAt?: string;
  translatedAt?: string;
  approvedAt?: string;
  errorMessage?: string;
  restartedAt?: string;
  healthCheckReason?: string | null;
};

export type TranslationChunk = {
  id: string;
  order: number;
  sourceHtml: string;
  sourceText?: string;
  machineHtml?: string;
  reviewerHtml?: string;
  lastUpdatedBy?: string;
  lastUpdatedAt?: string;
  reviewerName?: string;
};

export type TranslationLogEntry = {
  logId?: string;
  translationId: string;
  ownerId: string;
  createdAt: string;
  eventType: string;
  status?: string | null;
  message?: string | null;
  actor?: { type?: string; email?: string | null; name?: string | null; sub?: string | null; source?: string } | null;
  metadata?: Record<string, any> | null;
};

export async function createTranslationUploadUrl(filename: string, contentType: string){
  const res = await fetch(`${cfg.apiBase}/translations/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ filename, contentType })
  });
  if (!res.ok) throw new Error(`translation upload-url ${res.status}`);
  return res.json() as Promise<{ ownerId: string; translationId: string; uploadUrl: string; fileKey: string; contentType: string; filename: string }>;
}

export async function createTranslation(payload: { translationId: string; fileKey: string; originalFilename: string; title?: string; description?: string; sourceLanguage: string; targetLanguage: string; }){
  const res = await fetch(`${cfg.apiBase}/translations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`create translation ${res.status}`);
  return res.json() as Promise<TranslationItem>;
}

export async function listTranslations(){
  const res = await fetch(`${cfg.apiBase}/translations`, { headers: { ...(await authHeader()) } });
  if (!res.ok) throw new Error(`list translations ${res.status}`);
  return res.json() as Promise<{ items: TranslationItem[] }>;
}

export async function getTranslation(translationId: string){
  const res = await fetch(`${cfg.apiBase}/translations/${encodeURIComponent(translationId)}`, { headers: { ...(await authHeader()) } });
  if (!res.ok) throw new Error(`get translation ${res.status}`);
  return res.json() as Promise<TranslationItem>;
}

export async function getTranslationChunks(translationId: string){
  const res = await fetch(`${cfg.apiBase}/translations/${encodeURIComponent(translationId)}/chunks`, { headers: { ...(await authHeader()) } });
  if (!res.ok) throw new Error(`get translation chunks ${res.status}`);
  return res.json() as Promise<{ translationId?: string; chunks: TranslationChunk[]; headHtml?: string; sourceLanguage?: string; targetLanguage?: string; lastReviewedAt?: string; reviewLocked?: boolean; message?: string }>;
}

export async function updateTranslationChunks(translationId: string, chunks: Array<{ id: string; reviewerHtml: string; }>){
  const res = await fetch(`${cfg.apiBase}/translations/${encodeURIComponent(translationId)}/chunks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ chunks })
  });
  if (!res.ok) throw new Error(`update translation chunks ${res.status}`);
  return res.json() as Promise<{ chunks: TranslationChunk[]; headHtml?: string; lastReviewedAt?: string }>;
}

export async function approveTranslation(translationId: string){
  const res = await fetch(`${cfg.apiBase}/translations/${encodeURIComponent(translationId)}/approve`, {
    method: 'POST',
    headers: { ...(await authHeader()) }
  });
  if (!res.ok) throw new Error(`approve translation ${res.status}`);
  return res.json() as Promise<{ status: string; translatedFileKey?: string }>;
}

export async function getTranslationDownloadUrl(
  translationId: string,
  type:
    | 'original'
    | 'machine'
    | 'translated'
    | 'translatedHtml'
    | 'translatedDocx'
    | 'translatedPdf' = 'original'
){
  const res = await fetch(`${cfg.apiBase}/translations/${encodeURIComponent(translationId)}/download?type=${encodeURIComponent(type)}`, {
    headers: { ...(await authHeader()) }
  });
  if (!res.ok) throw new Error(`download translation ${res.status}`);
  return res.json() as Promise<{ url: string; key: string }>;
}

export async function deleteTranslation(translationId: string){
  const res = await fetch(`${cfg.apiBase}/translations/${encodeURIComponent(translationId)}`, {
    method: 'DELETE',
    headers: { ...(await authHeader()) }
  });
  if (!res.ok) throw new Error(`delete translation ${res.status}`);
  return res.json() as Promise<{ translationId: string; deleted: boolean }>;
}

export async function restartTranslation(translationId: string){
  const res = await fetch(`${cfg.apiBase}/translations/${encodeURIComponent(translationId)}/restart`, {
    method: 'POST',
    headers: { ...(await authHeader()) }
  });
  if (!res.ok) throw new Error(`restart translation ${res.status}`);
  return res.json() as Promise<{ message: string }>;
}

export async function listTranslationLogs(translationId: string, nextToken?: string, limit = 20){
  const params = new URLSearchParams();
  if (nextToken) params.set('nextToken', nextToken);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${cfg.apiBase}/translations/${encodeURIComponent(translationId)}/logs${qs}`, {
    headers: { ...(await authHeader()) }
  });
  if (!res.ok) throw new Error(`list translation logs ${res.status}`);
  return res.json() as Promise<{ items: TranslationLogEntry[]; nextToken?: string | null }>;
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
  return res.json() as Promise<{ title: string; category: string; audience: string; year: number|string; version: string; description: string; language?: string } >;
}

export type AnswerFormat = 'html' | 'markdown' | 'text';

export async function ask(q: string, agentId?: string, filter?: string, debug?: boolean, responseFormat: AnswerFormat = 'html'){
  const payload: Record<string, any> = { q, agentId, filter, debug };
  if (responseFormat) {
    payload.responseFormat = responseFormat;
  }
  const res = await fetch(`${cfg.apiBase}/qa`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`qa ${res.status}`);
  return res.json() as Promise<{
    answer: string;
    answerFormat: AnswerFormat;
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
export type NotificationPreferences = {
  translation: { started: boolean; completed: boolean; failed: boolean };
  documentation: { started: boolean; completed: boolean; failed: boolean };
};

export type User = {
  userId: string;
  email: string;
  emailVerified: boolean;
  status: string;
  enabled: boolean;
  created: string;
  lastModified: string;
  displayStatus: string;
  notifications?: {
    email: string | null;
    preferences: NotificationPreferences;
  };
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

export async function updateUserNotificationPreferences(userId: string, payload: { email?: string; preferences: NotificationPreferences }): Promise<{ userId: string; email: string | null; preferences: NotificationPreferences }> {
  const res = await fetch(`${cfg.apiBase}/users/${encodeURIComponent(userId)}/notifications`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`PUT /users/${userId}/notifications ${res.status}`);
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
