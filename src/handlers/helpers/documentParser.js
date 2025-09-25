const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { parse } = require('node-html-parser');

const BLOCK_TAGS = new Set([
  'p','h1','h2','h3','h4','h5','h6','blockquote','pre','code','ul','ol','li','table','thead','tbody','tr','td','th','section','article','aside','header','footer','figure','figcaption','div'
]);

function normalizeHtml(html) {
  const trimmed = String(html || '').trim();
  if (!trimmed) {
    return '<html><head><meta charset="utf-8"/></head><body></body></html>';
  }
  const hasHtmlTag = /<html[\s>]/i.test(trimmed);
  if (hasHtmlTag) {
    return trimmed;
  }
  return `<html><head><meta charset="utf-8"/></head><body>${trimmed}</body></html>`;
}

function textToHtml(text) {
  const parts = String(text || '')
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => `<p>${part.replace(/\n/g, '<br/>')}</p>`);
  if (!parts.length) {
    return '<p></p>';
  }
  return parts.join('\n');
}

async function convertBufferToHtml({ buffer, contentType, filename }) {
  const name = String(filename || '').toLowerCase();
  const type = String(contentType || '').toLowerCase();

  if (name.endsWith('.docx') || type.includes('officedocument.wordprocessingml.document')) {
    const result = await mammoth.convertToHtml({ buffer }, { convertImage: mammoth.images.inline(async () => null) });
    return normalizeHtml(result.value || '');
  }

  if (name.endsWith('.pdf') || type.includes('application/pdf')) {
    const parsed = await pdfParse(buffer);
    const htmlBody = textToHtml(parsed.text || '');
    return normalizeHtml(`<body>${htmlBody}</body>`);
  }

  if (name.endsWith('.html') || name.endsWith('.htm') || type.includes('text/html')) {
    return normalizeHtml(buffer.toString('utf8'));
  }

  if (type.startsWith('text/')) {
    const text = buffer.toString('utf8');
    const htmlBody = textToHtml(text);
    return normalizeHtml(`<body>${htmlBody}</body>`);
  }

  throw new Error(`Unsupported content type for translation: ${contentType || 'unknown'}`);
}

function extractBlocks(html) {
  const root = parse(html, { lowerCaseTagName: false, comment: false });
  const body = root.querySelector('body');
  const head = root.querySelector('head');
  const chunks = [];
  let order = 0;

  const walker = body ? body.childNodes : root.childNodes;
  for (const node of walker) {
    if (!node) continue;
    if (node.nodeType === 8) continue; // comment
    if (node.nodeType === 3) {
      const text = String(node.rawText || '').trim();
      if (!text) continue;
      const htmlSnippet = `<p>${text}</p>`;
      chunks.push({
        id: `chunk-${++order}`,
        order,
        sourceHtml: htmlSnippet,
        sourceText: text,
      });
      continue;
    }
    const tagName = String(node.tagName || '').toLowerCase();
    const serialized = node.toString().trim();
    const textContent = String(node.text || '').replace(/\s+/g, ' ').trim();
    if (!serialized) continue;
    if (BLOCK_TAGS.has(tagName) || node.childNodes.length === 0) {
      chunks.push({
        id: `chunk-${++order}`,
        order,
        sourceHtml: serialized,
        sourceText: textContent,
      });
      continue;
    }
    // Fallback: flatten children
    for (const child of node.childNodes) {
      if (!child) continue;
      const childHtml = child.toString().trim();
      if (!childHtml) continue;
      const childText = String(child.text || '').replace(/\s+/g, ' ').trim();
      if (!childText && child.nodeType !== 1) continue;
      chunks.push({
        id: `chunk-${++order}`,
        order,
        sourceHtml: childHtml,
        sourceText: childText,
      });
    }
  }

  if (!chunks.length) {
    const fallbackText = root.textContent.replace(/\s+/g, ' ').trim();
    if (fallbackText) {
      chunks.push({
        id: `chunk-${++order}`,
        order,
        sourceHtml: `<p>${fallbackText}</p>`,
        sourceText: fallbackText,
      });
    }
  }

  return {
    headHtml: head ? head.toString() : '<head><meta charset="utf-8"/></head>',
    bodyHtml: body ? body.innerHTML : root.toString(),
    chunks,
  };
}

async function prepareTranslationDocument({ buffer, contentType, filename }) {
  const html = await convertBufferToHtml({ buffer, contentType, filename });
  const normalized = normalizeHtml(html);
  const { headHtml, bodyHtml, chunks } = extractBlocks(normalized);
  return {
    headHtml,
    bodyHtml,
    chunks,
    fullHtml: `<html>${headHtml}<body>${bodyHtml}</body></html>`
  };
}

function assembleHtmlDocument({ headHtml, chunks, reviewer = false }) {
  const body = chunks
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(chunk => {
      if (reviewer) {
        const finalHtml = chunk.reviewerHtml || chunk.machineHtml || chunk.sourceHtml;
        return finalHtml || '';
      }
      return chunk.machineHtml || chunk.sourceHtml || '';
    })
    .join('\n');
  const head = headHtml || '<head><meta charset="utf-8"/></head>';
  return `<html>${head}<body>${body}</body></html>`;
}

module.exports = {
  prepareTranslationDocument,
  assembleHtmlDocument,
  normalizeHtml,
};
