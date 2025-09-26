const { marked } = require('marked');

/**
 * Handles plain text files, markdown, and other text-based formats
 */
async function parseText(buffer, contentType, filename = 'document.txt') {
  try {
    const textContent = buffer.toString('utf8');
    const isMarkdown = filename.toLowerCase().endsWith('.md') || 
                      filename.toLowerCase().endsWith('.markdown') ||
                      contentType.includes('text/markdown');
    
    if (isMarkdown) {
      return await parseMarkdown(textContent, filename);
    } else {
      return await parsePlainText(textContent, filename);
    }
  } catch (error) {
    throw new Error(`Text parsing error: ${error.message}`);
  }
}

/**
 * Parse Markdown files
 */
async function parseMarkdown(content, filename) {
  try {
    // Configure marked for better HTML output
    marked.setOptions({
      breaks: true,
      gfm: true
    });
    
    const html = marked(content);
    
    return {
      text: content,
      html: html,
      metadata: {
        format: 'markdown',
        hasStructure: true,
        lineCount: content.split('\n').length
      }
    };
  } catch (error) {
    throw new Error(`Markdown parsing error: ${error.message}`);
  }
}

/**
 * Parse plain text files
 */
async function parsePlainText(content, filename) {
  // Convert plain text to basic HTML structure
  const paragraphs = content
    .split(/\n\s*\n/) // Split on double line breaks
    .map(para => para.trim())
    .filter(Boolean)
    .map(para => `<p>${para.replace(/\n/g, '<br/>')}</p>`);
  
  const html = paragraphs.length > 0 ? paragraphs.join('\n') : '<p></p>';
  
  return {
    text: content,
    html: html,
    metadata: {
      format: 'text',
      hasStructure: false,
      lineCount: content.split('\n').length,
      charCount: content.length
    }
  };
}

module.exports = { parseText, parseMarkdown, parsePlainText };