#!/usr/bin/env node
/**
 * Test script to debug the ask handler locally
 * Run with: node test-ask.js
 */

// Set AWS profile before requiring any AWS SDKs
process.env.AWS_PROFILE = 'infocast';

// Load environment variables manually
const fs = require('fs');
try {
  const envData = JSON.parse(fs.readFileSync('./sam/local-env.json', 'utf8'));
  if (envData.Parameters) {
    Object.assign(process.env, envData.Parameters);
  }
} catch (error) {
  console.warn('Could not load local-env.json:', error.message);
}

const { handler } = require('./src/handlers/ask');

async function testAskHandler() {
  console.log('🎯 Testing Ask Handler...\n');
  
  const testEvent = {
    body: JSON.stringify({
      q: "What is this documentation about?",
      agentId: "test-agent",  // You can change this or remove it
      debug: true
    })
  };
  
  try {
    console.log('Calling ask handler with test question...');
    const result = await handler(testEvent);
    
    console.log('Status Code:', result.statusCode);
    
    if (result.statusCode === 200) {
      const response = JSON.parse(result.body);
      console.log('\n📝 Response:');
      console.log('Answer:', response.answer);
      console.log('Confidence:', response.confidence);
      console.log('Grounded:', response.grounded);
      console.log('Citations:', response.citations?.length || 0, 'citations');
      
      if (response.debug) {
        console.log('\n🔍 Debug Info:');
        console.log('Timing:', response.debug.timing);
        console.log('Vector Search Results:', response.debug.vectorSearch.resultsCount);
        console.log('Index Info:', response.debug.indexInfo);
        console.log('Environment:', response.debug.environment);
        
        if (response.debug.rawResults?.length > 0) {
          console.log('\nFirst Raw Result:');
          console.log(response.debug.rawResults[0]);
        }
      }
    } else {
      console.error('❌ Error Response:', result.body);
    }
  } catch (error) {
    console.error('❌ Handler failed:', error);
  }
}

if (require.main === module) {
  testAskHandler().catch(console.error);
}

module.exports = { testAskHandler };
