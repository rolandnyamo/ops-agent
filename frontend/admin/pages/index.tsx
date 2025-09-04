import { useState } from 'react';

export default function Home() {
  const [apiBase, setApiBase] = useState<string>('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [question, setQuestion] = useState('');
  const [log, setLog] = useState('');

  async function call(path: string, body?: any, method = 'POST') {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Ops Agent Admin</h1>
      <label>
        API Base URL:&nbsp;
        <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://xxx.execute-api.us-east-1.amazonaws.com/prod" style={{ width: 480 }} />
      </label>

      <section style={{ marginTop: 24 }}>
        <h2>Ingest Doc</h2>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <br />
        <textarea placeholder="Content (for quick test)" value={content} onChange={(e) => setContent(e.target.value)} rows={6} cols={80} />
        <br />
        <button onClick={async () => {
          const r = await call('/docs/ingest', { title, content });
          setLog(JSON.stringify(r, null, 2));
        }}>Ingest</button>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Ask</h2>
        <input placeholder="Question" value={question} onChange={(e) => setQuestion(e.target.value)} style={{ width: 480 }} />
        <button onClick={async () => {
          const r = await call('/qa', { q: question });
          setLog(JSON.stringify(r, null, 2));
        }} style={{ marginLeft: 12 }}>Ask</button>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Output</h2>
        <pre>{log}</pre>
      </section>
    </main>
  );
}

