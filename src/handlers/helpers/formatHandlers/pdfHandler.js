const pdfParse = require('pdf-parse');

const DEFAULT_RENDER_OPTIONS = {
  normalizeWhitespace: false,
  disableCombineTextItems: false
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFontFamily(fontName) {
  if (!fontName) return null;
  const safe = String(fontName).replace(/[^a-zA-Z0-9 _\-]/g, '').trim();
  if (!safe) return null;
  if (safe.includes(' ')) {
    return `'${safe.replace(/'/g, '')}'`;
  }
  return safe;
}

function buildPlainTextHtml(text) {
  const safeText = String(text || '').trim();
  if (!safeText) {
    return '<div class="pdf-document pdf-document--empty"></div>';
  }
  const paragraphs = safeText
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`);
  const body = paragraphs.length ? paragraphs.join('') : `<p>${escapeHtml(safeText).replace(/\n/g, '<br/>')}</p>`;
  return `<div class="pdf-document pdf-document--text-only">${body}</div>`;
}

function createPageRenderer(htmlPages, warnings, renderOverrides = {}) {
  const options = {
    ...DEFAULT_RENDER_OPTIONS,
    ...renderOverrides
  };

  return async function renderPage(pageData) {
    const viewport = pageData.getViewport({ scale: 1 });
    let textContent;
    try {
      textContent = await pageData.getTextContent({
        normalizeWhitespace: options.normalizeWhitespace,
        disableCombineTextItems: options.disableCombineTextItems
      });
    } finally {
      if (typeof pageData.cleanup === 'function') {
        try { pageData.cleanup(); } catch (cleanupErr) {
          // noop: pdf.js can throw if cleanup runs while rendering
        }
      }
    }

    const rendered = renderPageContent(pageData.pageNumber, viewport, textContent, warnings);
    htmlPages.push(rendered.html);
    return rendered.text;
  };
}

function renderPageContent(pageNumber, viewport, textContent, warnings) {
  const items = (textContent && Array.isArray(textContent.items)) ? textContent.items : [];
  const pageWidth = viewport ? Number(viewport.width || 0) : 0;
  const pageHeight = viewport ? Number(viewport.height || 0) : 0;
  const spans = [];
  const textBuffer = [];
  let lastBaseline = null;

  for (const item of items) {
    const str = item && typeof item.str === 'string' ? item.str : '';
    if (!str) continue;
    const transform = Array.isArray(item.transform) && item.transform.length >= 6
      ? item.transform
      : [1, 0, 0, 1, 0, 0];
    const fontHeight = Math.hypot(transform[2], transform[3]) || 0;
    const fontWidth = Math.hypot(transform[0], transform[1]) || fontHeight || 1;
    const left = transform[4] || 0;
    const baseline = transform[5] || 0;
    const top = pageHeight ? pageHeight - baseline : 0;

    const styles = [
      'position:absolute',
      'white-space:pre',
      'transform-origin:0 0'
    ];

    styles.push(`left:${left.toFixed(2)}px`);
    styles.push(`top:${(top - fontHeight).toFixed(2)}px`);

    if (fontHeight) {
      styles.push(`font-size:${fontHeight.toFixed(2)}px`);
      styles.push(`line-height:${fontHeight.toFixed(2)}px`);
    }

    if (fontWidth && fontHeight && Math.abs(fontWidth - fontHeight) > 0.1) {
      const scale = fontWidth / (fontHeight || 1);
      if (Number.isFinite(scale) && scale > 0 && Math.abs(scale - 1) > 0.05) {
        styles.push(`transform:scaleX(${scale.toFixed(4)})`);
      }
    }

    if (item.fontName) {
      const fontFamily = sanitizeFontFamily(item.fontName);
      if (fontFamily) {
        styles.push(`font-family:${fontFamily}`);
      }
    }

    if (typeof item.charSpacing === 'number' && item.charSpacing !== 0) {
      styles.push(`letter-spacing:${item.charSpacing.toFixed(2)}px`);
    }
    if (typeof item.wordSpacing === 'number' && item.wordSpacing !== 0) {
      styles.push(`word-spacing:${item.wordSpacing.toFixed(2)}px`);
    }

    const safeText = escapeHtml(str);
    spans.push(`<span class="pdf-text" style="${styles.join(';')}">${safeText}</span>`);

    if (lastBaseline !== null) {
      const delta = Math.abs(lastBaseline - baseline);
      if (fontHeight && delta > fontHeight * 0.8) {
        textBuffer.push('\n');
      }
    }
    textBuffer.push(str);
    lastBaseline = baseline;
  }

  if (!spans.length) {
    warnings.push(`Page ${pageNumber} contains no extractable text layer.`);
    const placeholder = '<div class="pdf-page__empty muted">No selectable text on this page.</div>';
    return {
      html: `<section class="pdf-page pdf-page--empty" data-page="${pageNumber}" style="position:relative;width:${pageWidth.toFixed(2)}px;height:${pageHeight.toFixed(2)}px;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.12);color:#64748b;text-align:center;">${placeholder}</section>`,
      text: ''
    };
  }

  const html = `<section class="pdf-page" data-page="${pageNumber}" style="position:relative;width:${pageWidth.toFixed(2)}px;height:${pageHeight.toFixed(2)}px;">${spans.join('')}</section>`;
  const text = textBuffer.join('').replace(/\n{3,}/g, '\n\n');
  return { html, text };
}

function shouldRetryPdfParse(error) {
  if (!error || !error.message) return false;
  const message = error.message;
  return message.includes('bad XRef') ||
    message.includes('Invalid PDF') ||
    message.includes('PDF parsing failed');
}

function dedupeWarnings(list) {
  return Array.from(new Set((list || []).filter(Boolean)));
}

async function runPdfParse(buffer, renderOverrides) {
  const htmlPages = [];
  const warnings = [];
  const parsed = await pdfParse(buffer, {
    pagerender: createPageRenderer(htmlPages, warnings, renderOverrides),
    max: 0
  });
  return { parsed, htmlPages, warnings };
}

function buildPdfHtml(htmlPages, textFallback) {
  if (htmlPages.length) {
    return `<div class="pdf-document" data-page-count="${htmlPages.length}">${htmlPages.join('')}</div>`;
  }
  return buildPlainTextHtml(textFallback);
}

async function parsePDF(buffer, filename = 'document.pdf') {
  if (!buffer) {
    throw new Error('Missing PDF buffer');
  }

  let attempt;
  try {
    attempt = await runPdfParse(buffer, DEFAULT_RENDER_OPTIONS);
  } catch (error) {
    if (!shouldRetryPdfParse(error)) {
      throw new Error(`PDF parsing error: ${error.message}`);
    }
    const fallbackAttempt = await runPdfParse(buffer, {
      normalizeWhitespace: true,
      disableCombineTextItems: true
    });
    fallbackAttempt.warnings.push(`Extracted with relaxed parsing due to parse error: ${error.message}`);
    attempt = fallbackAttempt;
  }

  if (!attempt.htmlPages.length && attempt.parsed && attempt.parsed.text) {
    attempt.warnings.push('No positional text extracted; generated HTML from plain text content.');
  }

  const textOutput = attempt.parsed && typeof attempt.parsed.text === 'string'
    ? attempt.parsed.text.trim()
    : '';
  const htmlOutput = buildPdfHtml(attempt.htmlPages, textOutput);

  const metadata = {
    format: 'pdf',
    pages: attempt.parsed?.numpages || 0,
    info: attempt.parsed?.info || {},
    version: attempt.parsed?.version,
    hasStructure: attempt.htmlPages.length > 0,
    warnings: dedupeWarnings(attempt.warnings)
  };

  return {
    text: textOutput,
    html: htmlOutput,
    assets: [],
    metadata
  };
}

module.exports = { parsePDF };
