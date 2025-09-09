import React, { useEffect, useState } from 'react';

interface SuccessModalProps {
  title: string;
  message: string;
  onClose: () => void;
  onAddAnother?: () => void;
  onViewAll?: () => void;
}

export default function SuccessModal({ title, message, onClose, onAddAnother, onViewAll }: SuccessModalProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
    const timer = setTimeout(() => {
      onClose();
    }, 5000); // Auto close after 5 seconds

    return () => clearTimeout(timer);
  }, [onClose]);

  if (!isVisible) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="success-modal" onClick={(e) => e.stopPropagation()}>
        <div className="success-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22,4 12,14.01 9,11.01" />
          </svg>
        </div>
        
        <h3 className="success-title">{title}</h3>
        <p className="success-message">{message}</p>
        
        <div className="success-actions">
          {onAddAnother && (
            <button className="btn ghost" onClick={onAddAnother}>
              Add another
            </button>
          )}
          {onViewAll && (
            <button className="btn ghost" onClick={onViewAll}>
              View all sources
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
