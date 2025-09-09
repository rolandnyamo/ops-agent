#!/usr/bin/env node
/**
 * Debug script to test vector search functionality
 * Run with: node debug-vectors.js
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

const { S3VectorsClient, QueryVectorsCommand, DescribeIndexCommand } = require('@aws-sdk/client-s3vectors');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const VECTOR_BUCKET = process.env.VECTOR_BUCKET || 'ops-embeddings';
const VECTOR_INDEX = process.env.VECTOR_INDEX || 'docs';

async function testVectorSearch() {
  console.log('🔍 Testing Vector Search Configuration...\n');
  
  console.log('Environment Variables:');
  console.log('- AWS_PROFILE:', process.env.AWS_PROFILE);
  console.log('- VECTOR_BUCKET:', VECTOR_BUCKET);
  console.log('- VECTOR_INDEX:', VECTOR_INDEX);
  console.log('- AWS_REGION:', process.env.AWS_REGION);
  console.log('- VECTOR_MODE:', process.env.VECTOR_MODE);
  console.log('');
  
  if (!VECTOR_BUCKET) {
    console.error('❌ VECTOR_BUCKET not set');
    return;
  }

  // 1. Check S3 bucket contents
  console.log('📁 Checking S3 Bucket Contents...');
  try {
    const s3 = new S3Client({});
    const listResponse = await s3.send(new ListObjectsV2Command({
      Bucket: VECTOR_BUCKET,
      MaxKeys: 20
    }));
    
    console.log(`Found ${listResponse.KeyCount || 0} objects in bucket`);
    if (listResponse.Contents && listResponse.Contents.length > 0) {
      console.log('Sample objects:');
      listResponse.Contents.slice(0, 10).forEach(obj => {
        console.log(`  - ${obj.Key} (${obj.Size} bytes, ${obj.LastModified})`);
      });
    } else {
      console.log('❌ No objects found in S3 bucket - this is likely the problem!');
    }
  } catch (error) {
    console.error('❌ Failed to list S3 bucket:', error.message);
  }
  
  console.log('');

  // 2. Check S3 Vectors index
  console.log('🏗️  Checking S3 Vectors Index...');
  try {
    const client = new S3VectorsClient({});
    const indexResponse = await client.send(new DescribeIndexCommand({
      vectorBucketName: VECTOR_BUCKET,
      indexName: VECTOR_INDEX
    }));
    
    console.log('Index Status:', indexResponse.indexConfiguration?.status);
    console.log('Vector Count:', indexResponse.indexStatistics?.vectorCount);
    console.log('Dimensions:', indexResponse.indexConfiguration?.dimensions);
    console.log('Created:', indexResponse.indexConfiguration?.createdAt);
    
    if (indexResponse.indexStatistics?.vectorCount === 0) {
      console.log('❌ Index exists but has 0 vectors - vectors not indexed yet!');
    }
  } catch (error) {
    console.error('❌ Failed to describe S3 Vectors index:', error.message);
    console.log('This could mean:');
    console.log('1. Index does not exist');
    console.log('2. Wrong bucket/index name');
    console.log('3. Permissions issue');
  }
  
  console.log('');

  // 3. Test a simple vector query
  console.log('🎯 Testing Vector Query...');
  try {
    const client = new S3VectorsClient({});
    
    // Create a dummy vector for testing (same dimensions as text-embedding-3-small)
    const dummyVector = new Array(1536).fill(0.1);
    
    const queryResponse = await client.send(new QueryVectorsCommand({
      vectorBucketName: VECTOR_BUCKET,
      indexName: VECTOR_INDEX,
      queryVector: { float32: dummyVector },
      topK: 5
    }));
    
    console.log(`Query returned ${queryResponse.vectors?.length || 0} results`);
    if (queryResponse.vectors && queryResponse.vectors.length > 0) {
      console.log('Sample results:');
      queryResponse.vectors.slice(0, 3).forEach((vec, i) => {
        console.log(`  ${i + 1}. Score: ${vec.distance}, Metadata keys: ${Object.keys(vec.metadata || {}).join(', ')}`);
      });
    } else {
      console.log('❌ No results from vector query');
    }
  } catch (error) {
    console.error('❌ Vector query failed:', error.message);
  }
  
  console.log('\n🏁 Debug complete!');
  console.log('\nPossible issues to check:');
  console.log('1. Are documents actually uploaded to S3?');
  console.log('2. Has the ingestion process run successfully?');
  console.log('3. Is the S3 Vectors index built and populated?');
  console.log('4. Are the environment variables correct?');
  console.log('5. Do you have the right AWS permissions?');
}

if (require.main === module) {
  testVectorSearch().catch(console.error);
}

module.exports = { testVectorSearch };
