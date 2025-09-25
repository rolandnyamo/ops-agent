const { parse } = require('node-html-parser');
const { getOpenAIClient } = require('./openai-client');

function stripWrapperTags(html) {
  let trimmed = String(html || '').trim();
  const snippetMatch = trimmed.match(/^<snippet[^>]*>([\s\S]*)<\/snippet>$/i);
  if (snippetMatch) {
    trimmed = snippetMatch[1].trim();
  }
  const bodyMatch = trimmed.match(/^<html[\s\S]*?<body[^>]*>([\s\S]*)<\/body>[\s\S]*<\/html>$/i);
  if (bodyMatch) {
    trimmed = bodyMatch[1].trim();
  }
  return trimmed;
}

class TranslationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'TranslationError';
    if (details) {
      this.details = details;
    }
  }
}

function describeTagPath(html) {
  try {
    const root = parse(`<wrapper>${html}</wrapper>`, { lowerCaseTagName: false });
    const tags = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 1) {
        tags.push(node.tagName);
      }
      if (node.childNodes) {
        for (const child of node.childNodes) {
          walk(child);
        }
      }
    };
    walk(root);
    return tags.join(' > ') || '(text only)';
  } catch {
    return '(unparsed)';
  }
}

function validateStructure(sourceHtml, translatedHtml) {
  try {
    const srcRoot = parse(`<wrapper>${sourceHtml}</wrapper>`, { lowerCaseTagName: false });
    const dstRoot = parse(`<wrapper>${translatedHtml}</wrapper>`, { lowerCaseTagName: false });

    const srcTags = [];
    const dstTags = [];

    const walk = (node, out) => {
      if (!node) return;
      if (node.nodeType === 1) {
        out.push(node.tagName);
      }
      if (node.childNodes) {
        for (const child of node.childNodes) {
          walk(child, out);
        }
      }
    };

    walk(srcRoot, srcTags);
    walk(dstRoot, dstTags);
    if (srcTags.length !== dstTags.length) {
      return false;
    }
    for (let i = 0; i < srcTags.length; i++) {
      if (srcTags[i] !== dstTags[i]) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function translateChunkOpenAI({ html, sourceLanguage, targetLanguage, model, attempt = 0 }) {
  const openai = await getOpenAIClient();
  const tagHint = describeTagPath(html);
  const maxRetries = 1;

  const systemPrompt = `You are a professional translator. Translate the incoming HTML snippet from ${sourceLanguage} to ${targetLanguage}. Preserve ALL HTML tags and attributes exactly as provided. Only translate human readable text content. Return valid HTML for the snippet with identical structure. Do not wrap the response in any extra tags or metadata.`;
  const correctivePrompt = attempt > 0
    ? `IMPORTANT: The snippet uses the following HTML element path: ${tagHint}. The translation must keep the exact same tags and structure. Respond only with the translated snippet content. Do not add wrapper tags such as <snippet> or <html>.`
    : `The snippet may contain inline tags. Keep them intact and respond only with the translated snippet content.`;

  try {
    const resp = await openai.responses.create({
      model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        { role: 'user', content: [{ type: 'input_text', text: `${correctivePrompt}\n\n<snippet>\n${html}\n</snippet>` }] }
      ],
      max_output_tokens: 2048,
      temperature: 0.2
    });

    let out = String(resp.output_text || '').trim();
    out = stripWrapperTags(out);
    if (!out) {
      throw new TranslationError('Empty translation output');
    }
    return out;
  } catch (err) {
    if (err instanceof TranslationError) throw err;
    throw new TranslationError(err.message || 'Translation failed', { cause: err });
  }
}

function createOpenAIEngine() {
  const model = process.env.TRANSLATION_MODEL || 'gpt-4o-mini';
  return {
    name: 'openai',
    model,
    async translate(chunks, { sourceLanguage, targetLanguage }) {
      const results = [];
      for (const chunk of chunks) {
        const translatedHtml = await translateChunkOpenAI({
          html: chunk.sourceHtml,
          sourceLanguage,
          targetLanguage,
          model
        });
        results.push({
          id: chunk.id,
          order: chunk.order,
          translatedHtml,
          provider: 'openai',
          model
        });
      }
      return results;
    }
  };
}

const providers = {
  openai: createOpenAIEngine,
};

async function getTranslationEngine() {
  const providerName = String(process.env.TRANSLATION_PROVIDER || 'openai').toLowerCase();
  const factory = providers[providerName];
  if (!factory) {
    throw new Error(`Unsupported translation provider: ${providerName}`);
  }
  if (!factory.instance) {
    factory.instance = factory();
  }
  return factory.instance;
}

module.exports = {
  getTranslationEngine,
  TranslationError,
};
