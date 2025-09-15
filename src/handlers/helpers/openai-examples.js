const { z } = require('zod');
const { parseStructured, generateJSON, generateText } = require('./openai');

// Example schemas
const CalendarEvent = z.object({
  name: z.string(),
  date: z.string(),
  participants: z.array(z.string())
});

const SentimentAnalysis = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
  keywords: z.array(z.string())
});

const ProductReview = z.object({
  rating: z.number().min(1).max(5),
  summary: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  recommendation: z.boolean()
});

/**
 * Example: Extract calendar event information from text
 */
async function extractCalendarEvent(text) {
  return await parseStructured({
    model: 'gpt-4o-2024-08-06',
    input: [
      { role: 'system', content: 'Extract the event information from the user\'s message.' },
      { role: 'user', content: text }
    ],
    schema: CalendarEvent,
    schemaName: 'event'
  });
}

/**
 * Example: Analyze sentiment of text
 */
async function analyzeSentiment(text) {
  return await generateJSON({
    model: 'gpt-4o-mini',
    input: [
      {
        role: 'system',
        content: 'Analyze the sentiment of the given text. Provide a sentiment classification, confidence score, and key sentiment-bearing words.'
      },
      { role: 'user', content: text }
    ],
    schema: SentimentAnalysis,
    schemaName: 'sentiment_analysis'
  });
}

/**
 * Example: Generate a product review summary
 */
async function summarizeProductReview(reviewText) {
  return await parseStructured({
    model: 'gpt-4o-2024-08-06',
    input: [
      {
        role: 'system',
        content: 'Analyze this product review and extract key information including rating, summary, pros, cons, and whether you\'d recommend it.'
      },
      { role: 'user', content: reviewText }
    ],
    schema: ProductReview,
    schemaName: 'product_review'
  });
}

/**
 * Example: Generate simple text response
 */
async function generateSimpleText(prompt) {
  return await generateText({
    model: 'gpt-4o-mini',
    input: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: prompt }
    ]
  });
}

/**
 * Example: Generate formatted text (e.g., markdown)
 */
async function generateMarkdown(content, topic) {
  return await generateText({
    model: 'gpt-4o-mini',
    input: [
      {
        role: 'system',
        content: 'Convert the given content into well-formatted markdown with appropriate headers, lists, and emphasis.'
      },
      { role: 'user', content: `Topic: ${topic}\n\nContent: ${content}` }
    ],
    format: 'markdown'
  });
}

// Usage examples (uncomment to test):

/*
// Extract calendar event
extractCalendarEvent("Alice and Bob are going to a science fair on Friday.")
  .then(result => {
    if (result.success) {
      console.log('Calendar Event:', result.parsed);
    } else {
      console.error('Error:', result.error);
    }
  });

// Analyze sentiment
analyzeSentiment("I absolutely love this new product! It's amazing and works perfectly.")
  .then(result => {
    if (result.success) {
      console.log('Sentiment Analysis:', result.parsed);
    } else {
      console.error('Error:', result.error);
    }
  });

// Generate simple text
generateSimpleText("Explain quantum computing in simple terms")
  .then(result => {
    if (result.success) {
      console.log('Generated Text:', result.text);
    } else {
      console.error('Error:', result.error);
    }
  });
*/

module.exports = {
  extractCalendarEvent,
  analyzeSentiment,
  summarizeProductReview,
  generateSimpleText,
  generateMarkdown
};
