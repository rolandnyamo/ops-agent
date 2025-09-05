# OpenAI Helper

A comprehensive helper module for using OpenAI's responses API with structured data parsing and text generation.

## Features

- **Structured Data Parsing**: Use Zod schemas to parse structured responses
- **JSON Generation**: Generate and validate JSON responses
- **Text Generation**: Generate plain text responses
- **Error Handling**: Robust error handling with detailed error information
- **Backward Compatibility**: Legacy support for existing code

## Installation

The helper is already set up in the project. Just import what you need:

```javascript
const { parseStructured, generateJSON, generateText } = require('./helpers/openai');
```

## Usage Examples

### 1. Structured Data Parsing with Zod Schema

```javascript
const { z } = require('zod');
const { parseStructured } = require('./helpers/openai');

const CalendarEvent = z.object({
  name: z.string(),
  date: z.string(),
  participants: z.array(z.string()),
});

const result = await parseStructured({
  model: "gpt-4o-2024-08-06",
  input: [
    { role: "system", content: "Extract the event information." },
    { role: "user", content: "Alice and Bob are going to a science fair on Friday." }
  ],
  schema: CalendarEvent,
  schemaName: "event"
});

if (result.success) {
  console.log('Parsed data:', result.parsed);
  // result.parsed = { name: "Science Fair", date: "Friday", participants: ["Alice", "Bob"] }
} else {
  console.error('Error:', result.error);
}
```

### 2. JSON Generation

```javascript
const { z } = require('zod');
const { generateJSON } = require('./helpers/openai');

const SettingsSchema = z.object({
  agentName: z.string(),
  confidenceThreshold: z.number().min(0).max(1),
  categories: z.array(z.string())
});

const result = await generateJSON({
  model: 'gpt-4o-mini',
  input: [
    { role: 'system', content: 'Generate agent settings based on the use case.' },
    { role: 'user', content: 'Create a customer support chatbot for an e-commerce site' }
  ],
  schema: SettingsSchema,
  schemaName: 'settings'
});

if (result.success) {
  console.log('Generated settings:', result.parsed);
}
```

### 3. Text Generation

```javascript
const { generateText } = require('./helpers/openai');

const result = await generateText({
  model: 'gpt-4o-mini',
  input: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain quantum computing in simple terms' }
  ]
});

if (result.success) {
  console.log('Generated text:', result.text);
}
```

### 4. Text with Response Format

```javascript
const { generateText } = require('./helpers/openai');

// For JSON responses
const result = await generateText({
  model: 'gpt-4o-mini',
  input: [
    { role: 'system', content: 'Return only valid JSON.' },
    { role: 'user', content: 'Generate settings: {"name": "agent", "threshold": 0.5}' }
  ],
  format: 'json'  // This will be converted to proper format for Responses API
});

// For other text formats (markdown, plain text, etc.)
const markdownResult = await generateText({
  model: 'gpt-4o-mini',
  input: [
    { role: 'system', content: 'Convert content to well-formatted markdown.' },
    { role: 'user', content: 'Topic: API Documentation\n\nContent: Our API supports GET and POST requests...' }
  ],
  format: { type: 'text', style: 'markdown' }  // Custom format object
});
```

## API Reference

### parseStructured(options)

Parse structured data using Zod schema validation.

**Parameters:**
- `model` (string): OpenAI model to use (default: 'gpt-4o-2024-08-06')
- `input` (array): Array of message objects with role and content
- `schema` (ZodSchema): Zod schema for parsing
- `schemaName` (string): Name for the schema (default: 'response')
- `additionalParams` (object): Additional parameters for the API

**Returns:**
```javascript
{
  parsed: Object | null,    // Parsed structured data
  raw: string | null,       // Raw response text
  success: boolean,         // Whether the operation succeeded
  error?: string           // Error message if failed
}
```

### generateJSON(options)

Generate JSON response with schema validation.

Same parameters as `parseStructured()`, but optimized for JSON generation.

### generateText(options)

Generate plain text responses.

**Parameters:**
- `model` (string): OpenAI model to use (default: 'gpt-4o-mini')
- `input` (array): Array of message objects
- `format` (string): Text format specification (optional)
- `additionalParams` (object): Additional parameters for the API

**Returns:**
```javascript
{
  text: string | null,      // Generated text
  raw: Object | null,       // Raw API response
  success: boolean,         // Whether the operation succeeded
  error?: string           // Error message if failed
}
```

## Migration from Legacy Code

If you have existing code using the old OpenAI patterns, you can easily migrate:

### Before:
```javascript
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const response = await openai.responses.create({
  model: 'gpt-4o-mini',
  input: [
    { role: 'system', content: 'You return only valid JSON.' },
    { role: 'user', content: prompt }
  ],
  text: { format: zodTextFormat(schema, "event") }
});
```

### After:
```javascript
const { parseStructured } = require('./helpers/openai');

const result = await parseStructured({
  model: 'gpt-4o-mini',
  input: [
    { role: 'system', content: 'You return only valid JSON.' },
    { role: 'user', content: prompt }
  ],
  schema: schema,
  schemaName: "event"
});
```

## Error Handling

All methods return a consistent response format with success/error indication:

```javascript
const result = await generateJSON({ /* options */ });

if (result.success) {
  // Use result.parsed or result.text
  console.log('Success:', result.parsed);
} else {
  // Handle error
  console.error('OpenAI Error:', result.error);
  // Fallback logic here
}
```

## Environment Variables

The helper automatically uses the `OPENAI_API_KEY` environment variable. Make sure it's set:

```bash
export OPENAI_API_KEY=your_api_key_here
```
