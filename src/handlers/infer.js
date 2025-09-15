const { generateText } = require('./helpers/openai');
const { response } = require('./helpers/utils');

function parse(event){
  try { return event && event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : {}; } catch { return {}; }
}

async function openaiResponses(prompt, system){
  const result = await generateText({
    model: 'gpt-4o-mini',
    input: [
      { role: 'system', content: system || 'You return only valid minified JSON.' },
      { role: 'user', content: prompt }
    ],
    format: 'json'
  });

  if (!result.success) {
    console.error('OpenAI error:', result.error);
    throw new Error('OpenAI request failed');
  }

  let data;
  try {
    data = typeof result.text === 'string' ? JSON.parse(result.text) : result.text;
  } catch {
    data = {};
  }
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

exports.handler = async (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    const qs = event?.queryStringParameters || {};
    const mode = (qs.mode || 'settings').toLowerCase();
    const body = parse(event);
    const nowYear = new Date().getFullYear();

    if (mode === 'settings') {
      const useCase = String(body.useCase || '').trim();
      if (!useCase) {
        response.statusCode = 400;
        response.body = JSON.stringify({ message: 'useCase is required' });
        return callback(null, response);
      }
      const data = await openaiResponses(settingsPrompt(useCase, nowYear));
      response.statusCode = 200;
      response.body = JSON.stringify(data);
      return callback(null, response);
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
      response.statusCode = 200;
      response.body = JSON.stringify(data);
      return callback(null, response);
    }

    response.statusCode = 400;
    response.body = JSON.stringify({ message: 'unsupported mode' });
    return callback(null, response);
  } catch (e) {
    console.error('infer error', e);
    response.statusCode = 500;
    response.body = JSON.stringify({ message: 'infer failed' });
    return callback(null, response);
  }
};
