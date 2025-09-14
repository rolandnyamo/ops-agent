import { useEffect, useState } from 'react';
import Layout from '../../../../components/Layout';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { listBots, deleteBot, Bot } from '../../../../lib/api';

export default function AgentBots() {
  const { query } = useRouter();
  const agentId = String(query.id || '');
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;
    loadBots();
  }, [agentId]);

  async function loadBots() {
    try {
      setLoading(true);
      const data = await listBots(agentId);
      setBots(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteBotHandler(botId: string) {
    if (!confirm('Are you sure you want to delete this bot? This cannot be undone.')) {
      return;
    }

    try {
      setDeleting(botId);
      await deleteBot(agentId, botId);
      await loadBots(); // Reload the list
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    // Could add a toast notification here
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString();
  }

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <Link 
          href={`/agents/${agentId}`} 
          className="btn" 
          style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            textDecoration: 'none',
            fontSize: '14px',
            padding: '8px 16px'
          }}
        >
          ← Back to Agent
        </Link>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0 }}>Bots</h2>
            <p style={{ margin: '4px 0 0 0', color: '#6b7280', fontSize: '14px' }}>
              Create and manage bots that can be embedded on external websites
            </p>
          </div>
          <Link 
            href={`/agents/${agentId}/bots/create`} 
            className="btn"
            style={{ fontSize: '14px' }}
          >
            + Create Bot
          </Link>
        </div>

        {error && (
          <div style={{ 
            color: '#dc2626', 
            backgroundColor: '#fef2f2', 
            padding: '12px', 
            borderRadius: '4px', 
            marginBottom: '16px',
            fontSize: '14px'
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
            Loading bots...
          </div>
        ) : bots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <div style={{ color: '#6b7280', marginBottom: '16px' }}>
              No bots created yet
            </div>
            <Link 
              href={`/agents/${agentId}/bots/create`} 
              className="btn"
              style={{ fontSize: '14px' }}
            >
              Create Your First Bot
            </Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '16px' }}>
            {bots.map((bot) => (
              <div 
                key={bot.botId} 
                style={{ 
                  border: '1px solid #e5e7eb', 
                  borderRadius: '8px', 
                  padding: '16px' 
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <h3 style={{ margin: 0, fontSize: '16px' }}>{bot.botName}</h3>
                      <span 
                        style={{ 
                          background: bot.status === 'active' ? '#10b981' : '#6b7280',
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 'bold'
                        }}
                      >
                        {bot.status}
                      </span>
                      <span 
                        style={{ 
                          background: '#3b82f6',
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 'bold'
                        }}
                      >
                        {bot.platform}
                      </span>
                    </div>
                    
                    <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>
                      <strong>Site:</strong> {bot.siteUrl}
                    </div>
                    
                    <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>
                      <strong>Created:</strong> {formatDate(bot.createdAt)} | 
                      <strong> Last Used:</strong> {formatDate(bot.lastUsed)}
                    </div>
                    
                    <div style={{ fontSize: '14px', marginBottom: '12px' }}>
                      <div style={{ color: '#6b7280', marginBottom: '4px' }}>
                        <strong>API Key:</strong>
                      </div>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px',
                        background: '#f9fafb',
                        padding: '8px',
                        borderRadius: '4px',
                        border: '1px solid #e5e7eb'
                      }}>
                        <code style={{ 
                          flex: 1, 
                          fontSize: '12px', 
                          fontFamily: 'monospace',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          color: '#374151'
                        }}>
                          {bot.apiKey}
                        </code>
                        <button
                          onClick={() => copyToClipboard(bot.apiKey)}
                          style={{
                            background: '#007cba',
                            color: 'white',
                            border: 'none',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer'
                          }}
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Link
                      href={`/agents/${agentId}/bots/${bot.botId}/instructions`}
                      className="btn"
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      Instructions
                    </Link>
                    <Link
                      href={`/agents/${agentId}/bots/${bot.botId}/edit`}
                      className="btn ghost"
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => deleteBotHandler(bot.botId)}
                      disabled={deleting === bot.botId}
                      style={{
                        background: 'none',
                        border: '1px solid #dc2626',
                        color: '#dc2626',
                        padding: '6px 12px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: deleting === bot.botId ? 'not-allowed' : 'pointer',
                        opacity: deleting === bot.botId ? 0.6 : 1
                      }}
                    >
                      {deleting === bot.botId ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
