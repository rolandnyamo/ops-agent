import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import {
  getTranslation,
  getTranslationChunks,
  updateTranslationChunks,
  approveTranslation,
  getTranslationDownloadUrl,
  type TranslationItem,
  type TranslationChunk,
} from '../../lib/api';

type ChunkStatus = {
  state: 'idle' | 'saving' | 'saved' | 'error';
  message?: string;
};

export default function TranslationDetailPage() {
  const router = useRouter();
  const { translationId } = router.query as { translationId?: string };
  const [translation, setTranslation] = useState<TranslationItem | null>(null);
  const [chunks, setChunks] = useState<TranslationChunk[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftsRef = useRef<Record<string, string>>({});
  const chunksRef = useRef<TranslationChunk[]>([]);
  const [chunkStatuses, setChunkStatuses] = useState<Record<string, ChunkStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [reviewLocked, setReviewLocked] = useState(false);
  const [chunkNotice, setChunkNotice] = useState<string | null>(null);
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [editingChunkId, setEditingChunkId] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  useEffect(() => {
    if (!translationId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setReviewLocked(false);
      setChunkNotice(null);
      setEditingChunkId(null);
      setActiveChunkId(null);
      try {
        const t = await getTranslation(translationId);
        if (cancelled) return;
        setTranslation(t);
        const data = await getTranslationChunks(translationId);
        if (cancelled) return;
        setReviewLocked(Boolean(data.reviewLocked));
        setChunkNotice(data.message || null);
        const ordered = (data.chunks || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        setChunks(ordered);
        if (!data.reviewLocked) {
          const nextDrafts: Record<string, string> = {};
          const nextStatuses: Record<string, ChunkStatus> = {};
          ordered.forEach(chunk => {
            nextDrafts[chunk.id] = chunk.reviewerHtml || chunk.machineHtml || chunk.sourceHtml;
            nextStatuses[chunk.id] = { state: 'idle' };
          });
          setDrafts(nextDrafts);
          setChunkStatuses(nextStatuses);
          setActiveChunkId(ordered[0]?.id ?? null);
        } else {
          setDrafts({});
          setChunkStatuses({});
        }
      } catch (err: any) {
        if (cancelled) return;
        if (typeof err?.message === 'string' && err.message.includes('404')) {
          setChunks([]);
          setDrafts({});
          setChunkStatuses({});
          setChunkNotice('Chunks are not available yet.');
        } else {
          setError(err?.message || 'Failed to load translation');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [translationId]);

  useEffect(() => {
    setChunkStatuses(prev => {
      const next: Record<string, ChunkStatus> = {};
      let changed = false;
      chunks.forEach(chunk => {
        const existing = prev[chunk.id];
        next[chunk.id] = existing || { state: 'idle' };
        if (!existing) changed = true;
      });
      if (Object.keys(prev).length !== Object.keys(next).length) {
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [chunks]);

  const canEditChunks = useMemo(
    () => translation?.status === 'READY_FOR_REVIEW' && !reviewLocked,
    [translation, reviewLocked]
  );
  const isApproved = useMemo(() => translation?.status === 'APPROVED', [translation]);
  const canExportTranslation = useMemo(
    () => translation?.status === 'READY_FOR_REVIEW' || translation?.status === 'APPROVED',
    [translation]
  );

  const persistChunk = useCallback(
    async (chunkId: string) => {
      if (!translationId || !canEditChunks) return;
      const timers = saveTimers.current;
      if (timers[chunkId]) {
        clearTimeout(timers[chunkId]);
        delete timers[chunkId];
      }
      const payload = draftsRef.current[chunkId] ?? '';
      const existing = chunksRef.current.find(chunk => chunk.id === chunkId);
      const currentHtml = existing?.reviewerHtml || existing?.machineHtml || existing?.sourceHtml || '';
      if (payload === currentHtml) {
        setChunkStatuses(prev => ({ ...prev, [chunkId]: { state: 'saved' } }));
        return;
      }
      setError(null);
      setChunkStatuses(prev => ({ ...prev, [chunkId]: { state: 'saving' } }));
      try {
        const res = await updateTranslationChunks(translationId, [{ id: chunkId, reviewerHtml: payload }]);
        const updatedMap: Record<string, TranslationChunk> = {};
        (res.chunks || []).forEach(chunk => {
          updatedMap[chunk.id] = chunk;
        });
        setChunks(prev => prev.map(chunk => updatedMap[chunk.id] || chunk));
        const saved = updatedMap[chunkId];
        if (saved) {
          setDrafts(prev => ({ ...prev, [chunkId]: saved.reviewerHtml || saved.machineHtml || saved.sourceHtml || '' }));
        }
        setChunkStatuses(prev => ({ ...prev, [chunkId]: { state: 'saved' } }));
      } catch (err: any) {
        const message = err?.message || 'Save failed';
        setError(message);
        setChunkStatuses(prev => ({ ...prev, [chunkId]: { state: 'error', message } }));
      }
    },
    [translationId, canEditChunks]
  );

  const scheduleSave = useCallback(
    (chunkId: string) => {
      if (!canEditChunks) return;
      const timers = saveTimers.current;
      if (timers[chunkId]) {
        clearTimeout(timers[chunkId]);
      }
      timers[chunkId] = setTimeout(() => {
        void persistChunk(chunkId);
      }, 800);
    },
    [canEditChunks, persistChunk]
  );

  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach(timer => clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (!canEditChunks) {
      Object.values(saveTimers.current).forEach(timer => clearTimeout(timer));
      saveTimers.current = {};
      setEditingChunkId(null);
    }
  }, [canEditChunks]);

  async function approve() {
    if (!translationId) return;
    setApproving(true);
    setError(null);
    try {
      await approveTranslation(translationId);
      const updated = await getTranslation(translationId);
      setTranslation(updated);
      try {
        const chunkData = await getTranslationChunks(translationId);
        setReviewLocked(Boolean(chunkData.reviewLocked));
        setChunkNotice(chunkData.message || 'Translation has been approved.');
        const ordered = (chunkData.chunks || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        setChunks(ordered);
        if (!chunkData.reviewLocked) {
          const nextDrafts: Record<string, string> = {};
          const nextStatuses: Record<string, ChunkStatus> = {};
          ordered.forEach(chunk => {
            nextDrafts[chunk.id] = chunk.reviewerHtml || chunk.machineHtml || chunk.sourceHtml;
            nextStatuses[chunk.id] = { state: 'idle' };
          });
          setDrafts(nextDrafts);
          setChunkStatuses(nextStatuses);
          setActiveChunkId(ordered[0]?.id ?? null);
        } else {
          setDrafts({});
          setChunkStatuses({});
          setActiveChunkId(null);
        }
      } catch {
        setReviewLocked(true);
        setChunkNotice('Translation has been approved. Chunk data is no longer available.');
        setChunks([]);
        setDrafts({});
        setChunkStatuses({});
        setActiveChunkId(null);
      }
      setEditingChunkId(null);
    } catch (err: any) {
      setError(err?.message || 'Approval failed');
    } finally {
      setApproving(false);
    }
  }

  type DownloadType =
    | 'original'
    | 'machine'
    | 'translated'
    | 'translatedHtml'
    | 'translatedDocx'
    | 'translatedPdf';

  async function download(type: DownloadType) {
    if (!translationId) return;
    try {
      const { url } = await getTranslationDownloadUrl(translationId, type);
      if (url) window.open(url, '_blank');
    } catch (err: any) {
      setError(err?.message || 'Download failed');
    }
  }

  if (!translationId) {
    return (
      <Layout>
        <div className="muted">No translation selected.</div>
      </Layout>
    );
  }

  return (
    <Layout>
      {loading && <div className="muted">Loading…</div>}
      {error && (
        <div className="chip" style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,.08)', marginBottom: 16 }}>
          {error}
        </div>
      )}
      {translation && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ marginBottom: 6 }}>{translation.title || translation.originalFilename}</h2>
              <div className="muted">
                {translation.sourceLanguage?.toUpperCase()} → {translation.targetLanguage?.toUpperCase()}
              </div>
              <div className="muted mini" style={{ marginTop: 4 }}>Status: {translation.status}</div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn ghost mini" onClick={() => download('original')}>
                Original
              </button>
              <button className="btn ghost mini" onClick={() => download('machine')}>
                Machine
              </button>
              {translation.status === 'APPROVED' && (
                <button className="btn ghost mini" onClick={() => download('translated')}>
                  Final HTML
                </button>
              )}
              {translation.status === 'READY_FOR_REVIEW' && (
                <button className="btn" onClick={approve} disabled={approving || reviewLocked}>
                  {approving ? 'Finalising…' : 'Mark approved'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {translation?.status === 'READY_FOR_REVIEW' ? (
        reviewLocked ? (
          <div className="card">
            <div className="muted">Translation review is currently read-only.</div>
            {chunkNotice && <div className="muted mini" style={{ marginTop: 8 }}>{chunkNotice}</div>}
          </div>
        ) : (
          <>
            <div className="card compare-header">
              <div>
                <div className="badge">Document Compare — Source ↔ Translation</div>
                <div className="muted mini" style={{ marginTop: 4 }}>
                  Click anywhere in the Translation panel to edit that section. Matching source content highlights automatically.
                </div>
                <div className="muted mini" style={{ marginTop: 4 }}>
                  Changes are autosaved as one continuous document.
                </div>
              </div>
              {canExportTranslation && (
                <div className="export-actions">
                  <button className="btn" onClick={() => download('translatedDocx')}>
                    Export DOCX
                  </button>
                  <button className="btn ghost" onClick={() => download('translatedPdf')}>
                    Export PDF
                  </button>
                </div>
              )}
            </div>
            {chunkNotice && (
              <div className="card info-note">
                <div className="muted mini">{chunkNotice}</div>
              </div>
            )}
            <div className="compare-layout">
              <section className="panel source-panel">
                <header className="panel-heading">
                  <div>
                    <h3>Source (read-only)</h3>
                    <p className="muted mini">Use this for context while you revise.</p>
                  </div>
                </header>
                <div className="panel-body">
                  {chunks.map(chunk => (
                    <article
                      key={chunk.id}
                      className={`source-section ${activeChunkId === chunk.id ? 'active' : ''}`}
                      onClick={() => setActiveChunkId(chunk.id)}
                    >
                      <div className="section-label">Section {chunk.order}</div>
                      <div className="section-html" dangerouslySetInnerHTML={{ __html: chunk.sourceHtml }} />
                    </article>
                  ))}
                  {!chunks.length && <div className="muted mini">No sections available yet.</div>}
                </div>
              </section>
              <section className="panel translation-panel">
                <header className="panel-heading">
                  <div>
                    <h3>Translation</h3>
                    <p className="muted mini">Select a section to revise the translation. Keep HTML structure intact when editing.</p>
                  </div>
                </header>
                <div className="panel-body">
                  {chunks.map(chunk => {
                    const draft = drafts[chunk.id] ?? '';
                    const status = chunkStatuses[chunk.id] || { state: 'idle' };
                    const isEditing = editingChunkId === chunk.id;
                    const translationHtml = draft || '';
                    return (
                      <article
                        key={chunk.id}
                        className={`translation-section ${activeChunkId === chunk.id ? 'active' : ''}`}
                        onClick={() => setActiveChunkId(chunk.id)}
                      >
                        <div className="section-header">
                          <div className="section-label">Section {chunk.order}</div>
                          <div className="section-meta">
                            {status.state === 'saving' && <span className="status saving">Saving…</span>}
                            {status.state === 'saved' && <span className="status saved">Autosaved</span>}
                            {status.state === 'error' && <span className="status error">{status.message || 'Autosave failed'}</span>}
                            <button
                              className="btn ghost mini"
                              disabled={!canEditChunks}
                              onClick={e => {
                                e.stopPropagation();
                                if (isEditing) {
                                  setEditingChunkId(null);
                                  void persistChunk(chunk.id);
                                } else {
                                  setEditingChunkId(chunk.id);
                                  setActiveChunkId(chunk.id);
                                }
                              }}
                            >
                              {isEditing ? 'Done' : 'Edit'}
                            </button>
                          </div>
                        </div>
                        {isEditing ? (
                          <textarea
                            className="translation-textarea"
                            value={draft}
                            onChange={e => {
                              const value = e.target.value;
                              setDrafts(prev => ({ ...prev, [chunk.id]: value }));
                              setChunkStatuses(prev => ({ ...prev, [chunk.id]: { state: 'saving' } }));
                              scheduleSave(chunk.id);
                            }}
                            onFocus={() => setActiveChunkId(chunk.id)}
                            onBlur={() => {
                              void persistChunk(chunk.id);
                            }}
                            rows={Math.max(8, Math.ceil(Math.max(draft.length, 1) / 120))}
                            disabled={!canEditChunks}
                          />
                        ) : (
                          <div className="section-html translation-preview" dangerouslySetInnerHTML={{ __html: translationHtml }} />
                        )}
                        {!isEditing && (
                          <div className="muted mini" style={{ marginTop: 8 }}>
                            Click Edit to revise this section. Changes are saved automatically.
                          </div>
                        )}
                      </article>
                    );
                  })}
                  {!chunks.length && <div className="muted mini">No translated sections yet.</div>}
                </div>
              </section>
            </div>
          </>
        )
      ) : isApproved ? (
        <div className="card">
          <div className="muted">Translation has been approved. Chunk data has been removed.</div>
          {chunkNotice && <div className="muted mini" style={{ marginTop: 8 }}>{chunkNotice}</div>}
        </div>
      ) : translation?.status === 'FAILED' ? (
        <div className="card">
          <div className="muted">Translation failed.</div>
          {translation.errorMessage && <div className="muted mini" style={{ marginTop: 8 }}>{translation.errorMessage}</div>}
        </div>
      ) : (
        <div className="card">
          <div className="muted">Translation is still processing. Refresh shortly.</div>
        </div>
      )}

      <style jsx>{`
        .compare-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
        }
        .badge {
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          color: #93c5fd;
          letter-spacing: 0.08em;
        }
        .export-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .info-note {
          border-color: rgba(59, 130, 246, 0.35);
          background: rgba(59, 130, 246, 0.08);
        }
        .compare-layout {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 24px;
          align-items: flex-start;
        }
        .panel {
          background: rgba(15, 23, 42, 0.75);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .panel-heading h3 {
          margin: 0;
          font-size: 16px;
        }
        .panel-body {
          display: flex;
          flex-direction: column;
          gap: 16px;
          max-height: 70vh;
          overflow-y: auto;
          padding-right: 6px;
        }
        .panel-body::-webkit-scrollbar {
          width: 8px;
        }
        .panel-body::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.4);
          border-radius: 999px;
        }
        .section-label {
          font-size: 12px;
          font-weight: 600;
          color: #94a3b8;
          margin-bottom: 6px;
        }
        .section-html {
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 10px;
          padding: 16px;
          background: rgba(15, 23, 42, 0.5);
          overflow-x: auto;
        }
        .section-html :global(h1),
        .section-html :global(h2),
        .section-html :global(h3),
        .section-html :global(h4),
        .section-html :global(h5),
        .section-html :global(h6) {
          margin-top: 0;
        }
        .source-section,
        .translation-section {
          border-radius: 12px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .source-section.active .section-html,
        .translation-section.active .section-html {
          border-color: rgba(59, 130, 246, 0.6);
          box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.35);
        }
        .translation-section {
          padding: 12px;
          border: 1px solid transparent;
        }
        .translation-section.active {
          border-color: rgba(59, 130, 246, 0.4);
          background: rgba(30, 64, 175, 0.12);
        }
        .translation-preview {
          background: rgba(15, 23, 42, 0.45);
        }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 8px;
        }
        .section-meta {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .status {
          font-size: 12px;
        }
        .status.saving {
          color: #fbbf24;
        }
        .status.saved {
          color: #34d399;
        }
        .status.error {
          color: #f87171;
        }
        .translation-textarea {
          width: 100%;
          border-radius: 10px;
          border: 1px solid rgba(148, 163, 184, 0.3);
          padding: 12px;
          background: rgba(15, 23, 42, 0.75);
          color: inherit;
          font-family: inherit;
          font-size: 14px;
          resize: vertical;
          min-height: 160px;
        }
        .translation-textarea:focus {
          outline: none;
          border-color: rgba(59, 130, 246, 0.8);
          box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.35);
        }
        @media (max-width: 960px) {
          .compare-header {
            flex-direction: column;
          }
          .panel-body {
            max-height: none;
          }
        }
      `}</style>
    </Layout>
  );
}
