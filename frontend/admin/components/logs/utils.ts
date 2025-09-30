import type { JobLogEntry } from '../../lib/api';

export const CATEGORY_LABELS: Record<string, string> = {
  ingestion: 'Ingestion',
  parsing: 'Parsing',
  translation: 'Translation',
  qa: 'Quality Assurance',
  delivery: 'Delivery',
  cleanup: 'Cleanup',
  retry: 'Retries',
  metadata: 'Metadata',
  general: 'General',
  uncategorized: 'Uncategorized'
};

export const CATEGORY_ORDER = [
  'general',
  'ingestion',
  'parsing',
  'translation',
  'qa',
  'delivery',
  'metadata',
  'retry',
  'cleanup'
];

export const STAGE_LABELS: Record<string, string> = {
  upload: 'Upload',
  ingestion: 'Ingestion',
  parsing: 'Parsing',
  'chunk-prep': 'Chunk Prep',
  'machine-translation': 'Machine Translation',
  'machine-output': 'Machine Output',
  'human-review': 'Human Review',
  'chunk-persist': 'Chunk Persist',
  indexing: 'Indexing',
  embedding: 'Embedding',
  delivery: 'Delivery',
  cleanup: 'Cleanup',
  monitoring: 'Monitoring',
  'manual-restart': 'Manual Restart',
  'auto-restart': 'Automatic Restart',
  'auto-fail': 'Automatic Failure',
  'metadata-update': 'Metadata Update'
};

export type LogViewMode = 'grouped' | 'list';

export function formatCategory(category?: string | null): string {
  if (!category) return CATEGORY_LABELS.uncategorized;
  return CATEGORY_LABELS[category] || category.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function formatStage(stage?: string | null): string {
  if (!stage) return '—';
  return STAGE_LABELS[stage] || stage.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function formatActor(actor?: JobLogEntry['actor']): string {
  if (!actor) return 'Unknown';
  return actor.name || actor.email || actor.sub || actor.source || (actor.type === 'system' ? 'System' : actor.type) || 'Unknown';
}

export function resolveEntryIdentity(entry: JobLogEntry): string | null {
  if (entry.logId) return entry.logId;
  const parts = [
    entry.jobId,
    entry.createdAt,
    entry.eventType,
    entry.stage ?? '',
    entry.status ?? '',
    entry.message ?? ''
  ].map((part) => part ? String(part) : '').filter(Boolean);
  return parts.length ? parts.join('|') : null;
}

export function getLogEntryKey(entry: JobLogEntry, index: number): string {
  const identity = resolveEntryIdentity(entry);
  if (identity) return identity;
  return `${index}-${entry.createdAt || 'unknown'}`;
}

export function groupLogs(entries: JobLogEntry[]): Record<string, JobLogEntry[]> {
  return entries.reduce<Record<string, JobLogEntry[]>>((acc, entry) => {
    const key = entry.category || 'uncategorized';
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});
}

export function sortCategories(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export function orderLogsByCreatedAt(entries: JobLogEntry[]): JobLogEntry[] {
  return [...entries].sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bTime - aTime;
  });
}

export function mergeLogEntries(existing: JobLogEntry[], incoming: JobLogEntry[]): JobLogEntry[] {
  const map = new Map<string, JobLogEntry>();
  const ensureKey = (entry: JobLogEntry, index: number, prefix: string) => {
    const identity = resolveEntryIdentity(entry);
    return identity ?? `${prefix}-${index}-${entry.createdAt || 'unknown'}`;
  };
  existing.forEach((entry, index) => {
    map.set(ensureKey(entry, index, 'existing'), entry);
  });
  incoming.forEach((entry, index) => {
    map.set(ensureKey(entry, index, 'incoming'), entry);
  });
  return orderLogsByCreatedAt(Array.from(map.values()));
}
