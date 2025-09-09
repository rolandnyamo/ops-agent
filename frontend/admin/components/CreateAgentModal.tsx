import React, { useState, useEffect } from 'react';
import { createAgent, inferSettings } from '../lib/api';

interface CreateAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (agentId: string) => void;
}

export default function CreateAgentModal({ isOpen, onClose, onSuccess }: CreateAgentModalProps) {
  const [step, setStep] = useState<'prompt' | 'details'>('prompt');
  const [useCase, setUseCase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|undefined>();
  
  // Form fields for manual entry or AI-generated details
  const [agentName, setAgentName] = useState('');
  const [fallbackMessage, setFallbackMessage] = useState('');
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [notes, setNotes] = useState('');

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
      // Escape to close
      if (e.key === 'Escape') {
        handleClose();
        return;
      }
      
      // Cmd+Enter to submit
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (step === 'prompt' && useCase.trim()) {
          handlePromptSubmit();
        } else if (step === 'details' && agentName.trim() && fallbackMessage.trim()) {
          handleCreateAgent();
        }
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, step, useCase, agentName, fallbackMessage]);

  const resetForm = () => {
    setStep('prompt');
    setUseCase('');
    setAgentName('');
    setFallbackMessage('');
    setConfidenceThreshold(0.5);
    setNotes('');
    setError(undefined);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handlePromptSubmit = async () => {
    if (!useCase.trim()) {
      setError('Please provide a use case description');
      return;
    }

    setLoading(true);
    setError(undefined);

    try {
      const inferred = await inferSettings(useCase);
      setAgentName(inferred.agentName || '');
      setFallbackMessage(inferred.fallbackMessage || '');
      setConfidenceThreshold(inferred.confidenceThreshold || 0.5);
      setNotes(inferred.notes || '');
      setStep('details');
    } catch (e: any) {
      setError('Failed to generate agent details. Please try manual entry.');
    } finally {
      setLoading(false);
    }
  };

  const handleManualEntry = () => {
    setAgentName('');
    setFallbackMessage('');
    setConfidenceThreshold(0.5);
    setNotes('');
    setStep('details');
  };

  const handleCreateAgent = async () => {
    if (!agentName.trim()) {
      setError('Agent name is required');
      return;
    }

    if (!fallbackMessage.trim()) {
      setError('Fallback message is required');
      return;
    }

    setLoading(true);
    setError(undefined);

    try {
      const result = await createAgent(useCase || undefined);
      onSuccess(result.agentId);
      resetForm();
    } catch (e: any) {
      setError('Failed to create agent');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div className="card" style={{
        width: '90%',
        maxWidth: '500px',
        maxHeight: '90vh',
        overflow: 'auto',
        margin: '20px'
      }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            {step === 'prompt' ? 'Create New Agent' : 'Agent Details'}
          </h3>
          <button 
            onClick={handleClose}
            className="btn ghost"
            style={{ 
              padding: '4px 8px',
              fontSize: '18px',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        {error && (
          <div className="chip" style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,.1)', marginBottom: 16 }}>
            {error}
          </div>
        )}

        {step === 'prompt' ? (
          <>
            <p className="muted" style={{ marginBottom: 16 }}>
              Describe what your agent will help with. We'll generate settings for you, or you can enter them manually.
            </p>
            
            <textarea 
              className="textarea" 
              rows={5} 
              placeholder="e.g., A school information assistant helping students and parents with admissions, financial aid, housing, and key deadlines."
              value={useCase} 
              onChange={e => setUseCase(e.target.value)}
              style={{ marginBottom: 16 }}
            />
            
            <div className="muted mini" style={{ marginBottom: 16 }}>
              Press <kbd>⌘ + Enter</kbd> to generate, or <kbd>Escape</kbd> to close
            </div>
            
            <div className="row" style={{ gap: 12 }}>
              <button 
                className="btn" 
                onClick={handlePromptSubmit} 
                disabled={loading || !useCase.trim()}
                style={{ flex: 1 }}
              >
                {loading ? 'Generating...' : 'Generate Details'}
              </button>
              <button 
                className="btn ghost" 
                onClick={handleManualEntry}
                style={{ flex: 1 }}
              >
                Manual Entry
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                Agent Name *
              </label>
              <input 
                className="input" 
                value={agentName} 
                onChange={e => setAgentName(e.target.value)}
                placeholder="My Assistant"
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                Fallback Message *
              </label>
              <textarea 
                className="textarea" 
                rows={3}
                value={fallbackMessage} 
                onChange={e => setFallbackMessage(e.target.value)}
                placeholder="I'm sorry, I don't have enough information to answer that question."
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                Confidence Threshold ({confidenceThreshold})
              </label>
              <input 
                type="range"
                min="0.1"
                max="0.9"
                step="0.1"
                value={confidenceThreshold}
                onChange={e => setConfidenceThreshold(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
              <div className="muted mini">Lower values make the agent respond more often</div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                Notes
              </label>
              <textarea 
                className="textarea" 
                rows={2}
                value={notes} 
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional notes about this agent"
              />
            </div>

            <div className="muted mini" style={{ marginBottom: 16 }}>
              Press <kbd>⌘ + Enter</kbd> to create, or <kbd>Escape</kbd> to close
            </div>

            <div className="row" style={{ gap: 12 }}>
              <button 
                className="btn ghost" 
                onClick={() => setStep('prompt')}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button 
                className="btn" 
                onClick={handleCreateAgent} 
                disabled={loading || !agentName.trim() || !fallbackMessage.trim()}
                style={{ flex: 1 }}
              >
                {loading ? 'Creating...' : 'Create Agent'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
