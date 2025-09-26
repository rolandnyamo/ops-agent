// Import format-specific handlers
const { parsePDF } = require('./formatHandlers/pdfHandler');
const { parseWordDocument } = require('./formatHandlers/wordHandler');
const { parseHTML } = require('./formatHandlers/htmlHandler');
const { parseText } = require('./formatHandlers/textHandler');
const { parseOfficeDocument } = require('./formatHandlers/officeHandler');
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

/**
 * Detects document format and routes to appropriate handler
 */
function detectDocumentFormat(contentType, filename) {
  const name = String(filename || '').toLowerCase();
  const type = String(contentType || '').toLowerCase();
  
  // PDF files
  if (name.endsWith('.pdf') || type.includes('application/pdf')) {
    return { format: 'pdf', handler: 'pdf' };
  }
  
  // Microsoft Word documents
  if (name.endsWith('.docx') || type.includes('officedocument.wordprocessingml.document')) {
    return { format: 'docx', handler: 'word' };
  }
  if (name.endsWith('.doc') || type.includes('application/msword')) {
    return { format: 'doc', handler: 'word' };
  }
  
  // HTML files
  if (name.endsWith('.html') || name.endsWith('.htm') || type.includes('text/html')) {
    return { format: 'html', handler: 'html' };
  }
  
  // Text-based files
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown') || 
      type.startsWith('text/') || type.includes('text/markdown')) {
    return { format: 'text', handler: 'text' };
  }
  
  // Office and data files
  if (name.endsWith('.rtf')) {
    return { format: 'rtf', handler: 'office' };
  }
  if (name.endsWith('.odt') || type.includes('opendocument.text')) {
    return { format: 'odt', handler: 'office' };
  }
  if (name.endsWith('.csv') || type.includes('text/csv')) {
    return { format: 'csv', handler: 'office' };
  }
  if (name.endsWith('.xml') || type.includes('application/xml') || type.includes('text/xml')) {
    return { format: 'xml', handler: 'office' };
  }
  if (name.endsWith('.json') || type.includes('application/json')) {
    return { format: 'json', handler: 'office' };
  }
  
  return null;
}

/**
 * Enhanced document parsing with intelligent format detection
 */
async function parseDocument({ buffer, contentType, filename }) {
  const formatInfo = detectDocumentFormat(contentType, filename);
  
  if (!formatInfo) {
    throw new Error(`Unsupported content type for parsing: ${contentType || 'unknown'} (filename: ${filename || 'unknown'})`);
  }
  
  try {
    let result;
    
    switch (formatInfo.handler) {
      case 'pdf':
        result = await parsePDF(buffer, filename);
        break;
      case 'word':
        result = await parseWordDocument(buffer, contentType, filename);
        break;
      case 'html':
        result = await parseHTML(buffer, filename);
        break;
      case 'text':
        result = await parseText(buffer, contentType, filename);
        break;
      case 'office':
        result = await parseOfficeDocument(buffer, contentType, filename);
        break;
      default:
        throw new Error(`No handler found for format: ${formatInfo.format}`);
    }
    
    return result;
  } catch (error) {
    console.error(`Document parsing error for ${filename} (${formatInfo.format}):`, error.message);
    throw error;
  }
}

/**
 * Legacy function for backward compatibility - converts document to HTML
 */
async function convertBufferToHtml({ buffer, contentType, filename }) {
  try {
    const result = await parseDocument({ buffer, contentType, filename });
    
    // If we have HTML content, use it; otherwise convert text to HTML
    if (result.html) {
      return normalizeHtml(result.html);
    } else if (result.text) {
      const htmlBody = textToHtml(result.text);
      return normalizeHtml(`<body>${htmlBody}</body>`);
    } else {
      throw new Error('No text or HTML content extracted from document');
    }
  } catch (error) {
    throw new Error(`Document conversion error: ${error.message}`);
  }
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
  // Main parsing functions
  parseDocument,
  convertBufferToHtml,
  detectDocumentFormat,
  
  // Translation-specific functions
  prepareTranslationDocument,
  assembleHtmlDocument,
  
  // Utility functions
  normalizeHtml,
  textToHtml,
  extractBlocks
};
