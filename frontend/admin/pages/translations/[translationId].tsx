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

type DownloadType =
  | 'original'
  | 'machine'
  | 'translated'
  | 'translatedHtml'
  | 'translatedDocx'
  | 'translatedPdf';

export default function TranslationDetailPage() {
  const router = useRouter();
  const { translationId } = router.query as { translationId?: string };

  // Server state
  const [translation, setTranslation] = useState<TranslationItem | null>(null);
  const [chunks, setChunks] = useState<TranslationChunk[]>([]);
  const chunksRef = useRef<TranslationChunk[]>([]);

  // Editor state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [reviewLocked, setReviewLocked] = useState(false);
  const [chunkNotice, setChunkNotice] = useState<string | null>(null);
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [chunkStatuses, setChunkStatuses] = useState<Record<string, ChunkStatus>>({});
  const [syncScroll, setSyncScroll] = useState(true);

  // Initial markup to render once; live edits happen in DOM (contenteditable)
  const [sourceMarkup, setSourceMarkup] = useState<string>('');
  const [targetMarkup, setTargetMarkup] = useState<string>('');

  // Refs to panes/docs
  const leftPaneRef = useRef<HTMLDivElement | null>(null);
  const rightPaneRef = useRef<HTMLDivElement | null>(null);
  const sourceDocRef = useRef<HTMLElement | null>(null);
  const targetDocRef = useRef<HTMLElement | null>(null);

  // Debounced autosave timers per chunk
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // The current draft HTML per chunk (kept off React render loop to avoid thrash)
  const draftsRef = useRef<Record<string, string>>({});
  // Guard to avoid scroll loops
  const syncingRef = useRef(false);

  // Computed flags
  const canEditChunks = useMemo(
    () => translation?.status === 'READY_FOR_REVIEW' && !reviewLocked,
    [translation, reviewLocked]
  );
  const isApproved = useMemo(() => translation?.status === 'APPROVED', [translation]);
  const isPaused = useMemo(() => translation?.status === 'PAUSED', [translation]);
  const pausePending = useMemo(() => translation?.status === 'PAUSE_REQUESTED', [translation]);
  const cancelPending = useMemo(() => translation?.status === 'CANCEL_REQUESTED', [translation]);
  const isCancelled = useMemo(() => translation?.status === 'CANCELLED', [translation]);
  const canExportTranslation = useMemo(
    () => translation?.status === 'READY_FOR_REVIEW' || translation?.status === 'APPROVED',
    [translation]
  );

  // ---- Load translation + chunks ------------------------------------------------
  useEffect(() => {
    if (!translationId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setActiveChunkId(null);
      setSourceMarkup('');
      setTargetMarkup('');
      draftsRef.current = {};
      setChunkStatuses({});
      try {
        const t = await getTranslation(translationId);
        if (cancelled) return;
        setTranslation(t);

        const data = await getTranslationChunks(translationId);
        if (cancelled) return;

        setReviewLocked(Boolean(data.reviewLocked));
        setChunkNotice(data.message || null);

        const ordered: TranslationChunk[] = (data.chunks || []).sort(
          (a, b) => (a.order || 0) - (b.order || 0)
        );
        setChunks(ordered);
        chunksRef.current = ordered;

        // Prepare invisible segment wrappers for both docs
        const srcMarkup = ordered
          .map((c) => `<section class="seg" data-seg="${c.id}">${c.sourceHtml || ''}</section>`)
          .join('\n');

        setSourceMarkup(srcMarkup);

        if (!data.reviewLocked) {
          // Initial translation HTML (reviewerHtml > machineHtml > sourceHtml)
          const tgtMarkup = ordered
            .map((c) => {
              const html = c.reviewerHtml || c.machineHtml || c.sourceHtml || '';
              draftsRef.current[c.id] = html;
              return `<section class="seg" data-seg="${c.id}">${html}</section>`;
            })
            .join('\n');

          // Init all statuses to idle
          const nextStatuses: Record<string, ChunkStatus> = {};
          ordered.forEach((c) => (nextStatuses[c.id] = { state: 'idle' }));
          setChunkStatuses(nextStatuses);

          setTargetMarkup(tgtMarkup);
          setActiveChunkId(ordered[0]?.id ?? null);
        } else {
          setTargetMarkup(
            ordered
              .map((c) => `<section class="seg" data-seg="${c.id}">${c.reviewerHtml || c.machineHtml || c.sourceHtml || ''}</section>`)
              .join('\n')
          );
          setActiveChunkId(ordered[0]?.id ?? null);
        }
      } catch (err: any) {
        if (cancelled) return;
        if (typeof err?.message === 'string' && err.message.includes('404')) {
          setChunks([]);
          setSourceMarkup('');
          setTargetMarkup('');
          setChunkNotice('Chunks are not available yet.');
        } else {
          setError(err?.message || 'Failed to load translation');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [translationId]);

  // Keep chunksRef in sync
  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  // ---- Autosave -----------------------------------------------------------------
  const persistChunk = useCallback(
    async (chunkId: string) => {
      if (!translationId || !canEditChunks) return;

      const timers = saveTimers.current;
      if (timers[chunkId]) {
        clearTimeout(timers[chunkId]);
        delete timers[chunkId];
      }

      // Current DOM payload for this segment (from the live editor)
      const seg = targetDocRef.current?.querySelector<HTMLElement>(`.seg[data-seg="${chunkId}"]`);
      const payload = seg?.innerHTML ?? draftsRef.current[chunkId] ?? '';

      // Compare with server-side current html to avoid no-op saves
      const existing = chunksRef.current.find((c) => c.id === chunkId);
      const currentHtml =
        existing?.reviewerHtml || existing?.machineHtml || existing?.sourceHtml || '';

      if (payload === currentHtml) {
        setChunkStatuses((prev) => ({ ...prev, [chunkId]: { state: 'saved' } }));
        draftsRef.current[chunkId] = payload;
        return;
      }

      setError(null);
      setChunkStatuses((prev) => ({ ...prev, [chunkId]: { state: 'saving' } }));

      try {
        const res = await updateTranslationChunks(translationId, [
          { id: chunkId, reviewerHtml: payload },
        ]);

        const updatedMap: Record<string, TranslationChunk> = {};
        (res.chunks || []).forEach((c: TranslationChunk) => (updatedMap[c.id] = c));

        setChunks((prev) => prev.map((c) => updatedMap[c.id] || c));
        chunksRef.current = chunksRef.current.map((c) => updatedMap[c.id] || c);

        draftsRef.current[chunkId] =
          updatedMap[chunkId]?.reviewerHtml ||
          updatedMap[chunkId]?.machineHtml ||
          updatedMap[chunkId]?.sourceHtml ||
          payload;

        setChunkStatuses((prev) => ({ ...prev, [chunkId]: { state: 'saved' } }));
      } catch (err: any) {
        const message = err?.message || 'Save failed';
        setError(message);
        setChunkStatuses((prev) => ({ ...prev, [chunkId]: { state: 'error', message } }));
      }
    },
    [translationId, canEditChunks]
  );

  const scheduleSave = useCallback(
    (chunkId: string) => {
      if (!canEditChunks) return;
      const timers = saveTimers.current;
      if (timers[chunkId]) clearTimeout(timers[chunkId]);
      timers[chunkId] = setTimeout(() => void persistChunk(chunkId), 800);
    },
    [canEditChunks, persistChunk]
  );

  // Flush any pending saves on unmount/route-change
  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach((t) => clearTimeout(t));
      // Fire a last "best effort" save for all segments
      chunksRef.current.forEach((c) => void persistChunk(c.id));
    };
  }, [persistChunk]);

  // ---- Editing interactions (contenteditable) -----------------------------------
  // Highlight linked segments on both sides
  const applyActiveHighlight = useCallback(
    (id: string | null) => {
      if (!id) return;
      const removeAll = (root: Element | null) => {
        if (!root) return;
        root.querySelectorAll('.seg.active').forEach((el) => el.classList.remove('active'));
      };
      removeAll(sourceDocRef.current || null);
      removeAll(targetDocRef.current || null);

      const src = sourceDocRef.current?.querySelector(`.seg[data-seg="${id}"]`);
      const tgt = targetDocRef.current?.querySelector(`.seg[data-seg="${id}"]`);
      if (src) src.classList.add('active');
      if (tgt) tgt.classList.add('active');
    },
    []
  );

  // Translate a DOM node to its enclosing segment id
  const nodeToSegId = (node: Node | null): string | null => {
    if (!node) return null;
    // If it's a text node, use the parent element
    let el: Element | null =
      node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node.parentElement as Element | null);
    if (!el) return null;
    const seg = el.closest('.seg') as HTMLElement | null;
    return seg ? seg.dataset.seg || null : null;
  };

  // Place caret at start of element
  const placeCaretAtStart = (el: Node) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // After markup is rendered into DOM, wire up listeners
  useEffect(() => {
    // Nothing to wire until both sides are present
    if (!sourceMarkup || !targetMarkup) return;

    const $src = sourceDocRef.current!;
    const $tgt = targetDocRef.current!;

    // Sync current active highlight
    if (activeChunkId) applyActiveHighlight(activeChunkId);

    // On clicks/selection moves inside the editable doc, set active + highlight
    const handleTargetActivity = () => {
      const sel = window.getSelection();
      const id = nodeToSegId(sel?.anchorNode || null);
      if (!id) return;
      setActiveChunkId(id);
      applyActiveHighlight(id);

      // When selection changes, also ensure the source segment scrolls into view
      const srcSeg = $src.querySelector(`.seg[data-seg="${id}"]`);
      if (srcSeg) (srcSeg as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const handleTargetInput = (e: Event) => {
      if (!canEditChunks) return;
      const target = e.target as HTMLElement;
      const seg = target.closest('.seg') as HTMLElement | null;
      if (!seg || !seg.dataset.seg) return;
      const id = seg.dataset.seg;
      draftsRef.current[id] = seg.innerHTML;
      setChunkStatuses((prev) => ({ ...prev, [id]: { state: 'saving' } }));
      scheduleSave(id);
    };

    const handleSourceClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const seg = el.closest('.seg') as HTMLElement | null;
      if (!seg || !seg.dataset.seg) return;
      const id = seg.dataset.seg;
      setActiveChunkId(id);
      applyActiveHighlight(id);
      const tgtSeg = $tgt.querySelector(`.seg[data-seg="${id}"]`) as HTMLElement | null;
      if (tgtSeg) {
        tgtSeg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        placeCaretAtStart(tgtSeg);
      }
    };

    // Keyboard quick‑nav Alt+↑ / Alt+↓
    const handleKeyNav = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const ids = chunksRef.current.map((c) => c.id);
      const idx = Math.max(0, ids.indexOf(activeChunkId || ids[0]));
      const nextIdx =
        e.key === 'ArrowDown' ? Math.min(ids.length - 1, idx + 1) : Math.max(0, idx - 1);
      const nextId = ids[nextIdx];
      if (!nextId) return;
      setActiveChunkId(nextId);
      applyActiveHighlight(nextId);
      const tgtSeg = $tgt.querySelector(`.seg[data-seg="${nextId}"]`) as HTMLElement | null;
      if (tgtSeg) {
        tgtSeg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        placeCaretAtStart(tgtSeg);
      }
    };

    $tgt.addEventListener('click', handleTargetActivity);
    $tgt.addEventListener('keyup', handleTargetActivity);
    $tgt.addEventListener('mouseup', handleTargetActivity);
    $tgt.addEventListener('input', handleTargetInput);
    $src.addEventListener('click', handleSourceClick);
    document.addEventListener('keydown', handleKeyNav);

    return () => {
      $tgt.removeEventListener('click', handleTargetActivity);
      $tgt.removeEventListener('keyup', handleTargetActivity);
      $tgt.removeEventListener('mouseup', handleTargetActivity);
      $tgt.removeEventListener('input', handleTargetInput);
      $src.removeEventListener('click', handleSourceClick);
      document.removeEventListener('keydown', handleKeyNav);
    };
  }, [sourceMarkup, targetMarkup, canEditChunks, activeChunkId, applyActiveHighlight, scheduleSave]);

  // Keep visual highlight synced if active id changes outside of the effect above
  useEffect(() => {
    applyActiveHighlight(activeChunkId);
  }, [activeChunkId, applyActiveHighlight]);

  // ---- Scroll sync between panes ------------------------------------------------
  useEffect(() => {
    const left = leftPaneRef.current;
    const right = rightPaneRef.current;
    if (!left || !right) return;

    const onScroll = (src: HTMLElement, dst: HTMLElement) => {
      if (!syncScroll) return;
      if (syncingRef.current) return;
      syncingRef.current = true;
      const ratio = src.scrollTop / (src.scrollHeight - src.clientHeight || 1);
      dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight);
      requestAnimationFrame(() => (syncingRef.current = false));
    };

    const handleLeftScroll = () => onScroll(left, right);
    const handleRightScroll = () => onScroll(right, left);

    left.addEventListener('scroll', handleLeftScroll);
    right.addEventListener('scroll', handleRightScroll);
    return () => {
      left.removeEventListener('scroll', handleLeftScroll);
      right.removeEventListener('scroll', handleRightScroll);
    };
  }, [syncScroll, sourceMarkup, targetMarkup]);

  // ---- Divider drag for resizing ------------------------------------------------
  const gridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const divider = document.getElementById('divider-bar');
    if (!divider || !gridRef.current) return;

    let startX = 0;
    let startLeftFr = 1;

    const getCols = () => {
      const style = window.getComputedStyle(gridRef.current!);
      const [left, gap, right] = style.gridTemplateColumns.split(' ');
      return [parseFloat(left || '1'), gap, parseFloat(right || '1')];
    };

    const setCols = (leftFr: number) => {
      const left = Math.min(80, Math.max(20, leftFr));
      const right = 100 - left;
      gridRef.current!.style.gridTemplateColumns = `${left}fr 10px ${right}fr`;
    };

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const total = window.innerWidth || 1;
      setCols(startLeftFr + (dx / total) * 100);
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    const onMouseDown = (e: MouseEvent) => {
      const [left] = getCols();
      startLeftFr = left as number;
      startX = e.clientX;
      document.body.style.cursor = 'col-resize';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp, { once: true });
    };

    divider.addEventListener('mousedown', onMouseDown);
    return () => divider.removeEventListener('mousedown', onMouseDown);
  }, []);

  // ---- Actions ------------------------------------------------------------------
  async function approve() {
    if (!translationId) return;
    // Flush all pending edits first
    chunksRef.current.forEach((c) => void persistChunk(c.id));
    setApproving(true);
    setError(null);
    try {
      await approveTranslation(translationId);
      const updated = await getTranslation(translationId);
      setTranslation(updated);
      try {
        const data = await getTranslationChunks(translationId);
        setReviewLocked(Boolean(data.reviewLocked));
        setChunkNotice(data.message || 'Translation has been approved.');
        const ordered = (data.chunks || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        setChunks(ordered);
        chunksRef.current = ordered;
      } catch {
        setReviewLocked(true);
        setChunkNotice('Translation has been approved. Chunk data is no longer available.');
        setChunks([]);
        chunksRef.current = [];
      }
    } catch (err: any) {
      setError(err?.message || 'Approval failed');
    } finally {
      setApproving(false);
    }
  }

  async function download(type: DownloadType) {
    if (!translationId) return;
    try {
      const { url } = await getTranslationDownloadUrl(translationId, type);
      if (url) window.open(url, '_blank');
    } catch (err: any) {
      setError(err?.message || 'Download failed');
    }
  }

  // Prev/Next buttons (navigate across segments)
  const jumpTo = (dir: 'prev' | 'next') => {
    const ids = chunksRef.current.map((c) => c.id);
    if (!ids.length) return;
    const idx = Math.max(0, ids.indexOf(activeChunkId || ids[0]));
    const nextIdx = dir === 'next' ? Math.min(ids.length - 1, idx + 1) : Math.max(0, idx - 1);
    const id = ids[nextIdx];
    if (!id) return;
    setActiveChunkId(id);
    // Scroll + move caret
    const tgtSeg = targetDocRef.current?.querySelector(`.seg[data-seg="${id}"]`) as HTMLElement | null;
    if (tgtSeg) {
      tgtSeg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      placeCaretAtStart(tgtSeg);
    }
  };

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
        <div
          className="chip"
          style={{
            borderColor: 'var(--danger)',
            background: 'rgba(220,38,38,.08)',
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {translation && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ marginBottom: 6 }}>
                {translation.title || translation.originalFilename}
              </h2>
              <div className="muted">
                {translation.sourceLanguage?.toUpperCase()} →{' '}
                {translation.targetLanguage?.toUpperCase()}
              </div>
              <div className="muted mini" style={{ marginTop: 4 }}>
                Status: {translation.status}
              </div>
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

      {pausePending && (
        <div className="card info-note" style={{ marginBottom: 16 }}>
          <div className="muted mini">Pause requested. The translation worker will pause shortly.</div>
        </div>
      )}
      {isPaused && (
        <div className="card info-note" style={{ marginBottom: 16 }}>
          <div className="muted mini">Translation is paused. Resume from the overview to continue processing.</div>
        </div>
      )}
      {cancelPending && (
        <div className="card info-note" style={{ marginBottom: 16 }}>
          <div className="muted mini">Cancellation requested. Remaining work will stop soon.</div>
        </div>
      )}
      {isCancelled && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(220,38,38,0.4)', background: 'rgba(220,38,38,0.05)' }}>
          <div className="muted mini" style={{ color: '#dc2626' }}>Translation was cancelled. No further processing will occur.</div>
        </div>
      )}

      {/* Compare Shell */}
      {translation?.status === 'READY_FOR_REVIEW' ? (
        reviewLocked ? (
          <div className="card">
            <div className="muted">Translation review is currently read-only.</div>
            {chunkNotice && (
              <div className="muted mini" style={{ marginTop: 8 }}>
                {chunkNotice}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Sticky top bar (matches the prototype) */}
            <div className="compare-shell">
              <header className="topbar">
                <div className="bar">
                  <div className="title">Document Compare — Source ↔ Translation</div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={syncScroll}
                      onChange={(e) => setSyncScroll(e.target.checked)}
                    />
                    Sync scroll
                  </label>
                  <button className="btn" onClick={() => jumpTo('prev')} title="Alt+↑">
                    Prev match
                  </button>
                  <button className="btn" onClick={() => jumpTo('next')} title="Alt+↓">
                    Next match
                  </button>
                  {canExportTranslation && (
                    <>
                      <button className="btn primary" onClick={() => download('translatedDocx')}>
                        Export Translation
                      </button>
                      <button className="btn ghost" onClick={() => download('translatedPdf')}>
                        PDF
                      </button>
                    </>
                  )}
                </div>
                <div className="hint">
                  Click anywhere in the <strong>Translation</strong> (right). The matching passage in
                  the <strong>Source</strong> (left) will highlight for context. The translation is
                  fully editable as one continuous document.
                </div>
              </header>

              {/* Grid panes with draggable divider */}
              <main className="grid" ref={gridRef} id="compare-grid">
                <section className="pane" ref={leftPaneRef}>
                  <div className="paneHeader">Source (read‑only)</div>
                  <article
                    className="doc"
                    ref={sourceDocRef as any}
                    // render once; contents are plain HTML from server
                    dangerouslySetInnerHTML={{ __html: sourceMarkup }}
                  />
                </section>

                <div
                  id="divider-bar"
                  className="divider"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize panes"
                />

                <section className="pane" ref={rightPaneRef}>
                  <div className="paneHeader">
                    <div>Translation (editable)</div>
                    {/* Status for the active segment */}
                    {activeChunkId && (
                      <div className="statusLine">
                        {chunkStatuses[activeChunkId]?.state === 'saving' && (
                          <span className="status saving">Saving…</span>
                        )}
                        {chunkStatuses[activeChunkId]?.state === 'saved' && (
                          <span className="status saved">Autosaved</span>
                        )}
                        {chunkStatuses[activeChunkId]?.state === 'error' && (
                          <span className="status error">
                            {chunkStatuses[activeChunkId]?.message || 'Autosave failed'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <article
                    className="doc"
                    id="targetDoc"
                    ref={targetDocRef as any}
                    contentEditable={!!canEditChunks}
                    suppressContentEditableWarning
                    spellCheck={false}
                    dangerouslySetInnerHTML={{ __html: targetMarkup }}
                  />
                </section>
              </main>
            </div>
            {chunkNotice && (
              <div className="card info-note" style={{ marginTop: 12 }}>
                <div className="muted mini">{chunkNotice}</div>
              </div>
            )}
          </>
        )
      ) : isApproved ? (
        <div className="card">
          <div className="muted">Translation has been approved. Chunk data has been removed.</div>
          {chunkNotice && (
            <div className="muted mini" style={{ marginTop: 8 }}>
              {chunkNotice}
            </div>
          )}
        </div>
      ) : translation?.status === 'FAILED' ? (
        <div className="card">
          <div className="muted">Translation failed.</div>
          {translation.errorMessage && (
            <div className="muted mini" style={{ marginTop: 8 }}>
              {translation.errorMessage}
            </div>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="muted">Translation is still processing. Refresh shortly.</div>
        </div>
      )}

      <style jsx>{`
        /* ---------- Visual system inspired by the prototype ---------- */
        .compare-shell {
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          overflow: hidden;
          background: rgba(11, 12, 15, 0.6);
        }
        .topbar {
          padding: 12px 16px;
          background: linear-gradient(180deg, #11131a, #0f1218);
          border-bottom: 1px solid var(--border-subtle);
          position: sticky;
          top: 64px; /* sit below site header if present */
          z-index: 5;
        }
        @media (max-width: 860px) {
          .topbar {
            top: 56px;
          }
        }
        .bar {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }
        .title {
          font-weight: 700;
          margin-right: auto;
        }
        .check {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #9aa3b2;
          border: 1px solid var(--border-subtle);
          padding: 6px 10px;
          border-radius: 8px;
          background: rgba(14, 17, 24, 0.9);
          user-select: none;
        }
        .check input[type='checkbox'] {
          width: 16px;
          height: 16px;
          accent-color: #5b9cff;
        }
        .btn {
          border: 1px solid var(--border-subtle);
          background: rgba(14, 17, 24, 0.9);
          color: inherit;
          padding: 6px 10px;
          border-radius: 8px;
          cursor: pointer;
        }
        .btn.primary {
          background: #5b9cff;
          border-color: transparent;
          color: #071224;
          font-weight: 600;
        }
        .btn.ghost {
          background: transparent;
        }
        .hint {
          color: #9aa3b2;
          font-size: 0.9em;
          padding: 8px 2px 6px;
        }

        .grid {
          display: grid;
          grid-template-columns: 1fr 10px 1fr;
          gap: 0;
          min-height: 0;
        }
        .pane {
          min-height: 0;
          overflow: auto;
          background: rgba(8, 10, 16, 0.8);
          max-height: 72vh;
        }
        .pane::-webkit-scrollbar {
          width: 10px;
        }
        .pane::-webkit-scrollbar-thumb {
          background: #2a3142;
          border-radius: 8px;
        }
        .paneHeader {
          position: sticky;
          top: 0;
          z-index: 4;
          padding: 10px 16px;
          color: #9aa3b2;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: linear-gradient(180deg, #0b0d14, #0a0d13);
          border-bottom: 1px solid var(--border-subtle);
        }
        .doc {
          padding: 12px 18px 48px;
        }
        .doc h1,
        .doc h2,
        .doc h3 {
          margin: 0.7em 0 0.35em;
          line-height: 1.25;
        }
        .doc p {
          margin: 0.5em 0;
        }
        .doc ul,
        .doc ol {
          margin: 0.5em 0 0.75em 1.25em;
        }
        .doc table {
          border-collapse: collapse;
          margin: 0.4em 0 1em;
        }
        .doc td,
        .doc th {
          border: 1px solid #2a3142;
          padding: 6px 10px;
        }
        .doc pre {
          background: #0e1118;
          border: 1px solid var(--border-subtle);
          padding: 10px;
          border-radius: 8px;
          overflow: auto;
        }
        .doc figure {
          border: 1px solid var(--border-subtle);
          background: #0d1017;
          padding: 10px;
          border-radius: 8px;
          margin: 0.6em 0;
        }
        .doc figcaption {
          color: #9aa3b2;
          font-size: 0.9em;
        }

        /* Invisible segment wrappers + active highlight */
        .seg {
          margin: 0;
          padding: 0;
          border: 0;
        }
        .seg.active {
          background: rgba(91, 156, 255, 0.14);
          outline: 2px solid rgba(91, 156, 255, 0.55);
          outline-offset: 2px;
          border-radius: 8px;
        }

        .statusLine {
          display: flex;
          gap: 10px;
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

        .divider {
          background: linear-gradient(180deg, #0a0c12, #06070b);
          border-left: 1px solid var(--border-subtle);
          border-right: 1px solid var(--border-subtle);
          position: sticky;
          top: 0;
          cursor: col-resize;
        }

        @media (max-width: 1000px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .divider {
            display: none;
          }
          .pane {
            max-height: none;
          }
        }

        .info-note {
          border-color: rgba(59, 130, 246, 0.35);
          background: rgba(59, 130, 246, 0.08);
        }
      `}</style>
    </Layout>
  );
}