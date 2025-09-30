const rtfParser = require('rtf-parser');
const textract = require('textract');
const xml2js = require('xml2js');
const csv = require('csv-parser');
const { promisify } = require('util');
const { Readable } = require('stream');

const textractFromBufferWithType = textract && textract.fromBufferWithType
  ? promisify(textract.fromBufferWithType.bind(textract))
  : null;

const TWIP_TO_PX = 96 / 1440; // Twips to pixels conversion factor

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFontName(name) {
  if (!name) return null;
  const safe = String(name).replace(/[^a-zA-Z0-9 _\-]/g, '').trim();
  if (!safe) return null;
  if (safe.includes(' ')) {
    return `'${safe.replace(/'/g, '')}'`;
  }
  return safe;
}

function colorToCss(color) {
  if (!color || typeof color !== 'object') return null;
  const { red, green, blue } = color;
  if ([red, green, blue].some(component => typeof component !== 'number')) return null;
  return `rgb(${red},${green},${blue})`;
}

function twipToPx(value) {
  if (typeof value !== 'number') return 0;
  return Math.round(value * TWIP_TO_PX * 100) / 100;
}

function plainTextToBasicHtml(content) {
  const safe = String(content || '').trim();
  if (!safe) return '<p></p>';
  const blocks = safe
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`);
  return blocks.length ? blocks.join('') : `<p>${escapeHtml(safe).replace(/\n/g, '<br/>')}</p>`;
}

function renderRtfSpan(span) {
  if (!span || typeof span.value !== 'string') return '';
  const text = escapeHtml(span.value);
  if (!text) return '';

  const style = span.style || {};
  const styles = ['white-space:pre-wrap'];

  if (typeof style.fontSize === 'number' && style.fontSize > 0) {
    const points = style.fontSize / 2; // mammoth reports half-points
    const px = Math.round(points * (96 / 72) * 100) / 100;
    styles.push(`font-size:${px}px`);
    styles.push(`line-height:${px}px`);
  }

  if (style.bold) styles.push('font-weight:600');
  if (style.italic) styles.push('font-style:italic');
  const decorations = [];
  if (style.underline) decorations.push('underline');
  if (style.strikethrough) decorations.push('line-through');
  if (decorations.length) styles.push(`text-decoration:${decorations.join(' ')}`);

  const foreground = colorToCss(style.foreground);
  if (foreground) styles.push(`color:${foreground}`);
  const background = colorToCss(style.background);
  if (background) styles.push(`background-color:${background}`);

  if (style.font) {
    if (typeof style.font === 'string') {
      const font = sanitizeFontName(style.font);
      if (font) styles.push(`font-family:${font}`);
    } else if (style.font && typeof style.font.name === 'string') {
      const font = sanitizeFontName(style.font.name);
      if (font) styles.push(`font-family:${font}`);
    }
  }

  if (style.dir === 'rtl') {
    styles.push('direction:rtl');
  }

  const styleAttr = styles.length ? ` style="${styles.join(';')}"` : '';
  return `<span class="rtf-span"${styleAttr}>${text}</span>`;
}

function renderRtfParagraph(paragraph) {
  if (!paragraph) return '';
  const content = Array.isArray(paragraph.content) ? paragraph.content : [];
  const innerHtml = content.map(renderRtfSpan).join('') || '<br/>';
  const style = paragraph.style || {};
  const styles = [];

  if (style.align && style.align !== 'left') {
    styles.push(`text-align:${style.align}`);
  }
  if (typeof style.firstLineIndent === 'number' && style.firstLineIndent) {
    styles.push(`text-indent:${twipToPx(style.firstLineIndent)}px`);
  }
  if (typeof style.indent === 'number' && style.indent) {
    styles.push(`margin-left:${twipToPx(style.indent)}px`);
  }
  if (style.valign && style.valign !== 'normal') {
    styles.push(`vertical-align:${style.valign}`);
  }

  const styleAttr = styles.length ? ` style="${styles.join(';')}"` : '';
  return `<p class="rtf-paragraph"${styleAttr}>${innerHtml}</p>`;
}

function extractTextFromRtfParagraph(paragraph) {
  if (!paragraph) return '';
  const content = Array.isArray(paragraph.content) ? paragraph.content : [];
  return content
    .map(span => (span && typeof span.value === 'string') ? span.value : '')
    .join('')
    .trim();
}

function renderRtfDocument(doc) {
  if (!doc || !Array.isArray(doc.content)) {
    return { html: '<div class="rtf-document"></div>', text: '', paragraphCount: 0 };
  }

  const paragraphs = [];
  const textBlocks = [];

  for (const node of doc.content) {
    if (node && Array.isArray(node.content)) {
      paragraphs.push(renderRtfParagraph(node));
      const text = extractTextFromRtfParagraph(node);
      if (text) textBlocks.push(text);
    } else if (node && typeof node.value === 'string') {
      const pseudoParagraph = { style: node.style || {}, content: [node] };
      paragraphs.push(renderRtfParagraph(pseudoParagraph));
      if (node.value.trim()) textBlocks.push(node.value.trim());
    }
  }

  const padding = [];
  if (typeof doc.marginTop === 'number' && doc.marginTop) padding.push(`padding-top:${twipToPx(doc.marginTop)}px`);
  if (typeof doc.marginBottom === 'number' && doc.marginBottom) padding.push(`padding-bottom:${twipToPx(doc.marginBottom)}px`);
  if (typeof doc.marginLeft === 'number' && doc.marginLeft) padding.push(`padding-left:${twipToPx(doc.marginLeft)}px`);
  if (typeof doc.marginRight === 'number' && doc.marginRight) padding.push(`padding-right:${twipToPx(doc.marginRight)}px`);
  const styleAttr = padding.length ? ` style="${padding.join(';')}"` : '';

  return {
    html: `<div class="rtf-document" data-paragraph-count="${paragraphs.length}"${styleAttr}>${paragraphs.join('')}</div>`,
    text: textBlocks.join('\n\n'),
    paragraphCount: paragraphs.length
  };
}

/**
 * Handles various office and data formats (RTF, ODT, CSV, XML, JSON)
 */
async function parseOfficeDocument(buffer, contentType, filename = 'document') {
  const ext = filename.toLowerCase().split('.').pop();

  switch (ext) {
    case 'rtf':
      return await parseRTF(buffer, filename);
    case 'odt':
      return await parseODT(buffer, filename);
    case 'csv':
      return await parseCSV(buffer, filename);
    case 'xml':
      return await parseXML(buffer, filename);
    case 'json':
      return await parseJSON(buffer, filename);
    default:
      throw new Error(`Unsupported office document format: ${ext}`);
  }
}

/**
 * Parse RTF (Rich Text Format) files
 */
async function parseRTF(buffer, filename) {
  return new Promise((resolve, reject) => {
    try {
      const rtfContent = buffer.toString('utf8');
      rtfParser.string(rtfContent, (err, doc) => {
        if (err) {
          reject(new Error(`RTF parsing error: ${err.message}`));
          return;
        }
        try {
          const rendered = renderRtfDocument(doc);
          resolve({
            text: rendered.text,
            html: rendered.html,
            metadata: {
              format: 'rtf',
              hasStructure: true,
              paragraphCount: rendered.paragraphCount,
              warnings: rendered.paragraphCount ? [] : ['RTF document contained no paragraph content'],
              originalFilename: filename
            }
          });
        } catch (extractError) {
          reject(new Error(`RTF text extraction error: ${extractError.message}`));
        }
      });
    } catch (error) {
      reject(new Error(`RTF parsing error: ${error.message}`));
    }
  });
}

/**
 * Parse ODT (OpenDocument Text) files using textract
 */
async function parseODT(buffer, filename) {
  if (!textractFromBufferWithType) {
    throw new Error('ODT format parsing not available. Please convert to DOCX format or install textract dependencies.');
  }

  try {
    const text = await textractFromBufferWithType('application/vnd.oasis.opendocument.text', buffer);
    const htmlBody = plainTextToBasicHtml(text || '');
    return {
      text: text || '',
      html: `<div class="odt-document">${htmlBody}</div>`,
      metadata: {
        format: 'odt',
        hasStructure: !!text && text.trim().length > 0,
        warnings: text && text.trim() ? [] : ['ODT document produced no textual content'],
        originalFilename: filename
      }
    };
  } catch (error) {
    throw new Error(`ODT parsing error: ${error.message}`);
  }
}

/**
 * Parse CSV files
 */
async function parseCSV(buffer, filename) {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = Readable.from(buffer.toString('utf8'));

    stream
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => {
        try {
          if (!results.length) {
            resolve({
              text: '',
              html: '<div class="csv-document"><p>Empty CSV file</p></div>',
              metadata: { format: 'csv', hasStructure: false, warnings: ['CSV file had no rows'], rowCount: 0, columnCount: 0, originalFilename: filename }
            });
            return;
          }

          const headers = Object.keys(results[0]);
          const headerRow = `<tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
          const dataRows = results.map(row =>
            `<tr>${headers.map(h => `<td>${escapeHtml(row[h] ?? '')}</td>`).join('')}</tr>`
          ).join('');
          const html = `<div class="csv-document"><table>${headerRow}${dataRows}</table></div>`;

          const text = results.map(row => headers.map(h => row[h] ?? '').join(' | ')).join('\n');

          resolve({
            text,
            html,
            metadata: {
              format: 'csv',
              hasStructure: true,
              rowCount: results.length,
              columnCount: headers.length,
              warnings: [],
              originalFilename: filename
            }
          });
        } catch (error) {
          reject(new Error(`CSV processing error: ${error.message}`));
        }
      })
      .on('error', (error) => {
        reject(new Error(`CSV parsing error: ${error.message}`));
      });
  });
}

/**
 * Parse XML files
 */
async function parseXML(buffer, filename) {
  try {
    const xmlContent = buffer.toString('utf8');
    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
    const result = await parser.parseStringPromise(xmlContent);

    const text = extractTextFromXML(result);
    const pretty = escapeHtml(xmlContent);
    const html = `<div class="xml-document"><pre><code>${pretty}</code></pre></div>`;

    return {
      text,
      html,
      metadata: {
        format: 'xml',
        hasStructure: true,
        rootElement: Object.keys(result)[0] || 'unknown',
        warnings: [],
        originalFilename: filename
      }
    };
  } catch (error) {
    throw new Error(`XML parsing error: ${error.message}`);
  }
}

/**
 * Parse JSON files
 */
async function parseJSON(buffer, filename) {
  try {
    const jsonContent = buffer.toString('utf8');
    const data = JSON.parse(jsonContent);
    const text = JSON.stringify(data, null, 2);
    const html = `<div class="json-document"><pre><code>${escapeHtml(text)}</code></pre></div>`;

    return {
      text,
      html,
      metadata: {
        format: 'json',
        hasStructure: true,
        isArray: Array.isArray(data),
        objectCount: Array.isArray(data) ? data.length : Object.keys(data).length,
        warnings: [],
        originalFilename: filename
      }
    };
  } catch (error) {
    throw new Error(`JSON parsing error: ${error.message}`);
  }
}

function extractTextFromXML(obj) {
  if (typeof obj === 'string') return obj;
  if (typeof obj !== 'object' || obj === null) return '';

  let text = '';
  for (const key of Object.keys(obj)) {
    if (key === '_' || key === '$') continue;
    const value = obj[key];
    if (typeof value === 'string') {
      text += value + ' ';
    } else if (typeof value === 'object') {
      text += extractTextFromXML(value) + ' ';
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

module.exports = {
  parseOfficeDocument,
  parseRTF,
  parseODT,
  parseCSV,
  parseXML,
  parseJSON
};
