import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Layout from '../../components/Layout';
import {
  createTranslationUploadUrl,
  createTranslation,
  listTranslations,
  getTranslationDownloadUrl,
  deleteTranslation,
  restartTranslation,
  pauseTranslation,
  resumeTranslation,
  cancelTranslation,
  listTranslationLogs,
  inferDoc,
  type TranslationItem,
  type JobLogEntry
} from '../../lib/api';
import TranslationLogsIcon from '../../components/TranslationLogsIcon';

const LANG_OPTIONS = [
  { label: 'English', value: 'en' },
  { label: 'French', value: 'fr' }
];

const CATEGORY_ORDER = [
  'submission',
  'processing-kickoff',
  'processing',
  'chunk-processing',
  'reassembly',
  'review',
  'publication',
  'distribution',
  'notifications',
  'health-monitoring',
  'uncategorized'
];

const CATEGORY_LABELS: Record<string, string> = {
  submission: 'Submission & Intake',
  'processing-kickoff': 'Processing Kickoff',
  processing: 'Processing Updates',
  'chunk-processing': 'Chunk Translation Progress',
  reassembly: 'Reassembly & Assets',
  review: 'Review & Approval',
  publication: 'Publication & Availability',
  distribution: 'Distribution & Archival',
  notifications: 'Notifications',
  'health-monitoring': 'Health Monitoring',
  uncategorized: 'Other'
};

const STAGE_LABELS: Record<string, string> = {
  intake: 'Intake',
  start: 'Start',
  queue: 'Queue',
  'document-parse': 'Document Parsing',
  'asset-preparation': 'Asset Preparation',
  'chunk-edit': 'Chunk Review',
  approval: 'Approval',
  download: 'Download',
  cleanup: 'Cleanup',
  'manual-restart': 'Manual Restart',
  'auto-restart': 'Automatic Restart',
  'auto-fail': 'Automatic Failure',
  'chunk-persist': 'Chunk Persist',
  'machine-output': 'Machine Output',
  'machine-translation': 'Machine Translation',
  embedding: 'Embedding',
  indexing: 'Indexing',
  'metadata-update': 'Metadata Update'
};

function formatCategory(category?: string | null): string {
  if (!category) return CATEGORY_LABELS.uncategorized;
  return CATEGORY_LABELS[category] || category.split(/[-_]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function formatStage(stage?: string | null): string {
  if (!stage) return '—';
  return STAGE_LABELS[stage] || stage.split(/[-_]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function groupLogs(entries: JobLogEntry[]): Record<string, JobLogEntry[]> {
  return entries.reduce<Record<string, JobLogEntry[]>>((acc, entry) => {
    const key = entry.category || 'uncategorized';
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});
}

function sortCategories(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function formatActor(actor?: JobLogEntry['actor']): string {
  if (!actor) return 'Unknown';
  return actor.name || actor.email || actor.sub || actor.source || (actor.type === 'system' ? 'System' : actor.type) || 'Unknown';
}

type LogsModalState = {
  open: boolean;
  translationId: string | null;
  title: string;
  entries: JobLogEntry[];
  loading: boolean;
  loadingMore: boolean;
  nextToken: string | null;
  error: string | null;
  expanded: Record<string, boolean>;
};

const LOGS_MODAL_DEFAULT: LogsModalState = {
  open: false,
  translationId: null,
  title: '',
  entries: [],
  loading: false,
  loadingMore: false,
  nextToken: null,
  error: null,
  expanded: {}
};

function statusLabel(status: string) {
  switch (status) {
    case 'READY_FOR_REVIEW': return 'Ready for review';
    case 'APPROVED': return 'Approved';
    case 'FAILED': return 'Failed';
    case 'PAUSE_REQUESTED': return 'Pausing…';
    case 'PAUSED': return 'Paused';
    case 'CANCEL_REQUESTED': return 'Stopping…';
    case 'CANCELLED': return 'Cancelled';
    case 'PROCESSING':
    default:
      return 'Processing';
  }
}

function statusClass(status: string) {
  switch (status) {
    case 'READY_FOR_REVIEW': return 'ready';
    case 'APPROVED': return 'ready';
    case 'FAILED': return 'error';
    case 'PAUSE_REQUESTED': return 'processing';
    case 'PAUSED': return 'processing';
    case 'CANCEL_REQUESTED': return 'error';
    case 'CANCELLED': return 'error';
    default: return 'processing';
  }
}

export default function TranslationsPage() {
  const [items, setItems] = useState<TranslationItem[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inferring, setInferring] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ translationId: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [restartConfirm, setRestartConfirm] = useState<{ translationId: string; title: string } | null>(null);
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [logsModal, setLogsModal] = useState<LogsModalState>(LOGS_MODAL_DEFAULT);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    sourceLanguage: 'fr',
    targetLanguage: 'en'
  });

  async function refresh(silent = false) {
    if (!silent) setInitialLoading(true);
    try {
      const res = await listTranslations();
      const incoming = res.items || [];
      setItems(prev => {
        if (!prev.length) return incoming;
        const map = new Map(prev.map(item => [item.translationId, item]));
        return incoming.map(item => {
          const existing = map.get(item.translationId);
          return existing ? { ...existing, ...item } : item;
        });
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load translations');
    } finally {
      setInitialLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      // Check if the click is outside any dropdown
      const target = event.target as Element;
      if (!target.closest('[data-dropdown]')) {
        setOpenDropdown(null);
      }
    }
    if (openDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openDropdown]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!items.length) return;
    const hasProcessing = items.some(item => item.status === 'PROCESSING');
    if (!hasProcessing) return;
    const timer = setInterval(() => refresh(true), 8000);
    return () => clearInterval(timer);
  }, [items.map(i => `${i.translationId}:${i.status}`).join(',')]);

  const runInference = useCallback(async (file: File) => {
    setInferring(true);
    try {
      const sampleBlob = file.slice(0, 4000);
      const sampleText = await sampleBlob.text();
      if (sampleText && sampleText.trim()) {
        const inferred = await inferDoc(file.name, sampleText);
        const fallbackTitle = file.name.replace(/\.[^.]+$/, '');
        setForm(prev => {
          const detected = String(inferred.language || '').toLowerCase();
          let sourceLanguage = prev.sourceLanguage;
          let targetLanguage = prev.targetLanguage;
          if (detected === 'fr' || detected === 'fre' || detected === 'fra') {
            sourceLanguage = 'fr';
            targetLanguage = 'en';
          } else if (detected === 'en' || detected === 'eng') {
            sourceLanguage = 'en';
            targetLanguage = 'fr';
          }

          return {
            ...prev,
            title: inferred.title || fallbackTitle,
            description: inferred.description || prev.description || '',
            sourceLanguage,
            targetLanguage
          };
        });
      }
    } catch (err: any) {
      console.warn('Translation inference failed:', err?.message || err);
      setError('Could not infer document details automatically.');
    } finally {
      setInferring(false);
    }
  }, []);

  const handleFileSelection = useCallback(async (file: File | undefined | null) => {
    if (!file) {
      setSelectedFile(null);
      return;
    }
    setError(null);
    setSelectedFile(file);
    const fallbackTitle = file.name.replace(/\.[^.]+$/, '');
    setForm(prev => ({
      ...prev,
      title: fallbackTitle,
      description: prev.description || ''
    }));
    await runInference(file);
  }, [runInference]);

  const resetModalState = useCallback(() => {
    setSelectedFile(null);
    setForm({
      title: '',
      description: '',
      sourceLanguage: 'fr',
      targetLanguage: 'en'
    });
    if (fileRef.current) fileRef.current.value = '';
    setInferring(false);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    resetModalState();
  }, [resetModalState]);

  async function startTranslation() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const file = selectedFile || fileRef.current?.files?.[0];
      if (!file) throw new Error('Please choose a document');
      const upload = await createTranslationUploadUrl(file.name, file.type || 'application/octet-stream');
      await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': upload.contentType }, body: file });
      await createTranslation({
        translationId: upload.translationId,
        fileKey: upload.fileKey,
        originalFilename: upload.filename,
        title: form.title || file.name,
        description: form.description,
        sourceLanguage: form.sourceLanguage,
        targetLanguage: form.targetLanguage
      });
      closeModal();
      await refresh(true);
      setNotice('Translation submitted. Processing will continue in the background.');
    } catch (err: any) {
      setError(err.message || 'Translation request failed');
    } finally {
      setBusy(false);
    }
  }

  async function download(translationId: string, type: 'original' | 'translatedHtml') {
    try {
      const { url } = await getTranslationDownloadUrl(translationId, type);
      if (url) window.open(url, '_blank');
      setOpenDropdown(null); // Close dropdown after download
    } catch (err: any) {
      setError(err.message || 'Download failed');
      setOpenDropdown(null);
    }
  }

  function toggleDropdown(translationId: string) {
    setOpenDropdown(openDropdown === translationId ? null : translationId);
  }

  function showDeleteConfirm(translationId: string, title: string) {
    setDeleteConfirm({ translationId, title });
  }

  function closeDeleteModal() {
    setDeleteConfirm(null);
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;

    setDeleting(true);
    try {
      await deleteTranslation(deleteConfirm.translationId);
      setNotice('Translation deleted successfully');
      // Remove from local state
      setItems(prev => prev.filter(item => item.translationId !== deleteConfirm.translationId));
      setDeleteConfirm(null);
    } catch (err: any) {
      setError(err.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  const handleRestartClick = useCallback((item: TranslationItem) => {
    setRestartConfirm({ translationId: item.translationId, title: item.title || item.originalFilename || item.translationId });
  }, []);

  const closeRestartModal = useCallback(() => {
    setRestartConfirm(null);
  }, []);

  const handlePause = useCallback(async (item: TranslationItem) => {
    setPausingId(item.translationId);
    try {
      setError(null);
      await pauseTranslation(item.translationId);
      setNotice('Pause request queued. Processing will halt shortly.');
      await refresh(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to pause translation');
    } finally {
      setPausingId(null);
    }
  }, [refresh]);

  const handleResume = useCallback(async (item: TranslationItem) => {
    setResumingId(item.translationId);
    try {
      setError(null);
      await resumeTranslation(item.translationId);
      setNotice('Resume request queued. Processing will continue.');
      await refresh(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to resume translation');
    } finally {
      setResumingId(null);
    }
  }, [refresh]);

  const handleCancel = useCallback(async (item: TranslationItem) => {
    setCancellingId(item.translationId);
    try {
      setError(null);
      await cancelTranslation(item.translationId);
      setNotice('Cancellation requested. Remaining work will stop shortly.');
      await refresh(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel translation');
    } finally {
      setCancellingId(null);
    }
  }, [refresh]);

  async function confirmRestart() {
    if (!restartConfirm) return;
    setRestartingId(restartConfirm.translationId);
    setError(null);
    try {
      await restartTranslation(restartConfirm.translationId);
      setNotice('Translation restart queued. Processing will resume shortly.');
      setRestartConfirm(null);
      await refresh(true);
    } catch (err: any) {
      setError(err.message || 'Restart failed');
    } finally {
      setRestartingId(null);
    }
  }

  const openLogs = useCallback(async (item: TranslationItem) => {
    setLogsModal({
      ...LOGS_MODAL_DEFAULT,
      open: true,
      translationId: item.translationId,
      title: item.title || item.originalFilename || 'Translation logs',
      loading: true
    });
    try {
      const res = await listTranslationLogs(item.translationId);
      const entries = res.items || [];
      const grouped = groupLogs(entries);
      const expanded = Object.keys(grouped).reduce<Record<string, boolean>>((acc, key) => {
        acc[key] = true;
        return acc;
      }, {});
      setLogsModal(prev => ({
        ...prev,
        loading: false,
        entries,
        nextToken: res.nextToken || null,
        expanded
      }));
    } catch (err: any) {
      setLogsModal(prev => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to load logs'
      }));
    }
  }, []);

  const closeLogsModal = useCallback(() => {
    setLogsModal({ ...LOGS_MODAL_DEFAULT });
  }, []);

  const loadMoreLogs = useCallback(async () => {
    if (!logsModal.translationId || !logsModal.nextToken || logsModal.loadingMore) return;
    const translationId = logsModal.translationId;
    const token = logsModal.nextToken;
    setLogsModal(prev => ({ ...prev, loadingMore: true, error: null }));
    try {
      const res = await listTranslationLogs(translationId, token);
      setLogsModal(prev => {
        const mergedEntries = [...prev.entries, ...(res.items || [])];
        const grouped = groupLogs(mergedEntries);
        const expanded = { ...prev.expanded };
        Object.keys(grouped).forEach(key => {
          if (typeof expanded[key] === 'undefined') {
            expanded[key] = true;
          }
        });
        return {
          ...prev,
          loadingMore: false,
          entries: mergedEntries,
          nextToken: res.nextToken || null,
          expanded
        };
      });
    } catch (err: any) {
      setLogsModal(prev => ({
        ...prev,
        loadingMore: false,
        error: err.message || 'Failed to load more logs'
      }));
    }
  }, [logsModal.translationId, logsModal.nextToken, logsModal.loadingMore]);

  const onFileChange = async () => {
    const file = fileRef.current?.files?.[0];
    await handleFileSelection(file || null);
  };

  const onDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (fileRef.current) {
      fileRef.current.value = '';
    }
      await handleFileSelection(file);
  }, [handleFileSelection]);

  const prevent = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const groupedLogs = useMemo(() => groupLogs(logsModal.entries), [logsModal.entries]);
  const orderedCategories = useMemo(() => sortCategories(Object.keys(groupedLogs)), [groupedLogs]);

  const toggleCategoryVisibility = useCallback((category: string) => {
    setLogsModal(prev => ({
      ...prev,
      expanded: {
        ...prev.expanded,
        [category]: !prev.expanded?.[category]
      }
    }));
  }, []);

  return (
    <Layout>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Translations</h2>
          <div className="muted">Manage document translation requests and review progress.</div>
        </div>
        <button className="btn" onClick={() => { setShowModal(true); resetModalState(); }}>
          New translation
        </button>
      </div>

      {notice && (
        <div className="chip" style={{ borderColor: 'var(--accent)', background: 'rgba(14,116,144,.12)', marginBottom: 16 }}>
          {notice}
        </div>
      )}

      {error && (
        <div className="chip" style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,.08)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {initialLoading ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div className="muted">Loading translations…</div>
        </div>
      ) : !items.length ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No translations yet</div>
          <div className="muted" style={{ marginBottom: 20 }}>Start by translating a new document.</div>
          <button className="btn" onClick={() => { setShowModal(true); resetModalState(); }}>New translation</button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table" style={{ width: '100%', margin: 0 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', paddingLeft: 24 }}>Title</th>
                <th style={{ width: 140 }}>Languages</th>
                <th style={{ width: 140 }}>Status</th>
                <th style={{ width: 180 }}>Updated</th>
                <th style={{ width: 220 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const canRestart = item.status === 'FAILED' || item.status === 'PROCESSING' || item.status === 'CANCELLED';
                const restarting = restartingId === item.translationId;
                const pausing = pausingId === item.translationId;
                const resuming = resumingId === item.translationId;
                const cancelling = cancellingId === item.translationId;
                const pausePending = item.status === 'PAUSE_REQUESTED';
                const cancelPending = item.status === 'CANCEL_REQUESTED';
                const showPause = item.status === 'PROCESSING';
                const showResume = item.status === 'PAUSED' || pausePending;
                const showCancel = ['PROCESSING', 'PAUSE_REQUESTED', 'PAUSED', 'CANCEL_REQUESTED'].includes(item.status);
                return (
                  <tr key={item.translationId}>
                    <td style={{ paddingLeft: 24 }}>
                      <div style={{ fontWeight: 600 }}>{item.title || item.originalFilename}</div>
                      <div className="muted mini">{item.originalFilename}</div>
                    </td>
                    <td>{item.sourceLanguage?.toUpperCase()} → {item.targetLanguage?.toUpperCase()}</td>
                    <td>
                      <span className={`chip mini ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                    </td>
                    <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—'}</td>
                    <td>
                      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                      <div style={{ position: 'relative' }} data-dropdown>
                        <button
                          className="btn mini"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleDropdown(item.translationId);
                          }}
                          style={{ 
                            padding: '6px 8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <svg 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="1.5"
                            style={{ width: '16px', height: '16px' }}
                          >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7,10 12,15 17,10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                        {openDropdown === item.translationId && (
                          <div 
                            style={{
                              position: 'absolute',
                              top: '100%',
                              right: 0,
                              background: 'white',
                              border: '1px solid #ddd',
                              borderRadius: '4px',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                              zIndex: 1000,
                              minWidth: '150px'
                            }}
                          >
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                download(item.translationId, 'original');
                              }}
                              style={{ 
                                width: '100%', 
                                textAlign: 'left', 
                                border: 'none',
                                background: 'transparent',
                                padding: '8px 12px',
                                cursor: 'pointer',
                                fontSize: '14px'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = '#f5f5f5';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              Original
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                download(item.translationId, 'translatedHtml');
                              }}
                              style={{ 
                                width: '100%', 
                                textAlign: 'left', 
                                border: 'none',
                                borderTop: '1px solid #eee',
                                background: 'transparent',
                                padding: '8px 12px',
                                cursor: 'pointer',
                                fontSize: '14px'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = '#f5f5f5';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              Translation .html
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        className="btn ghost mini"
                        onClick={() => openLogs(item)}
                        title="View translation logs"
                        style={{
                          padding: '6px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <TranslationLogsIcon style={{ width: 16, height: 16 }} />
                      </button>
                      {showPause && (
                        <button
                          className="btn ghost mini"
                          onClick={() => handlePause(item)}
                          disabled={pausing || cancelling || cancelPending}
                          title={pausing || pausePending ? 'Pausing…' : 'Pause translation'}
                          aria-label="Pause translation"
                          style={{
                            padding: '6px 8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          {pausing || pausePending ? (
                            <span style={{ fontSize: 11 }}>…</span>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 16, height: 16 }}>
                              <line x1="9" y1="5" x2="9" y2="19" />
                              <line x1="15" y1="5" x2="15" y2="19" />
                            </svg>
                          )}
                        </button>
                      )}
                      {showResume && (
                        <button
                          className="btn ghost mini"
                          onClick={() => handleResume(item)}
                          disabled={resuming || cancelling || cancelPending}
                          title={resuming ? 'Resuming…' : 'Resume translation'}
                          aria-label="Resume translation"
                          style={{
                            padding: '6px 8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          {resuming ? (
                            <span style={{ fontSize: 11 }}>…</span>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 16, height: 16 }}>
                              <polygon points="8,5 19,12 8,19" fill="currentColor" />
                            </svg>
                          )}
                        </button>
                      )}
                      {showCancel && (
                        <button
                          className="btn ghost mini"
                          onClick={() => handleCancel(item)}
                          disabled={cancelling || cancelPending}
                          title={cancelPending ? 'Cancellation requested' : 'Stop translation'}
                          aria-label="Stop translation"
                          style={{
                            padding: '6px 8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          {cancelling || cancelPending ? (
                            <span style={{ fontSize: 11 }}>…</span>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 16, height: 16 }}>
                              <rect x="7" y="7" width="10" height="10" />
                            </svg>
                          )}
                        </button>
                      )}
                      <button
                        className="btn mini"
                        onClick={() => handleRestartClick(item)}
                        disabled={!canRestart || restarting || cancelling || cancelPending || pausing || pausePending}
                        style={{
                          padding: '6px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        {restarting ? 'Restarting…' : 'Restart'}
                      </button>
                      <button
                        className="btn ghost mini"
                        onClick={() => showDeleteConfirm(item.translationId, item.title || item.originalFilename)}
                        disabled={deleting}
                        style={{ 
                          padding: '6px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <svg 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="1.5"
                          style={{ width: '16px', height: '16px' }}
                        >
                          <polyline points="3,6 5,6 21,6" />
                          <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                      <Link className="btn mini" href={`/translations/${item.translationId}`}>
                        {item.status === 'READY_FOR_REVIEW' || item.status === 'APPROVED' ? 'Review' : 'Details'}
                      </Link>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div 
            className="modal" 
            onClick={e => e.stopPropagation()}
            style={{ 
              background: '#0f172a',
              color: '#f8fafc'
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, color: '#f8fafc' }}>New translation</h3>
              <button 
                className="btn ghost mini" 
                onClick={closeModal}
                style={{ 
                  color: '#cbd5e1',
                  borderColor: 'rgba(148, 163, 184, 0.4)'
                }}
              >
                Close
              </button>
            </div>

            <div
              className="upload-zone"
              onDrop={onDrop}
              onDragOver={prevent}
              onDragEnter={prevent}
              onClick={() => fileRef.current?.click()}
              style={{
                marginBottom: 20,
                background: '#0f172a',
                color: '#f8fafc',
                borderColor: 'rgba(148, 163, 184, 0.4)'
              }}
            >
              <div className="upload-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17,8 12,3 7,8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
                Drag & drop file here
              </div>
              <div className="muted" style={{ marginBottom: 16 }}>
                or click to browse
              </div>
              <div className="muted mini">
                Supported: DOCX, PDF, TXT, HTML
              </div>
              <input
                type="file"
                ref={fileRef}
                style={{ display: 'none' }}
                accept=".pdf,.docx,.txt,.html"
                onChange={onFileChange}
              />
            </div>

            {selectedFile && (
              <div 
                className="chip" 
                style={{ 
                  marginBottom: 16,
                  background: 'rgba(59, 130, 246, 0.1)',
                  borderColor: 'rgba(59, 130, 246, 0.3)',
                  color: '#93c5fd'
                }}
              >
                Selected: {selectedFile.name}
              </div>
            )}

            {inferring && (
              <div 
                className="chip" 
                style={{ 
                  marginBottom: 16, 
                  background: 'rgba(14,116,144,.2)', 
                  borderColor: 'rgba(14,116,144,.4)',
                  color: '#67e8f9'
                }}
              >
                Analysing document metadata…
              </div>
            )}

            <div className="row" style={{ gap: 16, marginBottom: 16 }}>
              <input
                className="input"
                placeholder="Title"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                style={{ 
                  flex: 2,
                  background: 'rgba(148, 163, 184, 0.1)',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  color: '#f8fafc'
                }}
              />
              <select
                className="input"
                value={form.sourceLanguage}
                onChange={e => setForm({ ...form, sourceLanguage: e.target.value })}
                style={{ 
                  flex: 1,
                  background: 'rgba(148, 163, 184, 0.1)',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  color: '#f8fafc'
                }}
              >
                {LANG_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value} style={{ background: '#1e293b', color: '#f8fafc' }}>{opt.label}</option>
                ))}
              </select>
              <select
                className="input"
                value={form.targetLanguage}
                onChange={e => setForm({ ...form, targetLanguage: e.target.value })}
                style={{ 
                  flex: 1,
                  background: 'rgba(148, 163, 184, 0.1)',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  color: '#f8fafc'
                }}
              >
                {LANG_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value} style={{ background: '#1e293b', color: '#f8fafc' }}>{opt.label}</option>
                ))}
              </select>
            </div>

            <textarea
              className="textarea"
              placeholder="Description"
              rows={3}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              style={{ 
                marginBottom: 20,
                background: 'rgba(148, 163, 184, 0.1)',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                color: '#f8fafc'
              }}
            />

            <button 
              className="btn" 
              onClick={startTranslation} 
              disabled={busy || !selectedFile}
              style={{
                background: '#3b82f6',
                color: 'white',
                border: '1px solid #3b82f6'
              }}
            >
              {busy ? 'Submitting…' : 'Start translation'}
            </button>

            {!selectedFile && (
              <div className="muted mini" style={{ marginTop: 12, color: '#94a3b8' }}>
                Select a file to enable translation.
              </div>
            )}
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="modal-backdrop" onClick={closeDeleteModal}>
          <div
            className="modal"
            onClick={e => e.stopPropagation()}
            style={{ 
              maxWidth: '480px',
              background: '#0f172a',
              color: '#f8fafc'
            }}
          >
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ margin: 0, marginBottom: 8, color: '#ef4444' }}>Delete Translation</h3>
              <p style={{ margin: 0, color: '#cbd5e1' }}>
                Are you sure you want to delete this translation? This action cannot be undone.
              </p>
            </div>

            <div 
              style={{ 
                marginBottom: 20, 
                padding: 16, 
                background: 'rgba(148, 163, 184, 0.1)', 
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: '8px'
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#f8fafc' }}>{deleteConfirm.title}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Translation ID: {deleteConfirm.translationId}</div>
            </div>

            <div className="row" style={{ gap: 12, justifyContent: 'flex-end' }}>
              <button 
                className="btn ghost" 
                onClick={closeDeleteModal} 
                disabled={deleting}
                style={{ 
                  color: '#cbd5e1',
                  borderColor: 'rgba(148, 163, 184, 0.4)'
                }}
              >
                Cancel
              </button>
              <button 
                className="btn" 
                onClick={confirmDelete} 
                disabled={deleting}
                style={{ 
                  background: '#ef4444', 
                  color: 'white',
                  border: '1px solid #ef4444'
                }}
              >
                {deleting ? 'Deleting…' : 'Delete Translation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {restartConfirm && (
        <div className="modal-backdrop" onClick={closeRestartModal}>
          <div
            className="modal"
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '460px',
              background: '#0f172a',
              color: '#f8fafc'
            }}
          >
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ margin: 0, marginBottom: 8, color: '#38bdf8' }}>Restart translation</h3>
              <p style={{ margin: 0, color: '#cbd5e1' }}>
                This will queue the translation for processing again. Existing progress will be preserved.
              </p>
            </div>

            <div
              style={{
                marginBottom: 20,
                padding: 16,
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.2)',
                borderRadius: '8px'
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#f8fafc' }}>{restartConfirm.title}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Translation ID: {restartConfirm.translationId}</div>
            </div>

            <div className="row" style={{ gap: 12, justifyContent: 'flex-end' }}>
              <button
                className="btn ghost"
                onClick={closeRestartModal}
                disabled={restartingId === restartConfirm.translationId}
                style={{
                  color: '#cbd5e1',
                  borderColor: 'rgba(148, 163, 184, 0.4)'
                }}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={confirmRestart}
                disabled={restartingId === restartConfirm.translationId}
                style={{
                  background: '#38bdf8',
                  color: '#0f172a',
                  border: '1px solid #38bdf8'
                }}
              >
                {restartingId === restartConfirm.translationId ? 'Restarting…' : 'Restart translation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {logsModal.open && (
        <div className="modal-backdrop" onClick={closeLogsModal}>
          <div
            className="modal"
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '720px',
              background: '#0f172a',
              color: '#f8fafc',
              maxHeight: '80vh',
              overflowY: 'auto'
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, color: '#f8fafc' }}>Activity logs</h3>
                <div className="muted mini" style={{ color: '#94a3b8' }}>{logsModal.title}</div>
              </div>
              <button
                className="btn ghost mini"
                onClick={closeLogsModal}
                style={{
                  color: '#cbd5e1',
                  borderColor: 'rgba(148, 163, 184, 0.4)'
                }}
              >
                Close
              </button>
            </div>

            {logsModal.error && (
              <div className="chip" style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,.08)', marginBottom: 16 }}>
                {logsModal.error}
              </div>
            )}

            {logsModal.loading ? (
              <div className="muted" style={{ padding: '24px 0' }}>Loading logs…</div>
            ) : orderedCategories.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {orderedCategories.map(category => {
                  const entries = groupedLogs[category] || [];
                  const key = category || 'uncategorized';
                  const expanded = logsModal.expanded[key] ?? true;
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
                        onClick={() => toggleCategoryVisibility(key)}
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
                            const percent = total && completed !== null ? Math.round((completed / total) * 100) : null;
                            return (
                              <div
                                key={entry.logId || `${entry.createdAt}-${idx}`}
                                style={{
                                  border: '1px solid rgba(148,163,184,0.2)',
                                  borderRadius: 8,
                                  padding: 12,
                                  background: 'rgba(15,23,42,0.48)'
                                }}
                              >
                                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                                  <div style={{ fontWeight: 600 }}>{entry.message || entry.eventType}</div>
                                  <div className="muted mini" style={{ color: '#94a3b8' }}>{new Date(entry.createdAt).toLocaleString()}</div>
                                </div>
                                <div className="muted mini" style={{ color: '#a5b4fc', marginBottom: 6 }}>
                                  Stage: {formatStage(entry.stage)} · Status: {entry.status || '—'} · Actor: {actorLabel}
                                  {typeof entry.attempt === 'number' && entry.attempt > 0 && (
                                    <> · Attempt #{entry.attempt}</>
                                  )}
                                  {typeof entry.retryCount === 'number' && entry.retryCount > 0 && (
                                    <> · Retries {entry.retryCount}</>
                                  )}
                                </div>
                                {chunk && total && (
                                  <div className="muted mini" style={{ color: '#cbd5e1', marginBottom: 6 }}>
                                    Progress: {completed ?? 0}/{total} {failed ? `(failed ${failed})` : ''} {percent !== null ? `· ${percent}%` : ''}
                                  </div>
                                )}
                                {entry.failureReason && (
                                  <div className="chip mini" style={{
                                    marginBottom: 6,
                                    borderColor: 'rgba(220,38,38,0.5)',
                                    background: 'rgba(220,38,38,0.12)',
                                    color: '#fecaca'
                                  }}>
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
            ) : (
              <div className="muted" style={{ padding: '24px 0' }}>No activity recorded in the last 10 days.</div>
            )}

            {logsModal.nextToken && (
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn ghost mini"
                  onClick={loadMoreLogs}
                  disabled={logsModal.loadingMore}
                  style={{
                    color: '#cbd5e1',
                    borderColor: 'rgba(148, 163, 184, 0.4)'
                  }}
                >
                  {logsModal.loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          z-index: 40;
        }
        .modal {
          background: #0f172a;
          color: #f8fafc;
          border-radius: 16px;
          padding: 28px;
          max-width: 640px;
          width: 100%;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.25);
        }
        .modal .upload-zone .muted,
        .modal .upload-zone .muted.mini {
          color: rgba(248, 250, 252, 0.82);
        }
        .modal .input,
        .modal .textarea {
          background: rgba(148, 163, 184, 0.1) !important;
          border: 1px solid rgba(148, 163, 184, 0.3) !important;
          color: #f8fafc !important;
        }
        .modal .input::placeholder,
        .modal .textarea::placeholder {
          color: #94a3b8 !important;
        }
        .modal .input option {
          background: #1e293b !important;
          color: #f8fafc !important;
        }
      `}</style>
    </Layout>
  );
}
