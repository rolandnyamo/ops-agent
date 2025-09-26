const pdfParse = require('pdf-parse');

/**
 * Handles PDF document parsing with robust error handling and fallback strategies
 */
async function parsePDF(buffer, filename = 'document.pdf') {
  try {
    const parsed = await pdfParse(buffer);
    return {
      text: parsed.text || '',
      metadata: {
        pages: parsed.numpages,
        info: parsed.info || {},
        version: parsed.version
      }
    };
  } catch (pdfError) {
    console.warn(`PDF parsing failed for ${filename}: ${pdfError.message}`);
    
    // Handle common PDF parsing errors with fallback strategies
    if (pdfError.message.includes('bad XRef') || 
        pdfError.message.includes('Invalid PDF') ||
        pdfError.message.includes('PDF parsing failed')) {
      
      console.warn(`Attempting alternative PDF extraction for ${filename}`);
      
      // Try with relaxed parsing options
      try {
        const parsed = await pdfParse(buffer, {
          normalizeWhitespace: false,
          disableCombineTextItems: false,
          useWorker: false // Disable worker for problematic PDFs
        });
        
        return {
          text: parsed.text || '',
          metadata: {
            pages: parsed.numpages,
            info: parsed.info || {},
            version: parsed.version,
            warning: 'Extracted with relaxed parsing due to PDF structure issues'
          }
        };
      } catch (secondAttempt) {
        throw new Error(`Unable to extract text from PDF: ${pdfError.message}. Please ensure the PDF is not corrupted or password-protected.`);
      }
    }
    
    // Re-throw other types of errors with context
    throw new Error(`PDF parsing error: ${pdfError.message}`);
  }
}

module.exports = { parsePDF };