const mammoth = require('mammoth');
const textract = require('textract');
const { promisify } = require('util');

// Safely create promisified version of textract
const textractFromBufferWithType = textract && textract.fromBufferWithType 
  ? promisify(textract.fromBufferWithType.bind(textract))
  : null;

/**
 * Handles Microsoft Word documents (both DOC and DOCX formats)
 */
async function parseWordDocument(buffer, contentType, filename = 'document') {
  const isDocx = filename.toLowerCase().endsWith('.docx') || 
                 contentType.includes('officedocument.wordprocessingml.document');
  const isDoc = filename.toLowerCase().endsWith('.doc') || 
                contentType.includes('application/msword');

  if (isDocx) {
    return await parseDocx(buffer, filename);
  } else if (isDoc) {
    return await parseDoc(buffer, filename);
  } else {
    throw new Error(`Unsupported Word document format: ${contentType}`);
  }
}

/**
 * Parse modern DOCX files using mammoth
 */
async function parseDocx(buffer, filename) {
  try {
    // For translation: preserve HTML structure
    const htmlResult = await mammoth.convertToHtml({ buffer }, {
      convertImage: mammoth.images.inline(async () => null), // Remove images for translation
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Title'] => h1.title:fresh"
      ]
    });

    // For ingestion: extract plain text
    const textResult = await mammoth.extractRawText({ buffer });

    return {
      text: textResult.value || '',
      html: htmlResult.value || '',
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
async function parseDoc(buffer, filename) {
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