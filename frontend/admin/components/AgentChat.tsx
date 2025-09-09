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
  debug?: any; // Debug information from API
}

export default function AgentChat({ agentId }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [debugMode, setDebugMode] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentQuestion.trim() || loading) return;

    const question = currentQuestion.trim();
    setCurrentQuestion('');
    setLoading(true);
    setError(undefined);

    try {
      const response = await ask(question, agentId, undefined, debugMode);
      
      const newMessage: ChatMessage = {
        id: Date.now().toString(),
        question,
        answer: response.answer,
        confidence: response.confidence,
        grounded: response.grounded,
        citations: response.citations,
        timestamp: new Date(),
        debug: response.debug
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

      {/* Debug Toggle */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '14px', cursor: 'pointer' }}>
          <input 
            type="checkbox" 
            checked={debugMode} 
            onChange={(e) => setDebugMode(e.target.checked)}
            style={{ margin: 0 }}
          />
          <span>Debug mode (show detailed search results)</span>
        </label>
      </div>

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
                      {citation.docId && citation.docId.length > 12 ? citation.docId.slice(0, 12) + '...' : (citation.docId || 'Unknown')}
                      {citation.chunk !== undefined && ` #${citation.chunk}`}
                      <span style={{ marginLeft: 4, opacity: 0.7 }}>
                        ({Math.round(citation.score * 100)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Debug Information */}
            {debugMode && message.debug && (
              <DebugPanel debug={message.debug} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DebugPanel({ debug }: { debug: any }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setExpanded(expanded === section ? null : section);
  };

  return (
    <div style={{ 
      marginTop: 16, 
      padding: 12, 
      background: 'var(--bg-secondary)', 
      borderRadius: 'var(--radius)',
      border: '1px solid var(--line)',
      fontSize: '12px'
    }}>
      <div style={{ 
        fontWeight: 600, 
        marginBottom: 12, 
        color: 'var(--text)',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}>
        <span>🔍 Debug Information</span>
        <div className="chip mini" style={{ fontSize: '10px' }}>
          {debug.timing.total}ms total
        </div>
      </div>

      {/* Timing */}
      <div style={{ marginBottom: 12 }}>
        <button 
          onClick={() => toggleSection('timing')}
          style={{ 
            background: 'none', 
            border: 'none', 
            padding: 0, 
            color: 'var(--text)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <span>{expanded === 'timing' ? '▼' : '▶'}</span>
          <span style={{ fontWeight: 500 }}>Performance ({debug.timing.total}ms)</span>
        </button>
        {expanded === 'timing' && (
          <div style={{ marginTop: 8, marginLeft: 16, color: 'var(--muted)' }}>
            <div>• Embedding: {debug.timing.embedding}ms</div>
            <div>• Vector Search: {debug.timing.vectorSearch}ms</div>
            <div>• AI Generation: {debug.timing.aiGeneration}ms</div>
            <div>• Total: {debug.timing.total}ms</div>
          </div>
        )}
      </div>

      {/* Vector Search */}
      <div style={{ marginBottom: 12 }}>
        <button 
          onClick={() => toggleSection('search')}
          style={{ 
            background: 'none', 
            border: 'none', 
            padding: 0, 
            color: 'var(--text)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <span>{expanded === 'search' ? '▼' : '▶'}</span>
          <span style={{ fontWeight: 500 }}>Vector Search ({debug.vectorSearch.resultsCount} results)</span>
        </button>
        {expanded === 'search' && (
          <div style={{ marginTop: 8, marginLeft: 16 }}>
            <div style={{ marginBottom: 8, color: 'var(--muted)' }}>
              <div>• Results found: {debug.vectorSearch.resultsCount}</div>
              <div>• Vector dimensions: {debug.vectorSearch.vectorLength}</div>
              <div>• Applied filter: {debug.vectorSearch.appliedFilter ? JSON.stringify(debug.vectorSearch.appliedFilter) : 'None'}</div>
            </div>
            {debug.rawResults.length > 0 && (
              <div style={{ 
                background: 'var(--panel)', 
                padding: 8, 
                borderRadius: 4, 
                border: '1px solid var(--line)',
                maxHeight: '200px',
                overflowY: 'auto'
              }}>
                {debug.rawResults.map((result: any, idx: number) => (
                  <div key={idx} style={{ 
                    marginBottom: 8, 
                    paddingBottom: 8, 
                    borderBottom: idx < debug.rawResults.length - 1 ? '1px solid var(--line)' : 'none'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 500 }}>{result.title || result.docId}</span>
                      <span style={{ color: 'var(--success)' }}>{Math.round(result.score * 100)}%</span>
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: '11px', marginBottom: 4 }}>
                      Doc: {result.docId} | Chunk: {result.chunkIdx} | Length: {result.fullTextLength} chars
                    </div>
                    <div style={{ color: 'var(--text)', fontSize: '11px', fontFamily: 'monospace' }}>
                      {result.textPreview}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confidence Analysis */}
      <div style={{ marginBottom: 12 }}>
        <button 
          onClick={() => toggleSection('confidence')}
          style={{ 
            background: 'none', 
            border: 'none', 
            padding: 0, 
            color: 'var(--text)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <span>{expanded === 'confidence' ? '▼' : '▶'}</span>
          <span style={{ fontWeight: 500 }}>Confidence Analysis</span>
        </button>
        {expanded === 'confidence' && (
          <div style={{ marginTop: 8, marginLeft: 16, color: 'var(--muted)' }}>
            <div>• Threshold: {Math.round(debug.confidenceAnalysis.threshold * 100)}%</div>
            <div>• Top score: {Math.round(debug.confidenceAnalysis.topScore * 100)}%</div>
            <div>• Is grounded: {debug.confidenceAnalysis.isGrounded ? 'Yes' : 'No'}</div>
            <div>• Results above threshold: {debug.confidenceAnalysis.scoresAboveThreshold}</div>
          </div>
        )}
      </div>

      {/* AI Processing */}
      {debug.aiProcessing && (
        <div>
          <button 
            onClick={() => toggleSection('ai')}
            style={{ 
              background: 'none', 
              border: 'none', 
              padding: 0, 
              color: 'var(--text)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <span>{expanded === 'ai' ? '▼' : '▶'}</span>
            <span style={{ fontWeight: 500 }}>AI Processing</span>
          </button>
          {expanded === 'ai' && (
            <div style={{ marginTop: 8, marginLeft: 16 }}>
              <div style={{ marginBottom: 8, color: 'var(--muted)' }}>
                <div>• Snippets used: {debug.aiProcessing.snippetsUsed}</div>
                <div>• Total input length: {debug.aiProcessing.totalSnippetLength} chars</div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>System Prompt:</div>
                <div style={{ 
                  background: 'var(--panel)', 
                  padding: 8, 
                  borderRadius: 4, 
                  border: '1px solid var(--line)',
                  fontFamily: 'monospace',
                  fontSize: '11px'
                }}>
                  {debug.aiProcessing.systemPrompt}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>User Prompt:</div>
                <div style={{ 
                  background: 'var(--panel)', 
                  padding: 8, 
                  borderRadius: 4, 
                  border: '1px solid var(--line)',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  maxHeight: '150px',
                  overflowY: 'auto'
                }}>
                  {debug.aiProcessing.userPrompt}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
