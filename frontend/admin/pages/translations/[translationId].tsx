import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import {
  getTranslation,
  getTranslationChunks,
  updateTranslationChunks,
  approveTranslation,
  getTranslationDownloadUrl,
  type TranslationItem,
  type TranslationChunk
} from '../../lib/api';
function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

type DiffSegment = { kind: 'same' | 'added' | 'removed'; value: string };

function computeDiff(base: string, revised: string): DiffSegment[] {
  const baseWords = stripTags(base).split(/\s+/).filter(Boolean);
  const revisedWords = stripTags(revised).split(/\s+/).filter(Boolean);
  const max = Math.max(baseWords.length, revisedWords.length);
  const segments: DiffSegment[] = [];
  for (let i = 0; i < max; i++) {
    const oldWord = baseWords[i];
    const newWord = revisedWords[i];
    if (oldWord && newWord && oldWord === newWord) {
      segments.push({ kind: 'same', value: newWord });
      continue;
    }
    if (newWord) {
      segments.push({ kind: 'added', value: newWord });
    }
    if (oldWord) {
      segments.push({ kind: 'removed', value: oldWord });
    }
  }
  return segments;
}

function renderDiff(base: string, revised: string) {
  const diff = computeDiff(base, revised);
  return diff.map((segment, idx) => {
    const className = segment.kind === 'added' ? 'diff-added' : segment.kind === 'removed' ? 'diff-removed' : 'diff-same';
    const suffix = segment.kind === 'same' ? ' ' : ' ';
    return <span key={idx} className={className}>{segment.value + suffix}</span>;
  });
}

export default function TranslationDetailPage() {
  const router = useRouter();
  const { translationId } = router.query as { translationId?: string };
  const [translation, setTranslation] = useState<TranslationItem | null>(null);
  const [chunks, setChunks] = useState<TranslationChunk[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingChunk, setSavingChunk] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [reviewLocked, setReviewLocked] = useState(false);
  const [chunkNotice, setChunkNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!translationId) return;
    async function load() {
      setLoading(true);
      setReviewLocked(false);
      setChunkNotice(null);
      try {
        const t = await getTranslation(translationId);
        setTranslation(t);
        const data = await getTranslationChunks(translationId);
        setReviewLocked(Boolean(data.reviewLocked));
        setChunkNotice(data.message || null);
        const ordered = (data.chunks || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        setChunks(ordered);
        if (!data.reviewLocked) {
          const nextDrafts: Record<string, string> = {};
          ordered.forEach(chunk => {
            nextDrafts[chunk.id] = chunk.reviewerHtml || chunk.machineHtml || chunk.sourceHtml;
          });
          setDrafts(nextDrafts);
        } else {
          setDrafts({});
        }
      } catch (err: any) {
        if (typeof err?.message === 'string' && err.message.includes('404')) {
          setChunks([]);
          setDrafts({});
          setChunkNotice('Chunks are not available yet.');
        } else {
          setError(err.message || 'Failed to load translation');
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [translationId]);

  const canEditChunks = useMemo(
    () => translation?.status === 'READY_FOR_REVIEW' && !reviewLocked,
    [translation, reviewLocked]
  );
  const isApproved = useMemo(() => translation?.status === 'APPROVED', [translation]);

  async function saveChunk(chunkId: string) {
    if (!translationId) return;
    if (!canEditChunks) {
      setError('Translation review is read-only.');
      return;
    }
    setSavingChunk(chunkId);
    setError(null);
    try {
      const payload = drafts[chunkId];
      const res = await updateTranslationChunks(translationId, [{ id: chunkId, reviewerHtml: payload }]);
      const updatedMap: Record<string, TranslationChunk> = {};
      (res.chunks || []).forEach(chunk => {
        updatedMap[chunk.id] = chunk;
      });
      setChunks(prev => prev.map(chunk => updatedMap[chunk.id] || chunk));
      const saved = updatedMap[chunkId];
      if (saved) {
        setDrafts(prev => ({ ...prev, [chunkId]: saved.reviewerHtml || saved.machineHtml || '' }));
      }
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSavingChunk(null);
    }
  }

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
        setChunks(chunkData.chunks || []);
      } catch {
        setReviewLocked(true);
        setChunkNotice('Translation has been approved. Chunk data is no longer available.');
        setChunks([]);
      }
      setDrafts({});
    } catch (err: any) {
      setError(err.message || 'Approval failed');
    } finally {
      setApproving(false);
    }
  }

  async function download(type: 'original' | 'machine' | 'translated' | 'translatedHtml') {
    if (!translationId) return;
    try {
      const { url } = await getTranslationDownloadUrl(translationId, type);
      if (url) window.open(url, '_blank');
    } catch (err: any) {
      setError(err.message || 'Download failed');
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
              <div className="muted">{translation.sourceLanguage?.toUpperCase()} → {translation.targetLanguage?.toUpperCase()}</div>
              <div className="muted mini" style={{ marginTop: 4 }}>Status: {translation.status}</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost mini" onClick={() => download('original')}>Original</button>
              <button className="btn ghost mini" onClick={() => download('machine')}>Machine</button>
              {translation.status === 'APPROVED' && (
                <button className="btn ghost mini" onClick={() => download('translated')}>Final</button>
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
          <div className="stack" style={{ gap: 24 }}>
            {chunkNotice && (
              <div className="card" style={{ background: 'rgba(59,130,246,.08)', borderColor: 'rgba(59,130,246,.35)' }}>
                <div className="muted mini">{chunkNotice}</div>
              </div>
            )}
            {chunks.map(chunk => {
              const draft = drafts[chunk.id];
              const machineHtml = chunk.machineHtml || '';
              return (
                <div key={chunk.id} className="card">
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontWeight: 600 }}>Chunk {chunk.order}</div>
                    <button
                      className="btn ghost mini"
                      onClick={() => saveChunk(chunk.id)}
                      disabled={savingChunk === chunk.id || !canEditChunks}
                    >
                      {savingChunk === chunk.id ? 'Saving…' : 'Save chunk'}
                    </button>
                  </div>
                  <div className="grid cols-3" style={{ gap: 16 }}>
                    <div>
                      <h4 className="muted" style={{ marginBottom: 6 }}>Source</h4>
                      <div className="preview" dangerouslySetInnerHTML={{ __html: chunk.sourceHtml }} />
                    </div>
                    <div>
                      <h4 className="muted" style={{ marginBottom: 6 }}>Translation (HTML)</h4>
                      <textarea
                        className="textarea"
                        rows={8}
                        value={draft}
                        onChange={e => setDrafts(prev => ({ ...prev, [chunk.id]: e.target.value }))}
                        disabled={!canEditChunks}
                      />
                      <div className="muted mini" style={{ marginTop: 4 }}>Keep HTML tags intact.</div>
                    </div>
                    <div>
                      <h4 className="muted" style={{ marginBottom: 6 }}>Preview</h4>
                      <div className="preview" dangerouslySetInnerHTML={{ __html: draft }} />
                    </div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <h4 className="muted" style={{ marginBottom: 6 }}>Changes vs machine translation</h4>
                    <div className="diff-view">
                      {renderDiff(machineHtml, draft)}
                    </div>
                  </div>
                </div>
              );
            })}
            {!chunks.length && (
              <div className="card">
                <div className="muted">No chunks available yet.</div>
              </div>
            )}
          </div>
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
        .preview {
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 12px;
          background: #fff;
          min-height: 120px;
          overflow-x: auto;
        }
        .diff-view {
          border: 1px dashed var(--border-subtle);
          padding: 8px;
          border-radius: 6px;
          font-family: monospace;
          white-space: pre-wrap;
        }
        .diff-added {
          background: rgba(16, 185, 129, 0.18);
          border-radius: 4px;
          padding: 0 2px;
        }
        .diff-removed {
          background: rgba(239, 68, 68, 0.18);
          border-radius: 4px;
          padding: 0 2px;
          text-decoration: line-through;
        }
        .diff-same {
          opacity: 0.7;
        }
      `}</style>
    </Layout>
  );
}
