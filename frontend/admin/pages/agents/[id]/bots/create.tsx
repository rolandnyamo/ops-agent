import { useState } from 'react';
import Layout from '../../../../components/Layout';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { createBot, CreateBotRequest } from '../../../../lib/api';

export default function CreateBot() {
  const { query, push } = useRouter();
  const agentId = String(query.id || '');
  const [formData, setFormData] = useState({
    botName: '',
    platform: 'wordpress',
    siteUrl: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!formData.botName.trim()) {
      setError('Bot name is required');
      return;
    }
    
    if (!formData.siteUrl.trim()) {
      setError('Site URL is required');
      return;
    }
    
    // Basic URL validation
    try {
      new URL(formData.siteUrl);
    } catch {
      setError('Please enter a valid URL (including http:// or https://)');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      await createBot(agentId, formData);
      
      // Redirect to bots list on success
      await push(`/agents/${agentId}/bots`);
      
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  function handleInputChange(field: string, value: string) {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    // Clear error when user starts typing
    if (error) setError(null);
  }

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <Link 
          href={`/agents/${agentId}/bots`} 
          className="btn" 
          style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            textDecoration: 'none',
            fontSize: '14px',
            padding: '8px 16px'
          }}
        >
          ← Back to Bots
        </Link>
      </div>

      <div className="card" style={{ maxWidth: '600px' }}>
        <h2 style={{ margin: '0 0 16px 0' }}>Create New Bot</h2>
        <p style={{ margin: '0 0 24px 0', color: '#6b7280', fontSize: '14px' }}>
          Create a bot that can be embedded on external websites to provide AI assistance using this agent's knowledge base.
        </p>

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

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '6px', 
              fontWeight: 'bold',
              fontSize: '14px'
            }}>
              Bot Name *
            </label>
            <input
              type="text"
              value={formData.botName}
              onChange={(e) => handleInputChange('botName', e.target.value)}
              placeholder="e.g., Customer Support Bot"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px'
              }}
              disabled={loading}
            />
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
              A descriptive name for your bot that will help you identify it
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '6px', 
              fontWeight: 'bold',
              fontSize: '14px'
            }}>
              Platform *
            </label>
            <select
              value={formData.platform}
              onChange={(e) => handleInputChange('platform', e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px',
                backgroundColor: 'white'
              }}
              disabled={loading}
            >
              <option value="wordpress">WordPress</option>
              <option value="generic">Generic (JavaScript)</option>
            </select>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
              The platform where you'll embed this bot
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '6px', 
              fontWeight: 'bold',
              fontSize: '14px'
            }}>
              Site URL *
            </label>
            <input
              type="url"
              value={formData.siteUrl}
              onChange={(e) => handleInputChange('siteUrl', e.target.value)}
              placeholder="https://www.yoursite.com"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px'
              }}
              disabled={loading}
            />
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
              The website where this bot will be embedded (used for CORS configuration)
            </div>
          </div>

          <div style={{ 
            background: '#f0f9ff', 
            border: '1px solid #0ea5e9', 
            borderRadius: '4px', 
            padding: '12px', 
            marginBottom: '24px' 
          }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '4px' }}>
              📝 Note
            </div>
            <div style={{ fontSize: '13px', color: '#0369a1' }}>
              After creating your bot, you'll receive an API key and integration instructions. 
              The bot will inherit this agent's system prompt, confidence threshold, and other settings.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <Link
              href={`/agents/${agentId}/bots`}
              className="btn ghost"
              style={{ 
                textDecoration: 'none',
                fontSize: '14px',
                padding: '10px 20px'
              }}
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              style={{
                background: loading ? '#9ca3af' : '#007cba',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '4px',
                fontSize: '14px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 'bold'
              }}
            >
              {loading ? 'Creating...' : 'Create Bot'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
