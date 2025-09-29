const crypto = require('crypto');
const path = require('path');

function sha256(data) {
  const hash = crypto.createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

function computeAssetId(buffer) {
  const digest = sha256(buffer);
  return `sha256:${digest}`;
}

function guessExtension(mime, fallback = 'bin') {
  if (!mime) return fallback;
  const base = mime.split(';')[0].trim().toLowerCase();
  switch (base) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    case 'image/webp':
      return 'webp';
    case 'image/bmp':
      return 'bmp';
    case 'image/tiff':
      return 'tiff';
    case 'application/pdf':
      return 'pdf';
    default:
      if (base.startsWith('image/')) {
        return base.replace('image/', '');
      }
      return fallback;
  }
}

function sanitizeFilename(name, ext) {
  const safeExt = (ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const baseName = String(name || 'asset')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-_\.]/g, '')
    .replace(/^[\.\-_]+/, '')
    .slice(0, 120) || 'asset';
  const parsed = path.parse(baseName);
  const finalExt = safeExt ? `.${safeExt}` : parsed.ext;
  const stem = parsed.name || 'asset';
  const normalisedStem = stem.replace(/[^a-zA-Z0-9\-_]/g, '') || 'asset';
  if (!finalExt) {
    return normalisedStem;
  }
  if (parsed.ext && parsed.ext.toLowerCase() === finalExt) {
    return `${normalisedStem}${finalExt}`;
  }
  return `${normalisedStem}${finalExt}`;
}

function assetStorageKey(assetId, filename) {
  // Defensive null check to prevent "Cannot read properties of null" errors
  const safeAssetId = assetId === null || assetId === undefined ? '' : String(assetId);
  const hash = safeAssetId.replace(/^sha256:/, '');
  const prefix = hash.slice(0, 2) || '00';
  const safeName = sanitizeFilename(filename || hash || 'asset');
  return `assets/${prefix}/${hash}/${safeName}`;
}

function createDeterministicId(prefix, parts = []) {
  const data = parts.filter(Boolean).map(String).join('|');
  const digest = sha256(data);
  return `${prefix}_${digest.slice(0, 24)}`;
}

function normaliseTextForHash(text) {
  // Defensive null check to prevent "Cannot read properties of null" errors
  const safeText = text === null || text === undefined ? '' : String(text);
  return safeText.replace(/\s+/g, ' ').trim();
}

function computeTextWindowHash(before, after) {
  const left = normaliseTextForHash(before).slice(-120);
  const right = normaliseTextForHash(after).slice(0, 120);
  const digest = sha256(`${left}|${right}`);
  return `sha256:${digest}`;
}

function extractWidthFromStyle(style) {
  if (!style) return null;
  const match = /width\s*:\s*([0-9.]+)(px|pt)?/i.exec(style);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (Number.isNaN(value)) return null;
  if (!match[2] || match[2].toLowerCase() === 'px') {
    return Math.round(value);
  }
  if (match[2].toLowerCase() === 'pt') {
    return Math.round(value * 1.3333);
  }
  return null;
}

function convertEmuToPx(emu) {
  if (!emu || Number.isNaN(Number(emu))) return null;
  const value = Number(emu);
  // 1 EMU = 1/914400 inches. 1 inch = 96px.
  return Math.round((value / 914400) * 96);
}

module.exports = {
  computeAssetId,
  guessExtension,
  sanitizeFilename,
  assetStorageKey,
  createDeterministicId,
  normaliseTextForHash,
  computeTextWindowHash,
  extractWidthFromStyle,
  convertEmuToPx,
};
