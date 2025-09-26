#!/usr/bin/env node

/**
 * Session Management Test for Media Recording API
 * Tests session creation, persistence, and recovery
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/media';
const TEST_SESSION_ID = `test_session_${Date.now()}`;

async function testSessionPersistence() {
  console.log('🧪 Testing Session Persistence and Recovery');
  console.log('==========================================');
  
  try {
    // Step 1: Create a session
    console.log('\n1️⃣ Creating session...');
    const initResponse = await axios.post(`${BASE_URL}/recording/init`, {
      sessionId: TEST_SESSION_ID,
      timestamp: new Date().toISOString(),
      dummyMode: true
    }, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log('✅ Session created successfully');
    console.log('Response:', initResponse.data);
    
    const sessionId = initResponse.data.sessionId;
    
    // Step 2: Check if session file exists on disk
    console.log('\n2️⃣ Verifying session file on disk...');
    const sessionPath = path.join(process.cwd(), 'uploads', 'media-recording', 'sessions', sessionId, 'session.json');
    
    try {
      await fs.access(sessionPath);
      const sessionContent = await fs.readFile(sessionPath, 'utf8');
      const sessionData = JSON.parse(sessionContent);
      
      console.log('✅ Session file exists on disk');
      console.log('File path:', sessionPath);
      console.log('Session data keys:', Object.keys(sessionData));
      
    } catch (fileError) {
      console.log('❌ Session file not found on disk:', sessionPath);
      console.log('Error:', fileError.message);
    }
    
    // Step 3: Test chunk upload with existing session
    console.log('\n3️⃣ Testing chunk upload...');
    
    // Create a small test blob
    const testChunk = Buffer.from('test chunk data for testing purposes');
    const FormData = require('form-data');
    const formData = new FormData();
    
    formData.append('chunk', testChunk, {
      filename: 'test_chunk_0000.webm',
      contentType: 'video/webm'
    });
    formData.append('sessionId', sessionId);
    formData.append('chunkIndex', '0');
    formData.append('metadata', JSON.stringify({
      test: true,
      timestamp: new Date().toISOString()
    }));
    
    try {
      const chunkResponse = await axios.post(`${BASE_URL}/recording/chunk`, formData, {
        headers: {
          ...formData.getHeaders()
        },
        timeout: 10000
      });
      
      console.log('✅ Chunk upload successful');
      console.log('Response:', chunkResponse.data);
      
    } catch (chunkError) {
      console.log('❌ Chunk upload failed:', chunkError.response?.data || chunkError.message);
    }
    
    // Step 4: Test session finalization
    console.log('\n4️⃣ Testing session finalization...');
    
    try {
      const finalizeResponse = await axios.post(`${BASE_URL}/recording/finalize`, {
        sessionId: sessionId,
        totalChunks: 1,
        totalSize: testChunk.length,
        chunks: [
          {
            index: 0,
            size: testChunk.length,
            filename: 'test_chunk_0000.webm'
          }
        ],
        dummyMode: true
      }, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log('✅ Session finalization successful');
      console.log('Response:', finalizeResponse.data);
      
    } catch (finalizeError) {
      console.log('❌ Session finalization failed:', finalizeError.response?.data || finalizeError.message);
    }
    
    // Step 5: Test session retrieval
    console.log('\n5️⃣ Testing session retrieval...');
    
    try {
      const sessionResponse = await axios.get(`${BASE_URL}/recording/session/${sessionId}`, {
        timeout: 10000
      });
      
      console.log('✅ Session retrieval successful');
      console.log('Session status:', sessionResponse.data.session.status);
      console.log('Total chunks:', sessionResponse.data.session.totalChunks);
      
    } catch (sessionError) {
      console.log('❌ Session retrieval failed:', sessionError.response?.data || sessionError.message);
    }
    
    console.log('\n🏁 Session persistence test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Test session recovery scenario
async function testSessionRecovery() {
  console.log('\n🔄 Testing Session Recovery Scenario');
  console.log('=====================================');
  
  const recoverySessionId = `recovery_test_${Date.now()}`;
  
  try {
    // Create session first
    console.log('\n1️⃣ Creating session for recovery test...');
    await axios.post(`${BASE_URL}/recording/init`, {
      sessionId: recoverySessionId,
      timestamp: new Date().toISOString(),
      dummyMode: true
    });
    
    console.log('✅ Session created for recovery test');
    
    // Wait a bit, then try to upload chunk (simulating session lost from memory)
    console.log('\n2️⃣ Testing chunk upload with potential session recovery...');
    
    const testChunk = Buffer.from('recovery test chunk data');
    const FormData = require('form-data');
    const formData = new FormData();
    
    formData.append('chunk', testChunk, {
      filename: 'recovery_chunk_0000.webm',
      contentType: 'video/webm'
    });
    formData.append('sessionId', recoverySessionId);
    formData.append('chunkIndex', '0');
    
    const chunkResponse = await axios.post(`${BASE_URL}/recording/chunk`, formData, {
      headers: {
        ...formData.getHeaders()
      },
      timeout: 10000
    });
    
    console.log('✅ Session recovery and chunk upload successful');
    console.log('Response:', chunkResponse.data);
    
  } catch (error) {
    console.error('❌ Recovery test failed:', error.response?.data || error.message);
  }
}

// Run all tests
async function runAllTests() {
  await testSessionPersistence();
  await testSessionRecovery();
}

if (require.main === module) {
  runAllTests().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { testSessionPersistence, testSessionRecovery };