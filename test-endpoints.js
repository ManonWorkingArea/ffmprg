#!/usr/bin/env node

/**
 * Quick endpoint test for media recording API
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api/media';

async function testEndpoints() {
  console.log('🧪 Testing Media Recording Endpoints');
  console.log('==================================');
  
  // Test 1: Session Init
  console.log('\n1️⃣ Testing /recording/init');
  try {
    const initResponse = await axios.post(`${BASE_URL}/recording/init`, {
      sessionId: null,
      timestamp: new Date().toISOString(),
      dummyMode: true
    }, {
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log('✅ Init endpoint working');
    console.log('Response:', initResponse.data);
    
    const sessionId = initResponse.data.sessionId;
    
    // Test 2: Chunk Upload (Simulated)
    console.log('\n2️⃣ Testing /recording/chunk (simulated)');
    console.log(`URL: ${BASE_URL}/recording/chunk`);
    console.log('Note: This would require FormData with actual file');
    
    // Test 3: Session Finalize
    console.log('\n3️⃣ Testing /recording/finalize');
    try {
      const finalizeResponse = await axios.post(`${BASE_URL}/recording/finalize`, {
        sessionId: sessionId,
        totalChunks: 0,
        totalSize: 0,
        chunks: [],
        dummyMode: true
      }, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log('✅ Finalize endpoint working');
      console.log('Response:', finalizeResponse.data);
      
    } catch (finalizeError) {
      console.log('❌ Finalize endpoint error:', finalizeError.response?.data || finalizeError.message);
    }
    
  } catch (initError) {
    console.log('❌ Init endpoint error:', initError.response?.data || initError.message);
  }
  
  // Test 4: System Status
  console.log('\n4️⃣ Testing /recording/status');
  try {
    const statusResponse = await axios.get(`${BASE_URL}/recording/status`, {
      timeout: 5000
    });
    
    console.log('✅ Status endpoint working');
    console.log('Response:', statusResponse.data);
    
  } catch (statusError) {
    console.log('❌ Status endpoint error:', statusError.response?.data || statusError.message);
  }
  
  console.log('\n🏁 Test completed');
}

// Run tests
if (require.main === module) {
  testEndpoints().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = { testEndpoints };