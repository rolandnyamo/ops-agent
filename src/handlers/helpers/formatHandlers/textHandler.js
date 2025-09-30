const { marked } = require('marked');

/**
 * Handles plain text files, markdown, and other text-based formats
 */
async function parseText(buffer, contentType, filename = 'document.txt') {
  try {
    const textContent = buffer.toString('utf8');
    const safeName = String(filename || '').toLowerCase();
    const safeContentType = String(contentType || '').toLowerCase();
    const isMarkdown = safeName.endsWith('.md') ||
      safeName.endsWith('.markdown') ||
      safeContentType.includes('text/markdown');

    if (isMarkdown) {
      return await parseMarkdown(textContent, filename);
    }
    return await parsePlainText(textContent, filename);
  } catch (error) {
    throw new Error(`Text parsing error: ${error.message}`);
  }
}

/**
 * Parse Markdown files
 */
async function parseMarkdown(content, filename) {
  try {
    marked.setOptions({
      breaks: true,
      gfm: true
    });

    const html = marked(content);

    return {
      text: content,
      html,
      metadata: {
        format: 'markdown',
        hasStructure: true,
        lineCount: content.split('\n').length,
        warnings: [],
        originalFilename: filename
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
  const paragraphs = content
    .split(/\n\s*\n/)
    .map(para => para.trim())
    .filter(Boolean)
    .map(para => `<p>${para.replace(/\n/g, '<br/>')}</p>`);

  const html = paragraphs.length > 0 ? paragraphs.join('\n') : '<p></p>';

  return {
    text: content,
    html,
    metadata: {
      format: 'text',
      hasStructure: false,
      lineCount: content.split('\n').length,
      charCount: content.length,
      warnings: content.trim() ? [] : ['Text document is empty'],
      originalFilename: filename
    }
  };
}

module.exports = { parseText, parseMarkdown, parsePlainText };
