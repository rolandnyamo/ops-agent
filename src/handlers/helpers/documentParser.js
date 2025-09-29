// Import format-specific handlers
const { parsePDF } = require('./formatHandlers/pdfHandler');
const { parseWordDocument } = require('./formatHandlers/wordHandler');
const { parseHTML } = require('./formatHandlers/htmlHandler');
const { parseText } = require('./formatHandlers/textHandler');
const { parseOfficeDocument } = require('./formatHandlers/officeHandler');
const { parse } = require('node-html-parser');
const {
  computeAssetId,
  guessExtension,
  sanitizeFilename,
  createDeterministicId,
  normaliseTextForHash,
  computeTextWindowHash,
  extractWidthFromStyle
} = require('./assets');

const BLOCK_TAGS = new Set([
  'p','h1','h2','h3','h4','h5','h6','blockquote','pre','code','ul','ol','li','table','thead','tbody','tr','td','th','section','article','aside','header','footer','figure','figcaption','div'
]);

const DEFAULT_HEAD = '<head><meta charset="utf-8"/></head>';

function normalizeHtml(html) {
  const trimmed = String(html || '').trim();
  if (!trimmed) {
    return `<html>${DEFAULT_HEAD}<body></body></html>`;
  }
  const hasHtmlTag = /<html[\s>]/i.test(trimmed);
  if (hasHtmlTag) {
    return trimmed;
  }
  return `<html>${DEFAULT_HEAD}<body>${trimmed}</body></html>`;
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

async function convertBufferToHtml({ buffer, contentType, filename }) {
  try {
    const result = await parseDocument({ buffer, contentType, filename });
    let html;
    if (result.html) {
      html = normalizeHtml(result.html);
    } else if (result.text) {
      const htmlBody = textToHtml(result.text);
      html = normalizeHtml(`<body>${htmlBody}</body>`);
    } else {
      throw new Error('No text or HTML content extracted from document');
    }
    return {
      html,
      assets: Array.isArray(result.assets) ? result.assets : [],
      metadata: result.metadata || {},
      text: result.text || ''
    };
  } catch (error) {
    throw new Error(`Document conversion error: ${error.message}`);
  }
}

function decodeDataUri(uri) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(uri || '');
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = !!match[2];
  const data = match[3] || '';
  try {
    const buffer = isBase64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
    return { buffer, mime };
  } catch (err) {
    console.warn('Failed to decode data URI', err?.message || err);
    return null;
  }
}

function inferAlignment(node) {
  if (!node) return null;
  const explicit = node.getAttribute && (node.getAttribute('data-asset-align') || node.getAttribute('align'));
  if (explicit) {
    return String(explicit).toLowerCase();
  }
  const style = node.getAttribute ? node.getAttribute('style') : null;
  if (style) {
    const match = /text-align\s*:\s*(left|right|center|justify)/i.exec(style);
    if (match) return match[1].toLowerCase();
    const floatMatch = /float\s*:\s*(left|right)/i.exec(style);
    if (floatMatch) return floatMatch[1].toLowerCase();
  }
  const parent = node.parentNode;
  if (parent && parent.getAttribute) {
    const parentStyle = parent.getAttribute('style');
    if (parentStyle) {
      const match = /text-align\s*:\s*(left|right|center|justify)/i.exec(parentStyle);
      if (match) return match[1].toLowerCase();
    }
  }
  return null;
}

function numericAttribute(node, attr) {
  if (!node || !node.getAttribute) return null;
  const raw = node.getAttribute(attr);
  if (!raw) return null;
  const value = parseFloat(String(raw));
  if (Number.isNaN(value)) return null;
  return Math.round(value);
}

function normaliseAssetCandidate(candidate = {}, { fallbackToken } = {}) {
  const buffer = candidate.buffer || null;
  const bytes = buffer ? buffer.length : (candidate.bytes || 0);
  const assetId = candidate.assetId || (buffer
    ? computeAssetId(buffer)
    : computeAssetId(Buffer.from(candidate.sourceUrl || candidate.token || fallbackToken || 'asset', 'utf8')));
  const mime = candidate.mime || (candidate.originalName ? undefined : 'application/octet-stream');
  const ext = guessExtension(mime, 'bin');
  const filename = sanitizeFilename(candidate.originalName || `${assetId.replace('sha256:', '').slice(0, 12)}.${ext}`, ext);
  return {
    assetId,
    buffer,
    bytes,
    mime: mime || `application/octet-stream`,
    originalName: filename,
    widthPx: candidate.widthPx || null,
    heightPx: candidate.heightPx || null,
    altText: String(candidate.altText || '').trim(),
    keepOriginalLanguage: Boolean(candidate.keepOriginalLanguage),
    sourceUrl: candidate.sourceUrl || null,
    caption: candidate.caption || null
  };
}

function mergeAssetRecord(existing, next) {
  if (!existing) return next;
  if (!existing.buffer && next.buffer) {
    existing.buffer = next.buffer;
    existing.bytes = next.bytes;
  }
  if ((!existing.mime || existing.mime === 'application/octet-stream') && next.mime) {
    existing.mime = next.mime;
  }
  if (!existing.originalName && next.originalName) {
    existing.originalName = next.originalName;
  }
  if (!existing.altText && next.altText) {
    existing.altText = next.altText;
  }
  if (next.widthPx && !existing.widthPx) {
    existing.widthPx = next.widthPx;
  }
  if (next.heightPx && !existing.heightPx) {
    existing.heightPx = next.heightPx;
  }
  if (next.sourceUrl && !existing.sourceUrl) {
    existing.sourceUrl = next.sourceUrl;
  }
  if (next.caption && !existing.caption) {
    existing.caption = next.caption;
  }
  existing.keepOriginalLanguage = existing.keepOriginalLanguage || next.keepOriginalLanguage;
  return existing;
}

function collectAssetsAndAnchors(root, candidateAssets = []) {
  const assetsByToken = new Map();
  for (const candidate of candidateAssets) {
    if (candidate && candidate.token) {
      assetsByToken.set(candidate.token, candidate);
    }
  }
  const assetsById = new Map();
  const anchors = [];
  const body = root.querySelector('body') || root;
  const images = body.querySelectorAll('img');
  let anchorIndex = 0;

  for (const img of images) {
    const token = img.getAttribute('data-asset-token') || createDeterministicId('asset-token', [img.getAttribute('src') || '', anchorIndex]);
    const candidate = assetsByToken.get(token) || {};
    const src = img.getAttribute('src') || '';
    const widthPx = candidate.widthPx || extractWidthFromStyle(img.getAttribute('style')) || numericAttribute(img, 'width');
    const heightPx = candidate.heightPx || numericAttribute(img, 'height');
    const align = inferAlignment(img);
    const altText = String(img.getAttribute('alt') || candidate.altText || '').trim();

    let assetCandidate = candidate;
    if (!assetCandidate.buffer && !assetCandidate.sourceUrl && src) {
      if (src.startsWith('data:')) {
        const decoded = decodeDataUri(src);
        if (decoded) {
          assetCandidate = { ...assetCandidate, buffer: decoded.buffer, mime: decoded.mime };
        }
      } else {
        assetCandidate = { ...assetCandidate, sourceUrl: assetCandidate.sourceUrl || src };
      }
    }

    const normalisedAsset = normaliseAssetCandidate({
      ...assetCandidate,
      widthPx: widthPx || assetCandidate.widthPx,
      heightPx: heightPx || assetCandidate.heightPx,
      altText,
    }, { fallbackToken: token });

    const storedAsset = mergeAssetRecord(assetsById.get(normalisedAsset.assetId), normalisedAsset);
    assetsById.set(normalisedAsset.assetId, storedAsset);

    const sequence = anchorIndex++;
    const anchorId = createDeterministicId('anchor', [normalisedAsset.assetId, sequence]);
    const anchorNode = parse('<span></span>').firstChild;
    anchorNode.setAttribute('class', 'asset-anchor');
    anchorNode.setAttribute('data-asset', normalisedAsset.assetId);
    anchorNode.setAttribute('data-anchor-id', anchorId);
    if (align) {
      anchorNode.setAttribute('data-align', align);
    }
    if (widthPx) {
      anchorNode.setAttribute('data-width', String(widthPx));
    }
    anchorNode.setAttribute('translate', 'no');
    img.replaceWith(anchorNode);

    anchors.push({
      anchorId,
      assetId: normalisedAsset.assetId,
      style: {
        align: align || null,
        widthPx: widthPx || null
      },
      captionRef: null,
      blockId: null,
      beforeSpanId: null,
      afterSpanId: null,
      textWindowHash: null,
      sequence
    });
  }

  return {
    assets: Array.from(assetsById.values()),
    anchors
  };
}

function updateAnchorContextForChunk(chunk, htmlSnippet, anchorMap) {
  const wrapper = parse(`<wrapper>${htmlSnippet}</wrapper>`, { lowerCaseTagName: false, comment: false });
  const container = wrapper.firstChild || wrapper;
  const anchorIds = [];
  const spanTexts = new Map();
  let spanIndex = 0;
  let lastSpanId = null;
  const pendingAfter = [];

  const registerSpan = (text) => {
    const normalized = normaliseTextForHash(text);
    if (!normalized) return;
    const spanId = createDeterministicId('span', [chunk.id, spanIndex++, normalized]);
    spanTexts.set(spanId, normalized);
    lastSpanId = spanId;
    if (pendingAfter.length) {
      for (const pending of pendingAfter) {
        if (!pending.afterSpanId) {
          pending.afterSpanId = spanId;
        }
      }
      pendingAfter.length = 0;
    }
  };

  const traverse = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      registerSpan(node.rawText || '');
      return;
    }
    if (node.nodeType === 1) {
      if (node.classList && node.classList.contains('asset-anchor')) {
        const anchorId = node.getAttribute('data-anchor-id') || node.getAttribute('data-asset');
        if (anchorId) {
          anchorIds.push(anchorId);
          const anchorRecord = anchorMap.get(anchorId);
          if (anchorRecord) {
            anchorRecord.blockId = chunk.blockId;
            anchorRecord.order = chunk.order;
            anchorRecord.beforeSpanId = anchorRecord.beforeSpanId || lastSpanId || null;
            pendingAfter.push(anchorRecord);
          }
        }
        return;
      }
      for (const child of node.childNodes || []) {
        traverse(child);
      }
    }
  };

  traverse(container);

  if (pendingAfter.length) {
    for (const pending of pendingAfter) {
      if (!pending.afterSpanId) {
        pending.afterSpanId = null;
      }
    }
  }

  for (const anchorId of anchorIds) {
    const anchorRecord = anchorMap.get(anchorId);
    if (!anchorRecord) continue;
    const beforeText = anchorRecord.beforeSpanId ? spanTexts.get(anchorRecord.beforeSpanId) || '' : '';
    const afterText = anchorRecord.afterSpanId ? spanTexts.get(anchorRecord.afterSpanId) || '' : '';
    anchorRecord.textWindowHash = computeTextWindowHash(beforeText, afterText);
  }

  chunk.anchorIds = anchorIds;
  return chunk;
}

function extractBlocksFromDom(root, anchors) {
  const head = root.querySelector('head');
  const body = root.querySelector('body');
  const anchorMap = new Map((anchors || []).map(anchor => [anchor.anchorId, anchor]));
  const chunks = [];
  let order = 0;

  const pushChunk = (serialized, text) => {
    const safeHtml = String(serialized || '').trim();
    if (!safeHtml) return;
    const sourceText = normaliseTextForHash(text || '');
    const chunkOrder = ++order;
    const chunkId = createDeterministicId('chunk', [chunkOrder, safeHtml]);
    const chunk = {
      id: chunkId,
      blockId: chunkId,
      order: chunkOrder,
      sourceHtml: safeHtml,
      sourceText,
      anchorIds: []
    };
    updateAnchorContextForChunk(chunk, safeHtml, anchorMap);
    chunks.push(chunk);
  };

  const walker = body ? body.childNodes : root.childNodes;
  for (const node of walker) {
    if (!node) continue;
    if (node.nodeType === 8) continue;
    if (node.nodeType === 3) {
      const text = String(node.rawText || '').trim();
      if (!text) continue;
      pushChunk(`<p>${text}</p>`, text);
      continue;
    }
    const tagName = String(node.tagName || '').toLowerCase();
    const serialized = node.toString().trim();
    const textContent = String(node.text || '').replace(/\s+/g, ' ').trim();
    if (!serialized) continue;
    if (BLOCK_TAGS.has(tagName) || node.childNodes.length === 0) {
      pushChunk(serialized, textContent);
      continue;
    }
    for (const child of node.childNodes || []) {
      if (!child) continue;
      const childHtml = child.toString().trim();
      if (!childHtml) continue;
      const childText = String(child.text || '').replace(/\s+/g, ' ').trim();
      if (!childText && child.nodeType !== 1 && !childHtml.includes('asset-anchor')) continue;
      pushChunk(childHtml, childText);
    }
  }

  if (!chunks.length) {
    const fallbackText = normaliseTextForHash(root.textContent || '');
    if (fallbackText) {
      pushChunk(`<p>${fallbackText}</p>`, fallbackText);
    }
  }

  return {
    headHtml: head ? head.toString() : DEFAULT_HEAD,
    bodyHtml: body ? body.innerHTML : root.toString(),
    chunks
  };
}

async function prepareTranslationDocument({ buffer, contentType, filename }) {
  const { html, assets: candidateAssets } = await convertBufferToHtml({ buffer, contentType, filename });
  const normalized = normalizeHtml(html);
  const root = parse(normalized, { lowerCaseTagName: false, comment: false });
  const { assets, anchors } = collectAssetsAndAnchors(root, candidateAssets);
  const { headHtml, bodyHtml, chunks } = extractBlocksFromDom(root, anchors);
  return {
    headHtml,
    bodyHtml,
    chunks,
    assets,
    anchors,
    fullHtml: `<html>${headHtml}<body>${bodyHtml}</body></html>`
  };
}

function injectAssetsIntoHtml(bodyHtml, { assets = [], anchors = [], embedAssets = true } = {}) {
  if (!bodyHtml) return '';
  const wrapper = parse(`<wrapper>${bodyHtml}</wrapper>`, { lowerCaseTagName: false, comment: false });
  const container = wrapper.firstChild || wrapper;
  const assetMap = new Map(assets.map(asset => [asset.assetId, asset]));
  const anchorMap = new Map(anchors.map(anchor => [anchor.anchorId, anchor]));
  const anchorNodes = container.querySelectorAll('span.asset-anchor');

  for (const anchorNode of anchorNodes) {
    const assetId = anchorNode.getAttribute('data-asset');
    const anchorId = anchorNode.getAttribute('data-anchor-id');
    const asset = assetMap.get(assetId);
    if (!asset) continue;
    const anchorMeta = anchorMap.get(anchorId);

    let src = asset.sourceUrl || null;
    if (!src && embedAssets && asset.buffer) {
      const mime = asset.mime || 'application/octet-stream';
      src = `data:${mime};base64,${asset.buffer.toString('base64')}`;
    }
    if (!src) {
      // Fallback: leave anchor untouched if we cannot resolve a usable source
      continue;
    }

    const widthPx = anchorMeta?.style?.widthPx || asset.widthPx || null;
    const alignClass = anchorMeta?.style?.align ? ` asset-align-${anchorMeta.style.align}` : '';
    const figureClasses = `asset-figure${alignClass}`.trim();
    const figureAttributes = [`class="${figureClasses}"`, 'translate="no"', `data-asset="${asset.assetId}"`];
    if (widthPx) {
      figureAttributes.push(`style="width:${widthPx}px"`);
    }

    const imgAttributes = [`src="${src.replace(/"/g, '&quot;')}"`, 'translate="no"'];
    const alt = asset.altText ? asset.altText.replace(/"/g, '&quot;') : '';
    imgAttributes.push(`alt="${alt}"`);
    if (widthPx) {
      imgAttributes.push(`style="max-width:${widthPx}px"`);
    }

    let captionHtml = '';
    const captionText = anchorMeta?.captionRef || asset.caption || null;
    if (captionText) {
      captionHtml = `<figcaption>${captionText}</figcaption>`;
    }

    const figureHtml = `<figure ${figureAttributes.join(' ')}><img ${imgAttributes.join(' ')} />${captionHtml}</figure>`;
    const figureNode = parse(figureHtml).firstChild;
    anchorNode.replaceWith(figureNode);
  }

  return (wrapper.firstChild || wrapper).innerHTML;
}

function assembleHtmlDocument({ headHtml, chunks, reviewer = false, assets = [], anchors = [], embedAssets = true }) {
  const body = (chunks || [])
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(chunk => {
      if (reviewer) {
        const finalHtml = chunk.reviewerHtml || chunk.machineHtml || chunk.sourceHtml;
        return finalHtml || '';
      }
      return chunk.machineHtml || chunk.sourceHtml || '';
    })
    .join('\n');
  const renderedBody = injectAssetsIntoHtml(body, { assets, anchors, embedAssets });
  const head = headHtml || DEFAULT_HEAD;
  return `<html>${head}<body>${renderedBody}</body></html>`;
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
  extractBlocks: extractBlocksFromDom,
};
