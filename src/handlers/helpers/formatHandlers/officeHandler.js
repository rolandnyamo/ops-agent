const rtfParser = require('rtf-parser');
const textract = require('textract');
const xml2js = require('xml2js');
const csv = require('csv-parser');
const { promisify } = require('util');
const { Readable } = require('stream');

const textractFromBufferWithType = textract && textract.fromBufferWithType 
  ? promisify(textract.fromBufferWithType.bind(textract))
  : null;

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
      rtfParser.parseRTF(rtfContent, (err, doc) => {
        if (err) {
          reject(new Error(`RTF parsing error: ${err.message}`));
          return;
        }
        
        try {
          // Extract text content from RTF structure
          const text = extractTextFromRTF(doc);
          
          resolve({
            text: text,
            html: null, // RTF structure conversion is complex
            metadata: {
              format: 'rtf',
              hasStructure: true,
              warning: 'RTF format - limited HTML structure preservation'
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
    
    return {
      text: text || '',
      html: null,
      metadata: {
        format: 'odt',
        hasStructure: false,
        warning: 'ODT format - structure preservation limited'
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
          // Convert CSV data to text representation
          const text = results.map(row => Object.values(row).join(' | ')).join('\n');
          
          // Create HTML table representation
          if (results.length > 0) {
            const headers = Object.keys(results[0]);
            const headerRow = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
            const dataRows = results.map(row => 
              `<tr>${headers.map(h => `<td>${row[h] || ''}</td>`).join('')}</tr>`
            ).join('');
            const html = `<table>${headerRow}${dataRows}</table>`;
            
            resolve({
              text: text,
              html: html,
              metadata: {
                format: 'csv',
                hasStructure: true,
                rowCount: results.length,
                columnCount: headers.length
              }
            });
          } else {
            resolve({
              text: '',
              html: '<p>Empty CSV file</p>',
              metadata: { format: 'csv', hasStructure: false }
            });
          }
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
    
    // Extract text content from XML
    const text = extractTextFromXML(result);
    
    return {
      text: text,
      html: null,
      metadata: {
        format: 'xml',
        hasStructure: true,
        rootElement: Object.keys(result)[0] || 'unknown'
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
    
    // Convert JSON to readable text
    const text = JSON.stringify(data, null, 2);
    
    return {
      text: text,
      html: `<pre><code>${text}</code></pre>`,
      metadata: {
        format: 'json',
        hasStructure: true,
        isArray: Array.isArray(data),
        objectCount: Array.isArray(data) ? data.length : Object.keys(data).length
      }
    };
  } catch (error) {
    throw new Error(`JSON parsing error: ${error.message}`);
  }
}

/**
 * Helper function to extract text from RTF structure
 */
function extractTextFromRTF(doc) {
  if (!doc || !doc.content) return '';
  
  const extractText = (content) => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(extractText).join(' ');
    }
    if (content && content.content) {
      return extractText(content.content);
    }
    return '';
  };
  
  return extractText(doc.content).replace(/\s+/g, ' ').trim();
}

/**
 * Helper function to extract text from XML structure
 */
function extractTextFromXML(obj) {
  if (typeof obj === 'string') return obj;
  if (typeof obj !== 'object' || obj === null) return '';
  
  let text = '';
  for (const key in obj) {
    if (key === '_' || key === '$') continue; // Skip attributes
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