import * as React from 'react';
import type { JobLogEntry } from '../../lib/api';
import {
  formatActor,
  formatStage,
  getLogEntryKey,
  orderLogsByCreatedAt
} from './utils';

type LogsListViewProps = {
  entries: JobLogEntry[];
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
};

function formatTimestamp(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function LogsListView({ entries, expanded, onToggle }: LogsListViewProps) {
  if (!entries.length) {
    return <div className="muted" style={{ padding: '24px 0' }}>No activity recorded in the last 10 days.</div>;
  }

  const ordered = orderLogsByCreatedAt(entries);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {ordered.map((entry, index) => {
        const key = getLogEntryKey(entry, index);
        const isExpanded = expanded[key] ?? false;
        const actorLabel = formatActor(entry.actor);
        const created = formatTimestamp(entry.createdAt);
        const chunk = entry.chunkProgress;
        const total = chunk?.total ?? null;
        const completed = chunk?.completed ?? null;
        const failed = chunk?.failed ?? null;
        const percent = total && completed !== null ? Math.round(((completed || 0) / total) * 100) : null;

        return (
          <div
            key={key}
            style={{
              border: '1px solid rgba(148,163,184,0.25)',
              borderRadius: 10,
              padding: 14,
              background: 'rgba(15,23,42,0.60)'
            }}
          >
            <button
              type="button"
              onClick={() => onToggle(key)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                width: '100%'
              }}
            >
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {entry.message || entry.eventType}
                  </div>
                  <div className="muted mini" style={{ color: '#94a3b8', marginTop: 4 }}>
                    Stage: {formatStage(entry.stage)} · Status: {entry.status || '—'} · Actor: {actorLabel}
                    {typeof entry.attempt === 'number' && entry.attempt > 0 && ` · Attempt #${entry.attempt}`}
                    {typeof entry.retryCount === 'number' && entry.retryCount > 0 && ` · Retries ${entry.retryCount}`}
                  </div>
                </div>
                <div className="muted mini" style={{ color: '#cbd5e1', minWidth: 160, textAlign: 'right' }}>
                  {created}
                  <div style={{ marginTop: 4 }}>{isExpanded ? 'Hide details' : 'Show details'}</div>
                </div>
              </div>
            </button>

            {isExpanded && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {chunk && total && (
                  <div className="muted mini" style={{ color: '#cbd5e1' }}>
                    Progress: {completed ?? 0}/{total}{failed ? ` (failed ${failed})` : ''}{percent !== null ? ` · ${percent}%` : ''}
                  </div>
                )}
                {entry.failureReason && (
                  <div
                    className="chip mini"
                    style={{
                      borderColor: 'rgba(220,38,38,0.5)',
                      background: 'rgba(220,38,38,0.12)',
                      color: '#fecaca'
                    }}
                  >
                    Failure: {entry.failureReason}
                  </div>
                )}
                {entry.metadata && (
                  <details open style={{ marginTop: 4 }}>
                    <summary className="muted mini" style={{ color: '#cbd5e1', cursor: 'pointer' }}>Metadata</summary>
                    <pre
                      style={{
                        margin: '6px 0 0',
                        padding: 12,
                        borderRadius: 6,
                        background: 'rgba(30,41,59,0.85)',
                        border: '1px solid rgba(148,163,184,0.2)',
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                      }}
                    >
                      {JSON.stringify(entry.metadata, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
