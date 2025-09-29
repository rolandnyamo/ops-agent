const { parse } = require('node-html-parser');
const {
  computeAssetId,
  guessExtension,
  sanitizeFilename,
  createDeterministicId
} = require('../assets');

async function fetchRemoteAsset(src) {
  if (!src || typeof fetch !== 'function') return null;
  try {
    const response = await fetch(src);
    if (!response.ok) {
      console.warn('Unable to fetch remote asset', src, response.status);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') || undefined;
    return { buffer, contentType };
  } catch (err) {
    console.warn('Failed to download remote asset', src, err?.message || err);
    return null;
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
    console.warn('Failed to decode data URI asset', err?.message || err);
    return null;
  }
}

/**
 * Handles HTML and HTM files with structure preservation
 */
async function parseHTML(buffer, filename = 'document.html') {
  try {
    const htmlContent = buffer.toString('utf8');

    // Parse HTML to extract text for ingestion
    const root = parse(htmlContent, {
      lowerCaseTagName: false,
      comment: false,
      blockTextElements: {
        script: true,
        noscript: true,
        style: true,
        pre: true
      }
    });

    // Remove script and style elements
    root.querySelectorAll('script, style, noscript').forEach(el => el.remove());

    const assets = [];
    let imageIndex = 0;
    const imgNodes = root.querySelectorAll('img');
    for (const img of imgNodes) {
      const src = img.getAttribute('src');
      if (!src) continue;
      const token = createDeterministicId('html-image', [filename, imageIndex++]);
      img.setAttribute('data-asset-token', token);

      let buffer = null;
      let mime = null;
      let remoteSource = null;
      if (src.startsWith('data:')) {
        const decoded = decodeDataUri(src);
        if (decoded) {
          buffer = decoded.buffer;
          mime = decoded.mime;
        }
      } else if (/^https?:/i.test(src)) {
        const downloaded = await fetchRemoteAsset(src);
        if (downloaded) {
          buffer = downloaded.buffer;
          mime = downloaded.contentType || mime;
        } else {
          remoteSource = src;
        }
      }

      if (!buffer && !remoteSource) {
        // Keep relative references as-is; mark as remote source for later resolution
        remoteSource = src;
      }

      const assetId = buffer ? computeAssetId(buffer) : computeAssetId(Buffer.from(src));
      const ext = guessExtension(mime, 'bin');
      const filenameHint = sanitizeFilename(img.getAttribute('data-filename') || `${token}.${ext}`, ext);
      const altText = String(img.getAttribute('alt') || '').trim();

      assets.push({
        token,
        assetId,
        buffer: buffer || null,
        bytes: buffer ? buffer.length : 0,
        mime: mime || undefined,
        originalName: filenameHint,
        sourceUrl: remoteSource || null,
        altText,
        keepOriginalLanguage: img.getAttribute('translate') === 'no'
      });
    }

    const htmlWithTokens = root.toString();
    const textContent = root.text || '';

    return {
      text: textContent.trim(),
      html: htmlWithTokens,
      assets,
      metadata: {
        format: 'html',
        hasStructure: true,
        title: root.querySelector('title')?.text || '',
        hasImages: root.querySelectorAll('img').length > 0,
        hasLinks: root.querySelectorAll('a').length > 0
      }
    };
  } catch (error) {
    throw new Error(`HTML parsing error: ${error.message}`);
  }
}

module.exports = { parseHTML };