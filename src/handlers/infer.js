const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function parse(event){
  try { return event && event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : {}; } catch { return {}; }
}

async function openaiResponses(prompt, system){
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const body = {
    model: 'gpt-4o-mini',
    input: [{ role: 'system', content: system || 'You return only valid minified JSON.' }, { role: 'user', content: prompt }],
    response_format: { type: 'json_object' }
  };
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`OpenAI Responses ${res.status}`);
  const json = await res.json();
  const content = json?.output_text || json?.output?.[0]?.content || json?.choices?.[0]?.message?.content || '';
  let data; try { data = typeof content === 'string' ? JSON.parse(content) : content; } catch { data = {}; }
  return data;
}

function settingsPrompt(useCase, year){
  return `You configure a documentation-grounded assistant. Given the use case, propose JSON fields:
  agentName (short, neutral), confidenceThreshold (0.3..0.7), fallbackMessage (neutral, friendly, no "AI"), organizationType,
  categories (4-7 concise names), audiences (array, include 'All' if broad), notes (short). Year=${year}.
  Return JSON with keys: agentName, confidenceThreshold, fallbackMessage, organizationType, categories, audiences, notes.
  Use only JSON.` + '\n\nUSE_CASE:\n' + useCase.slice(0, 4000);
}

function docPrompt(filename, sampleText, year, knownCategories){
  return `Given a file and sample text, infer JSON fields: title, category, audience ('All' default), year (default ${year}), version ('v1'), description (1-2 sentences).` +
  (knownCategories?.length ? ` Categories to prefer: ${knownCategories.join(', ')}.` : '') +
  `\nReturn only JSON { title, category, audience, year, version, description }.\nFILENAME: ${filename}\nSAMPLE:\n${String(sampleText||'').slice(0,4000)}`;
}

exports.handler = async (event) => {
  try {
    const qs = event?.queryStringParameters || {};
    const mode = (qs.mode || 'settings').toLowerCase();
    const body = parse(event);
    const nowYear = new Date().getFullYear();

    if (mode === 'settings') {
      const useCase = String(body.useCase || '').trim();
      if (!useCase) return { statusCode: 400, body: JSON.stringify({ message: 'useCase is required' }) };
      const data = await openaiResponses(settingsPrompt(useCase, nowYear));
      return { statusCode: 200, body: JSON.stringify(data) };
    }

    if (mode === 'doc') {
      const filename = String(body.filename || 'document');
      const sampleText = String(body.sampleText || '');
      const categories = Array.isArray(body.categories) ? body.categories : undefined;
      const data = await openaiResponses(docPrompt(filename, sampleText, nowYear, categories));
      // Defaults if missing
      data.year = data.year || nowYear;
      data.version = data.version || 'v1';
      data.audience = data.audience || 'All';
      return { statusCode: 200, body: JSON.stringify(data) };
    }

    return { statusCode: 400, body: JSON.stringify({ message: 'unsupported mode' }) };
  } catch (e) {
    console.error('infer error', e);
    return { statusCode: 500, body: JSON.stringify({ message: 'infer failed' }) };
  }
};

