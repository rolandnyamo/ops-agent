const { parse } = require('node-html-parser');

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
    
    const textContent = root.text || '';
    
    return {
      text: textContent.trim(),
      html: htmlContent,
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