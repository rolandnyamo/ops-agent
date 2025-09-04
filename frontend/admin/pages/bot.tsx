import { useState } from 'react';
import Layout from '../components/Layout';

export default function Bot(){
  const [apiBase] = useState('https://api.example.com/prod');
  const [secret, setSecret] = useState('botsecret_e1b9c2a7c5f24ad6');
  const [ts, setTs] = useState(Math.floor(Date.now()/1000));
  const [body, setBody] = useState('{"q":"What are admission requirements?"}');
  const [sig, setSig] = useState('sha256=<computed>');

  function compute(){
    // Fake compute for mock; in real plugin this is HMAC-SHA256(secret, `${ts}.${body}`)
    const raw = `${ts}.${body}.${secret}`;
    const hashish = Array.from(raw).reduce((a,c)=> (a*33 + c.charCodeAt(0)) % 1_000_000_007, 5381).toString(16);
    const mock = 'sha256=' + (hashish + hashish).slice(0,64);
    setSig(mock);
  }

  return (
    <Layout>
      <div className="grid cols-2">
        <div className="card">
          <h3 className="card-title">Bot Integration</h3>
          <div className="muted">Use HMAC headers to call <code>/qa</code> from any site.</div>
          <label style={{marginTop:10}}>API Base URL</label>
          <input className="input" value={apiBase} readOnly />
          <label style={{marginTop:10}}>Bot Secret</label>
          <input className="input" value={secret} onChange={e=>setSecret(e.target.value)} />

          <div className="row" style={{marginTop:10}}>
            <div style={{flex:1}}>
              <label>Timestamp (sec)</label>
              <input className="input" type="number" value={ts} onChange={e=>setTs(Number(e.target.value))} />
            </div>
          </div>
          <label style={{marginTop:10}}>Body</label>
          <textarea className="textarea" rows={5} value={body} onChange={e=>setBody(e.target.value)} />
          <div className="row" style={{marginTop:12}}>
            <button className="btn" onClick={compute}>Compute Mock Signature</button>
          </div>
          <label style={{marginTop:10}}>X-Bot-Signature</label>
          <input className="input" value={sig} readOnly />
          <div className="muted mini" style={{marginTop:6}}>Real signing uses HMAC SHA-256 of <code>"{`{ts}`}.{'{body}'}`</code> with the Bot Secret.</div>
        </div>

        <div className="card">
          <h3 className="card-title">WordPress Snippet (PHP)</h3>
          <pre className="muted mini" style={{whiteSpace:'pre-wrap'}}>{`
$ts = time();
$body = json_encode([ 'q' => 'What are admission requirements?' ]);
$sig = 'sha256=' . hash_hmac('sha256', $ts . '.' . $body, $secret);

$resp = wp_remote_post($api_base . '/qa', [
  'headers' => [
    'Content-Type' => 'application/json',
    'X-Bot-Timestamp' => strval($ts),
    'X-Bot-Signature' => $sig,
  ],
  'body' => $body,
]);
`}</pre>
        </div>
      </div>
    </Layout>
  );
}
