import React, { useState } from 'react';
import { ask } from '../lib/api';

interface AgentChatProps {
  agentId: string;
}

interface ChatMessage {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  grounded: boolean;
  citations: Array<{docId: string; chunk: number; score: number}>;
  timestamp: Date;
}

export default function AgentChat({ agentId }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentQuestion.trim() || loading) return;

    const question = currentQuestion.trim();
    setCurrentQuestion('');
    setLoading(true);
    setError(undefined);

    try {
      const response = await ask(question, agentId);
      
      const newMessage: ChatMessage = {
        id: Date.now().toString(),
        question,
        answer: response.answer,
        confidence: response.confidence,
        grounded: response.grounded,
        citations: response.citations,
        timestamp: new Date()
      };

      setMessages(prev => [newMessage, ...prev]);
    } catch (err: any) {
      setError('Failed to get answer. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  };

  return (
    <div className="card">
      <h3 className="card-title">Ask Questions</h3>
      <p className="muted" style={{ marginBottom: 16, fontSize: '14px' }}>
        Ask questions about your uploaded content. Responses are based only on your sources.
      </p>

      <form onSubmit={handleSubmit} style={{ marginBottom: 24 }}>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <textarea 
              className="textarea"
              rows={2}
              placeholder="What would you like to know about your content?"
              value={currentQuestion}
              onChange={e => setCurrentQuestion(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  handleSubmit(e);
                }
              }}
              disabled={loading}
            />
          </div>
          <button 
            type="submit" 
            className="btn" 
            disabled={!currentQuestion.trim() || loading}
            style={{ minWidth: '80px' }}
          >
            {loading ? '...' : 'Ask'}
          </button>
        </div>
        <div className="muted mini" style={{ marginTop: 4 }}>
          Press <kbd>⌘ + Enter</kbd> to ask
        </div>
      </form>

      {error && (
        <div className="chip" style={{ borderColor: 'var(--danger)', background: 'rgba(220,38,38,.1)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {messages.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
          <div style={{ fontSize: '16px', marginBottom: '8px' }}>No questions asked yet</div>
          <div style={{ fontSize: '14px' }}>Ask a question about your uploaded content to get started</div>
        </div>
      )}

      <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
        {messages.map(message => (
          <div key={message.id} style={{ 
            marginBottom: 24, 
            padding: 16,
            background: 'var(--panel)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--line)'
          }}>
            {/* Question */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ 
                fontSize: '14px', 
                fontWeight: 600, 
                color: 'var(--text)',
                marginBottom: 4 
              }}>
                Question
              </div>
              <div style={{ 
                fontSize: '14px',
                color: 'var(--text)',
                fontStyle: 'italic'
              }}>
                {message.question}
              </div>
            </div>

            {/* Answer */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ 
                fontSize: '14px', 
                fontWeight: 600, 
                color: 'var(--text)',
                marginBottom: 4 
              }}>
                Answer
              </div>
              <div style={{ 
                fontSize: '14px',
                color: 'var(--text)',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap'
              }}>
                {message.answer}
              </div>
            </div>

            {/* Metadata */}
            <div className="row" style={{ 
              justifyContent: 'space-between', 
              alignItems: 'center',
              fontSize: '12px',
              color: 'var(--muted)',
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--line)'
            }}>
              <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                <div className={`chip mini ${message.grounded ? '' : 'ghost'}`} style={{
                  borderColor: message.grounded ? 'var(--success)' : 'var(--warning)',
                  background: message.grounded ? 'rgba(5,150,105,.1)' : 'rgba(217,119,6,.1)'
                }}>
                  {message.grounded ? '✓ Grounded' : '⚠ Below threshold'}
                </div>
                <div>
                  Confidence: {Math.round(message.confidence * 100)}%
                </div>
                {message.citations.length > 0 && (
                  <div>
                    Sources: {message.citations.length}
                  </div>
                )}
              </div>
              <div>
                {formatTime(message.timestamp)}
              </div>
            </div>

            {/* Citations */}
            {message.citations.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: 'var(--muted)',
                  marginBottom: 6 
                }}>
                  Sources:
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {message.citations.map((citation, idx) => (
                    <div key={idx} className="chip mini" style={{ fontSize: '11px' }}>
                      {citation.docId.length > 12 ? citation.docId.slice(0, 12) + '...' : citation.docId}
                      {citation.chunk !== undefined && ` #${citation.chunk}`}
                      <span style={{ marginLeft: 4, opacity: 0.7 }}>
                        ({Math.round(citation.score * 100)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
