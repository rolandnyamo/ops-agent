const OpenAI = require('openai');
const { zodTextFormat } = require('openai/helpers/zod');

class OpenAIHelper {
  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Parse structured data using OpenAI responses API with Zod schema
   * @param {Object} options - Configuration options
   * @param {string} options.model - The model to use (default: 'gpt-4o-2024-08-06')
   * @param {Array} options.input - Array of message objects with role and content
   * @param {Object} options.schema - Zod schema for parsing
   * @param {string} options.schemaName - Name for the schema (default: 'response')
   * @param {Object} options.additionalParams - Additional parameters to pass to the API
   * @returns {Promise<Object>} Parsed response object
   */
  async parseStructured({ 
    model = 'gpt-4o-2024-08-06', 
    input, 
    schema, 
    schemaName = 'response',
    additionalParams = {} 
  }) {
    if (!input || !Array.isArray(input)) {
      throw new Error('Input must be an array of message objects');
    }
    
    if (!schema) {
      throw new Error('Schema is required for structured parsing');
    }

    try {
      const response = await this.client.responses.parse({
        model,
        input,
        text: {
          format: zodTextFormat(schema, schemaName),
        },
        ...additionalParams
      });

      return {
        parsed: response.output_parsed,
        raw: response.output_text,
        success: true
      };
    } catch (error) {
      console.error('OpenAI structured parsing error:', error);
      return {
        parsed: null,
        raw: null,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate JSON response using OpenAI responses API
   * @param {Object} options - Configuration options
   * @param {string} options.model - The model to use (default: 'gpt-4o-mini')
   * @param {Array} options.input - Array of message objects with role and content
   * @param {Object} options.schema - Zod schema for JSON validation
   * @param {string} options.schemaName - Name for the schema (default: 'json_response')
   * @param {Object} options.additionalParams - Additional parameters to pass to the API
   * @returns {Promise<Object>} JSON response object
   */
  async generateJSON({ 
    model = 'gpt-4o-mini', 
    input, 
    schema, 
    schemaName = 'json_response',
    additionalParams = {} 
  }) {
    return this.parseStructured({
      model,
      input,
      schema,
      schemaName,
      additionalParams
    });
  }

  /**
   * Generate text response using OpenAI responses API
   * @param {Object} options - Configuration options
   * @param {string} options.model - The model to use (default: 'gpt-4o-mini')
   * @param {Array} options.input - Array of message objects with role and content
   * @param {string|Object} options.format - Text format specification (optional)
   * @param {Object} options.additionalParams - Additional parameters to pass to the API
   * @returns {Promise<Object>} Text response object
   */
  async generateText({ 
    model = 'gpt-4o-mini', 
    input, 
    format,
    additionalParams = {} 
  }) {
    if (!input || !Array.isArray(input)) {
      throw new Error('Input must be an array of message objects');
    }

    try {
      const requestBody = {
        model,
        input,
        ...additionalParams
      };

      // Handle text format - convert response_format to text.format for Responses API
      if (format) {
        if (typeof format === 'string') {
          // Convert string formats to proper format objects
          if (format === 'json') {
            requestBody.text = { format: { type: 'json_object' } };
          } else {
            requestBody.text = { format };
          }
        } else {
          requestBody.text = { format };
        }
      } else if (additionalParams.response_format) {
        // Convert legacy response_format to proper text.format
        requestBody.text = { format: additionalParams.response_format };
        // Remove response_format from additionalParams to avoid conflicts
        delete requestBody.response_format;
      }

      const response = await this.client.responses.create(requestBody);

      return {
        text: response.output_text || response.output?.[0]?.content || response.choices?.[0]?.message?.content || '',
        raw: response,
        success: true
      };
    } catch (error) {
      console.error('OpenAI text generation error:', error);
      return {
        text: null,
        raw: null,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Legacy method for backward compatibility - converts old create() calls to new API
   * @param {Object} options - Legacy options object
   * @returns {Promise<Object>} Response object
   */
  async legacyCreate(options) {
    if (options.text?.format && typeof options.text.format === 'object') {
      // This appears to be a structured request with Zod schema
      const schema = options.text.format.schema;
      const schemaName = options.text.format.name || 'response';
      
      return this.parseStructured({
        model: options.model,
        input: options.input,
        schema,
        schemaName,
        additionalParams: {
          ...options,
          text: undefined // Remove text from additional params
        }
      });
    } else {
      // This is a text generation request
      return this.generateText({
        model: options.model,
        input: options.input,
        format: options.text?.format,
        additionalParams: {
          ...options,
          model: undefined,
          input: undefined,
          text: undefined
        }
      });
    }
  }
}

// Create and export a default instance
const defaultHelper = new OpenAIHelper();

module.exports = {
  OpenAIHelper,
  openaiHelper: defaultHelper,
  // Export individual methods for convenience
  parseStructured: defaultHelper.parseStructured.bind(defaultHelper),
  generateJSON: defaultHelper.generateJSON.bind(defaultHelper),
  generateText: defaultHelper.generateText.bind(defaultHelper),
  legacyCreate: defaultHelper.legacyCreate.bind(defaultHelper)
};
