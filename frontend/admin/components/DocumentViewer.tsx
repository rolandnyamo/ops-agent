import React, { useState, useEffect } from 'react';
import { DocItem } from '../lib/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import { cfg } from '../lib/config';

interface DocumentViewerProps {
  document: DocItem;
  isOpen: boolean;
  onClose: () => void;
  agentId?: string;
}

export default function DocumentViewer({ document, isOpen, onClose, agentId }: DocumentViewerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [documentUrl, setDocumentUrl] = useState<string | undefined>();
  const [documentContent, setDocumentContent] = useState<string | undefined>();

  useEffect(() => {
    if (isOpen && document.fileKey) {
      loadDocument();
    }
    return () => {
      if (documentUrl) {
        URL.revokeObjectURL(documentUrl);
      }
    };
  }, [isOpen, document.fileKey]);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.document.addEventListener('keydown', handleKeyDown);
    return () => window.document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const getAuthHeader = async () => {
    try {
      const { tokens } = await fetchAuthSession();
      const id = tokens?.idToken?.toString();
      return id ? { Authorization: `Bearer ${id}` } : {};
    } catch {
      return {};
    }
  };

  const loadDocument = async () => {
    if (!document.fileKey) {
      setError('No file available for this document');
      return;
    }

    setLoading(true);
    setError(undefined);

    try {
      // Get document content via API
      const headers = await getAuthHeader();
      const url = agentId 
        ? `${cfg.apiBase}/docs/view/${encodeURIComponent(document.docId)}?agentId=${encodeURIComponent(agentId)}`
        : `${cfg.apiBase}/docs/view/${encodeURIComponent(document.docId)}`;
      const response = await fetch(url, {
        headers
      });

      if (!response.ok) {
        throw new Error(`Failed to load document: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const blob = await response.blob();

      // Handle different document types
      if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
        const text = await blob.text();
        setDocumentContent(text);
      } else if (contentType.includes('application/pdf') || 
                 contentType.includes('image/') || 
                 contentType.includes('text/html')) {
        const url = URL.createObjectURL(blob);
        setDocumentUrl(url);
      } else {
        // For other types, try to create a download URL
        const url = URL.createObjectURL(blob);
        setDocumentUrl(url);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load document');
    } finally {
      setLoading(false);
    }
  };

  const getFileExtension = (title: string) => {
    return title.split('.').pop()?.toLowerCase() || '';
  };

  const renderDocumentContent = () => {
    if (loading) {
      return (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '400px',
          color: 'var(--muted)'
        }}>
          <div>Loading document...</div>
        </div>
      );
    }

    if (error) {
      return (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '400px',
          flexDirection: 'column',
          gap: 16
        }}>
          <div style={{ color: 'var(--danger)' }}>Failed to load document</div>
          <div style={{ color: 'var(--muted)', fontSize: '14px' }}>{error}</div>
          <button className="btn ghost" onClick={loadDocument}>
            Retry
          </button>
        </div>
      );
    }

    // Text content
    if (documentContent) {
      return (
        <div style={{ 
          height: '400px', 
          overflow: 'auto', 
          background: 'var(--panel)', 
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          padding: '16px'
        }}>
          <pre style={{ 
            whiteSpace: 'pre-wrap', 
            fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
            fontSize: '14px',
            lineHeight: '1.5',
            margin: 0,
            color: 'var(--text)'
          }}>
            {documentContent}
          </pre>
        </div>
      );
    }

    // PDF or other embeddable content
    if (documentUrl) {
      const extension = getFileExtension(document.title);
      
      if (extension === 'pdf') {
        return (
          <iframe
            src={documentUrl}
            style={{
              width: '100%',
              height: '500px',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)'
            }}
            title={document.title}
          />
        );
      }

      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension)) {
        return (
          <div style={{ textAlign: 'center' }}>
            <img
              src={documentUrl}
              alt={document.title}
              style={{
                maxWidth: '100%',
                maxHeight: '500px',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius)'
              }}
            />
          </div>
        );
      }

      // For other file types, show download option
      return (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '400px',
          flexDirection: 'column',
          gap: 16
        }}>
          <div style={{ fontSize: '48px' }}>📄</div>
          <div style={{ fontSize: '16px', fontWeight: 500 }}>{document.title}</div>
          <div style={{ color: 'var(--muted)' }}>
            This file type cannot be previewed in the browser
          </div>
          <a 
            href={documentUrl} 
            download={document.title}
            className="btn"
          >
            Download File
          </a>
        </div>
      );
    }

    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '400px',
        color: 'var(--muted)'
      }}>
        No document content available
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div className="card" style={{
        width: '90%',
        maxWidth: '900px',
        maxHeight: '90vh',
        overflow: 'auto',
        margin: '20px'
      }}>
        <div className="row" style={{ 
          justifyContent: 'space-between', 
          alignItems: 'flex-start', 
          marginBottom: 16,
          borderBottom: '1px solid var(--line)',
          paddingBottom: 16
        }}>
          <div>
            <h3 className="card-title" style={{ margin: 0, marginBottom: 4 }}>
              {document.title}
            </h3>
            <div className="row" style={{ gap: 12, alignItems: 'center', fontSize: '12px', color: 'var(--muted)' }}>
              {document.category && <div>Category: {document.category}</div>}
              {document.audience && <div>Audience: {document.audience}</div>}
              {document.version && <div>Version: {document.version}</div>}
              {document.size && (
                <div>Size: {(document.size / 1024).toFixed(1)} KB</div>
              )}
            </div>
          </div>
          <button 
            onClick={onClose}
            className="btn ghost"
            style={{ 
              padding: '4px 8px',
              fontSize: '18px',
              lineHeight: 1,
              minWidth: 'auto'
            }}
          >
            ×
          </button>
        </div>

        {renderDocumentContent()}
      </div>
    </div>
  );
}
