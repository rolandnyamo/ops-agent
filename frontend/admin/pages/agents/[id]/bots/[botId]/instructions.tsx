import { useEffect, useState } from 'react';
import Layout from '../../../../../components/Layout';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { getBot, Bot } from '../../../../../lib/api';

// For bot testing, we need to use the actual deployed API endpoint
// not the local development server, because bot auth only works on deployed API
const getBotTestApiBase = () => {
  // If we're in production or have a deployed API URL, use it
  // Otherwise, we'll show a message that bot testing requires deployment
  const deployedApiBase = process.env.NEXT_PUBLIC_DEPLOYED_API_BASE;
  if (deployedApiBase) {
    return deployedApiBase;
  }
  
  // For local development, we can't test bot auth properly
  // because the local SAM server doesn't run the bot authorizer
  return null;
};

// Bot Testing Component
function BotTester({ botApiKey }: { botApiKey: string }) {
  const [testMessage, setTestMessage] = useState('');
  const [testResponse, setTestResponse] = useState('');
  const [testing, setTesting] = useState(false);
  const [testHistory, setTestHistory] = useState<Array<{
    question: string, 
    answer: string, 
    timestamp: string,
    confidence?: number,
    grounded?: boolean,
    resultsFound?: number
  }>>([]);

  const botTestApiBase = getBotTestApiBase();

  async function testBot() {
    if (!testMessage.trim()) return;
    
    if (!botTestApiBase) {
      setTestResponse('Bot testing requires a deployed API endpoint. Please deploy your application first or set NEXT_PUBLIC_DEPLOYED_API_BASE environment variable.');
      return;
    }
    
    setTesting(true);
    try {
      const response = await fetch(`${botTestApiBase}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-API-Key': botApiKey
        },
        body: JSON.stringify({
          q: testMessage.trim()
        })
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const answer = data.answer || 'No response received';
      
      setTestResponse(answer);
      setTestHistory(prev => [{
        question: testMessage.trim(),
        answer,
        timestamp: new Date().toLocaleTimeString(),
        confidence: data.confidence || 0,
        grounded: data.grounded || false,
        resultsFound: data.resultsFound || 0
      }, ...prev]);
      
      setTestMessage('');
    } catch (error: any) {
      setTestResponse(`Error: ${error.message}`);
    } finally {
      setTesting(false);
    }
  }

  function handleKeyPress(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      testBot();
    }
  }

  if (!botTestApiBase) {
    return (
      <div style={{ 
        background: '#fef3c7', 
        border: '1px solid #f59e0b', 
        borderRadius: '6px', 
        padding: '16px' 
      }}>
        <p style={{ margin: 0, fontSize: '14px', color: '#92400e' }}>
          <strong>⚠️ Bot testing unavailable</strong><br />
          Bot testing requires the deployed API endpoint because it uses bot authentication. 
          The local development server doesn't support bot auth. Please deploy your application 
          or set the <code>NEXT_PUBLIC_DEPLOYED_API_BASE</code> environment variable to test bot functionality.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold', color: '#374151' }}>
          Test Message:
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask your bot a question..."
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              fontSize: '14px'
            }}
            disabled={testing}
          />
          <button
            onClick={testBot}
            disabled={testing || !testMessage.trim()}
            style={{
              background: testing ? '#9ca3af' : '#0ea5e9',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              fontSize: '14px',
              cursor: testing || !testMessage.trim() ? 'not-allowed' : 'pointer',
              minWidth: '80px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            {testing && (
              <div style={{
                width: '12px',
                height: '12px',
                border: '2px solid transparent',
                borderTop: '2px solid white',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
            )}
            {testing ? 'Testing...' : 'Test'}
          </button>
        </div>
      </div>

      {testHistory.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 'bold', color: '#374151' }}>
            Test Results:
          </h4>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {testHistory.map((test, index) => (
              <div 
                key={index}
                style={{ 
                  marginBottom: '12px',
                  padding: '12px',
                  background: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px'
                }}
              >
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                    {test.timestamp} - Question:
                  </div>
                  <div style={{ fontSize: '14px', color: '#374151', fontWeight: 'bold' }}>
                    {test.question}
                  </div>
                  {(test.confidence !== undefined || test.resultsFound !== undefined) && (
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                      Confidence: {((test.confidence || 0) * 100).toFixed(1)}% | 
                      Results: {test.resultsFound || 0} | 
                      Grounded: {test.grounded ? '✅' : '❌'}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                    Response:
                  </div>
                  <div style={{ fontSize: '14px', color: '#374151', lineHeight: '1.5' }}>
                    {test.answer}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setTestHistory([])}
            style={{
              background: '#6b7280',
              color: 'white',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer',
              marginTop: '8px'
            }}
          >
            Clear History
          </button>
        </div>
      )}
    </div>
  );
}

export default function BotInstructions() {
  const { query } = useRouter();
  const agentId = String(query.id || '');
  const botId = String(query.botId || '');
  const [bot, setBot] = useState<Bot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId || !botId) return;
    loadBot();
  }, [agentId, botId]);

  async function loadBot() {
    try {
      setLoading(true);
      const data = await getBot(agentId, botId);
      setBot(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    // Could add a toast notification here
  }

  if (loading) {
    return (
      <Layout>
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          Loading bot instructions...
        </div>
      </Layout>
    );
  }

  if (error || !bot) {
    return (
      <Layout>
        <div style={{ color: '#dc2626', textAlign: 'center', padding: '40px' }}>
          {error || 'Bot not found'}
        </div>
      </Layout>
    );
  }

  const wordpressShortcode = `[ops_agent_bot api_key="${bot.apiKey}" site_url="${bot.siteUrl}"]`;
  
  const javascriptCode = `<!-- Add this to your website's HTML -->
<div id="ops-agent-chat"></div>
<script>
(function() {
  var script = document.createElement('script');
  script.src = 'https://your-cdn.com/ops-agent-widget.js';
  script.onload = function() {
    OpsAgent.init({
      apiKey: '${bot.apiKey}',
      containerId: 'ops-agent-chat',
      siteUrl: '${bot.siteUrl}',
      theme: '${bot.configuration.theme}',
      position: '${bot.configuration.position}',
      primaryColor: '${bot.configuration.primaryColor}',
      welcomeMessage: '${bot.configuration.welcomeMessage}'
    });
  };
  document.head.appendChild(script);
})();
</script>`;

  return (
    <Layout>
      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
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

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, marginBottom: 8 }}>Integration Instructions</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: '18px' }}>{bot.botName}</h3>
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
          <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
            Follow the instructions below to integrate this bot into your website
          </p>
        </div>

        {/* API Key Section */}
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>🔑 API Key</h3>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            background: '#f9fafb',
            padding: '12px',
            borderRadius: '6px',
            border: '1px solid #e5e7eb',
            marginBottom: '8px'
          }}>
            <code style={{ 
              flex: 1, 
              fontSize: '14px', 
              fontFamily: 'monospace',
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
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              Copy
            </button>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
            Keep this API key secure and don't expose it in client-side code
          </p>
        </div>

        {/* WordPress Integration */}
        {bot.platform === 'wordpress' && (
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>📘 WordPress Integration</h3>
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold' }}>Option 1: Shortcode</h4>
              <div style={{ 
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '12px',
                marginBottom: '8px'
              }}>
                <code style={{ fontSize: '13px', color: '#374151', fontFamily: 'monospace' }}>
                  {wordpressShortcode}
                </code>
              </div>
              <button
                onClick={() => copyToClipboard(wordpressShortcode)}
                style={{
                  background: '#22c55e',
                  color: 'white',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  marginBottom: '12px'
                }}
              >
                Copy Shortcode
              </button>
              <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
                Add this shortcode to any page, post, or widget where you want the chat bot to appear
              </p>
            </div>
          </div>
        )}

        {/* JavaScript Integration */}
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>⚡ JavaScript Integration</h3>
          <div style={{ marginBottom: 16 }}>
            <div style={{ 
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              padding: '12px',
              marginBottom: '8px',
              overflow: 'auto'
            }}>
              <pre style={{ 
                margin: 0, 
                fontSize: '11px', 
                color: '#374151', 
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap'
              }}>
                {javascriptCode}
              </pre>
            </div>
            <button
              onClick={() => copyToClipboard(javascriptCode)}
              style={{
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
                marginBottom: '12px'
              }}
            >
              Copy JavaScript Code
            </button>
            <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
              Add this code to your website's HTML before the closing &lt;/body&gt; tag
            </p>
          </div>
        </div>

        {/* Configuration */}
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>⚙️ Configuration</h3>
          <div style={{ 
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            padding: '16px'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '8px', fontSize: '14px', color: '#374151' }}>
              <strong>Theme:</strong> <span>{bot.configuration.theme}</span>
              <strong>Position:</strong> <span>{bot.configuration.position}</span>
              <strong>Primary Color:</strong> <span>{bot.configuration.primaryColor}</span>
              <strong>Welcome Message:</strong> <span style={{ fontStyle: 'italic' }}>"{bot.configuration.welcomeMessage}"</span>
            </div>
          </div>
        </div>

        {/* Bot Testing */}
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>🧪 Test Bot Authentication & API</h3>
          <div style={{ 
            background: '#f0f9ff',
            border: '1px solid #0ea5e9',
            borderRadius: '6px',
            padding: '16px'
          }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#0369a1' }}>
              Test your bot's API key authentication and response quality using the actual deployed API endpoint.
              This verifies that the bot authentication is working correctly and that responses are accurate.
            </p>
            <BotTester botApiKey={bot.apiKey} />
          </div>
        </div>

        {/* Testing Guidelines */}
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>📋 Testing Guidelines</h3>
          <div style={{ 
            background: '#fffbeb',
            border: '1px solid #fbbf24',
            borderRadius: '6px',
            padding: '16px'
          }}>
            <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold', color: '#92400e' }}>
              Before going live:
            </p>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', color: '#92400e' }}>
              <li>Test the chat bot on a staging environment first</li>
              <li>Verify the API key is working correctly using the tester above</li>
              <li>Check that the bot appears in the correct position</li>
              <li>Test a few sample questions to ensure responses are accurate</li>
            </ul>
          </div>
        </div>

        {/* Support */}
        <div>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>📞 Need Help?</h3>
          <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
            If you encounter any issues during integration, please check that:
          </p>
          <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px', fontSize: '14px', color: '#6b7280' }}>
            <li>The API key is correctly copied (no extra spaces)</li>
            <li>Your website URL matches the registered site URL: <strong>{bot.siteUrl}</strong></li>
            <li>The JavaScript code is placed before the closing &lt;/body&gt; tag</li>
          </ul>
        </div>
      </div>
    </Layout>
  );
}
