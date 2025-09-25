import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Layout from '../../components/Layout';
import {
  createTranslationUploadUrl,
  createTranslation,
  listTranslations,
  getTranslationDownloadUrl,
  inferDoc,
  type TranslationItem
} from '../../lib/api';

const LANG_OPTIONS = [
  { label: 'English', value: 'en' },
  { label: 'French', value: 'fr' }
];

function statusLabel(status: string) {
  switch (status) {
    case 'READY_FOR_REVIEW': return 'Ready for review';
    case 'APPROVED': return 'Approved';
    case 'FAILED': return 'Failed';
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
              {items.map(item => (
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
                      <Link className="btn mini" href={`/translations/${item.translationId}`}>
                        {item.status === 'READY_FOR_REVIEW' || item.status === 'APPROVED' ? 'Review' : 'Details'}
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>New translation</h3>
              <button className="btn ghost mini" onClick={closeModal}>Close</button>
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
              <div className="chip" style={{ marginBottom: 16 }}>
                Selected: {selectedFile.name}
              </div>
            )}

            {inferring && (
              <div className="chip" style={{ marginBottom: 16, background: 'rgba(14,116,144,.1)', borderColor: 'var(--accent)' }}>
                Analysing document metadata…
              </div>
            )}

            <div className="row" style={{ gap: 16, marginBottom: 16 }}>
              <input
                className="input"
                placeholder="Title"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                style={{ flex: 2 }}
              />
              <select
                className="input"
                value={form.sourceLanguage}
                onChange={e => setForm({ ...form, sourceLanguage: e.target.value })}
                style={{ flex: 1 }}
              >
                {LANG_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select
                className="input"
                value={form.targetLanguage}
                onChange={e => setForm({ ...form, targetLanguage: e.target.value })}
                style={{ flex: 1 }}
              >
                {LANG_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <textarea
              className="textarea"
              placeholder="Description"
              rows={3}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              style={{ marginBottom: 20 }}
            />

            <button className="btn" onClick={startTranslation} disabled={busy || !selectedFile}>
              {busy ? 'Submitting…' : 'Start translation'}
            </button>

            {!selectedFile && (
              <div className="muted mini" style={{ marginTop: 12 }}>
                Select a file to enable translation.
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
          background: #fff;
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
      `}</style>
    </Layout>
  );
}
