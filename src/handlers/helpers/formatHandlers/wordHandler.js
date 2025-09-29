const mammoth = require('mammoth');
const textract = require('textract');
const { promisify } = require('util');
const {
  computeAssetId,
  guessExtension,
  sanitizeFilename,
  createDeterministicId,
  convertEmuToPx
} = require('../assets');

function normaliseAltText(text) {
  return String(text || '').trim();
}

// Safely create promisified version of textract
const textractFromBufferWithType = textract && textract.fromBufferWithType
  ? promisify(textract.fromBufferWithType.bind(textract))
  : null;

/**
 * Handles Microsoft Word documents (both DOC and DOCX formats)
 */
function parseWordDocument(buffer, contentType, filename = 'document') {
  const safeContentType = contentType || '';
  const isDocx = filename.toLowerCase().endsWith('.docx') ||
                 safeContentType.includes('officedocument.wordprocessingml.document');
  const isDoc = filename.toLowerCase().endsWith('.doc') ||
                safeContentType.includes('application/msword');

  if (isDocx) {
    return parseDocx(buffer, filename);
  } else if (isDoc) {
    return parseDoc(buffer, filename);
  } else {
    throw new Error(`Unsupported Word document format: ${safeContentType || 'unknown'}`);
  }
}

/**
 * Parse modern DOCX files using mammoth
 */
async function parseDocx(buffer, _filename) {
  try {
    const imageRegistry = new Map();
    let imageIndex = 0;

    // For translation: preserve HTML structure
    const htmlResult = await mammoth.convertToHtml({ buffer }, {
      convertImage: mammoth.images.inline(async element => {
        try {
          const imageBuffer = await element.read();
          if (!imageBuffer) {return {};}
          const assetId = computeAssetId(imageBuffer);
          const token = createDeterministicId('docx-image', [assetId, imageIndex++]);
          const mime = element.contentType || 'application/octet-stream';
          const ext = guessExtension(mime, 'bin');
          const widthPx = element.size?.width ? convertEmuToPx(element.size.width) : null;
          const heightPx = element.size?.height ? convertEmuToPx(element.size.height) : null;
          const altText = normaliseAltText(element.altText);
          const filenameHint = sanitizeFilename(element.altText || `${token}.${ext}`, ext);

          imageRegistry.set(token, {
            token,
            assetId,
            buffer: imageBuffer,
            bytes: imageBuffer.length,
            mime,
            widthPx: widthPx || null,
            heightPx: heightPx || null,
            altText,
            originalName: filenameHint,
            keepOriginalLanguage: false
          });

          const attributes = {
            src: `cid:${assetId}`,
            'data-asset-token': token,
            'data-asset-id': assetId,
            'data-asset-align': element.alignment || null,
            alt: altText
          };
          if (widthPx) {
            attributes.width = String(widthPx);
          }
          if (heightPx) {
            attributes.height = String(heightPx);
          }
          return attributes;
        } catch (err) {
          console.warn('Failed to capture DOCX image asset', err?.message || err);
          return {};
        }
      }),
      styleMap: [
        'p[style-name=\'Heading 1\'] => h1:fresh',
        'p[style-name=\'Heading 2\'] => h2:fresh',
        'p[style-name=\'Heading 3\'] => h3:fresh',
        'p[style-name=\'Title\'] => h1.title:fresh'
      ]
    });

    // For ingestion: extract plain text
    const textResult = await mammoth.extractRawText({ buffer });

    return {
      text: textResult.value || '',
      html: htmlResult.value || '',
      assets: Array.from(imageRegistry.values()),
      metadata: {
        format: 'docx',
        messages: [...(htmlResult.messages || []), ...(textResult.messages || [])],
        hasStructure: true
      }
    };
  } catch (error) {
    throw new Error(`DOCX parsing error: ${error.message}`);
  }
}

/**
 * Parse legacy DOC files using textract
 */
async function parseDoc(buffer, _filename) {
  if (!textractFromBufferWithType) {
    throw new Error('Legacy DOC format parsing not available. Please convert to DOCX format or install textract dependencies.');
  }

  try {
    const text = await textractFromBufferWithType('application/msword', buffer);

    return {
      text: text || '',
      html: null, // Legacy DOC doesn't preserve structure as well
      metadata: {
        format: 'doc',
        hasStructure: false,
        warning: 'Legacy DOC format - limited structure preservation'
      }
    };
  } catch (error) {
    // Fallback error message for legacy DOC issues
    if (error.message.includes('textract')) {
      throw new Error(`Legacy DOC parsing error: ${error.message}. Please convert to DOCX format for better results.`);
    }
    throw new Error(`DOC parsing error: ${error.message}`);
  }
}

module.exports = { parseWordDocument, parseDocx, parseDoc };
