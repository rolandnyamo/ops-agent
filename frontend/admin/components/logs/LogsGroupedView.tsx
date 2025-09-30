import * as React from 'react';
import type { JobLogEntry } from '../../lib/api';
import {
  formatActor,
  formatCategory,
  formatStage,
  getLogEntryKey
} from './utils';

type LogsGroupedViewProps = {
  groupedLogs: Record<string, JobLogEntry[]>;
  orderedCategories: string[];
  expandedGroups: Record<string, boolean>;
  onToggleGroup: (categoryKey: string) => void;
};

function formatTimestamp(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function LogsGroupedView({ groupedLogs, orderedCategories, expandedGroups, onToggleGroup }: LogsGroupedViewProps) {
  if (!orderedCategories.length) {
    return <div className="muted" style={{ padding: '24px 0' }}>No activity recorded in the last 10 days.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {orderedCategories.map((category) => {
        const entries = groupedLogs[category] || [];
        const key = category || 'uncategorized';
        const expanded = expandedGroups[key] ?? true;
        const latest = entries[0];
        const latestSummary = latest ? (latest.message || latest.eventType) : 'No activity yet';
        const latestStatus = latest?.status || '—';

        return (
          <div
            key={key}
            style={{
              border: '1px solid rgba(148,163,184,0.25)',
              borderRadius: 10,
              padding: 12,
              background: 'rgba(15,23,42,0.65)'
            }}
          >
            <button
              type="button"
              onClick={() => onToggleGroup(key)}
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                color: '#f8fafc',
                textAlign: 'left',
                padding: 0,
                cursor: 'pointer'
              }}
            >
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{formatCategory(category)}</div>
                  <div className="muted mini" style={{ color: '#94a3b8' }}>
                    Latest: {latestSummary} · Status: {latestStatus}
                  </div>
                </div>
                <div className="muted mini" style={{ color: '#cbd5e1' }}>{expanded ? 'Hide' : 'Show'}</div>
              </div>
            </button>

            {expanded && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                {entries.map((entry, idx) => {
                  const actorLabel = formatActor(entry.actor);
                  const chunk = entry.chunkProgress;
                  const total = chunk?.total ?? null;
                  const completed = chunk?.completed ?? null;
                  const failed = chunk?.failed ?? null;
                  const percent = total && completed !== null ? Math.round(((completed || 0) / total) * 100) : null;
                  const entryKey = getLogEntryKey(entry, idx);
                  return (
                    <div
                      key={entryKey}
                      style={{
                        border: '1px solid rgba(148,163,184,0.2)',
                        borderRadius: 8,
                        padding: 12,
                        background: 'rgba(15,23,42,0.48)'
                      }}
                    >
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <div style={{ fontWeight: 600 }}>{entry.message || entry.eventType}</div>
                        <div className="muted mini" style={{ color: '#94a3b8' }}>{formatTimestamp(entry.createdAt)}</div>
                      </div>
                      <div className="muted mini" style={{ color: '#a5b4fc', marginBottom: 6 }}>
                        Stage: {formatStage(entry.stage)} · Status: {entry.status || '—'} · Actor: {actorLabel}
                        {typeof entry.attempt === 'number' && entry.attempt > 0 && <> · Attempt #{entry.attempt}</>}
                        {typeof entry.retryCount === 'number' && entry.retryCount > 0 && <> · Retries {entry.retryCount}</>}
                      </div>
                      {chunk && total && (
                        <div className="muted mini" style={{ color: '#cbd5e1', marginBottom: 6 }}>
                          Progress: {completed ?? 0}/{total} {failed ? `(failed ${failed})` : ''} {percent !== null ? `· ${percent}%` : ''}
                        </div>
                      )}
                      {entry.failureReason && (
                        <div
                          className="chip mini"
                          style={{
                            marginBottom: 6,
                            borderColor: 'rgba(220,38,38,0.5)',
                            background: 'rgba(220,38,38,0.12)',
                            color: '#fecaca'
                          }}
                        >
                          Failure: {entry.failureReason}
                        </div>
                      )}
                      {entry.metadata && (
                        <details style={{ marginTop: 6 }}>
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
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
