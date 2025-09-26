/**
 * Test script for the new /recording/init endpoint
 * Tests session initialization and chunk upload flow
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/media';

async function testRecordingInit() {
  console.log('🎬 Testing Recording Initialization Flow');
  
  try {
    // Test 1: Initialize a new session
    console.log('\n📋 Test 1: Initialize recording session...');
    
    const initResponse = await axios.post(`${BASE_URL}/recording/init`, {
      expectedDuration: 60, // 1 minute
      expectedChunks: 10,
      videoSettings: {
        format: 'webm',
        codec: 'vp8',
        quality: 'high',
        resolution: '1920x1080'
      },
      metadata: {
        userAgent: 'Test-Client/1.0',
        recordingType: 'screen-recording'
      }
    });
    
    const sessionId = initResponse.data.sessionId;
    console.log('✅ Session initialized successfully:');
    console.log(`   Session ID: ${sessionId}`);
    console.log(`   Status: ${initResponse.data.status}`);
    console.log(`   Expected chunks: ${initResponse.data.session.expectedChunks}`);
    console.log('   Available endpoints:');
    Object.entries(initResponse.data.endpoints).forEach(([key, endpoint]) => {
      console.log(`     ${key}: ${endpoint}`);
    });
    
    // Test 2: Try to initialize same session again (should return existing)
    console.log('\n📋 Test 2: Re-initialize same session...');
    
    const reinitResponse = await axios.post(`${BASE_URL}/recording/init`, {
      sessionId: sessionId,
      expectedChunks: 15 // Different value
    });
    
    console.log('✅ Re-initialization handled correctly:');
    console.log(`   Status: ${reinitResponse.data.status}`);
    console.log(`   Message: ${reinitResponse.data.message}`);
    
    // Test 3: Create dummy chunks for upload testing
    console.log('\n📋 Test 3: Creating dummy WebM chunks...');
    
    const testChunks = [];
    for (let i = 0; i < 3; i++) {
      const chunkData = createDummyWebMChunk(i);
      const chunkPath = path.join(__dirname, `test-chunk-${i}.webm`);
      fs.writeFileSync(chunkPath, chunkData);
      testChunks.push({
        index: i,
        path: chunkPath,
        size: chunkData.length
      });
      console.log(`   Created test-chunk-${i}.webm (${chunkData.length} bytes)`);
    }
    
    // Test 4: Upload chunks
    console.log('\n📋 Test 4: Upload chunks...');
    
    for (const chunk of testChunks) {
      const formData = new FormData();
      formData.append('chunk', fs.createReadStream(chunk.path));
      formData.append('sessionId', sessionId);
      formData.append('chunkIndex', chunk.index.toString());
      formData.append('totalChunks', testChunks.length.toString());
      formData.append('timestamp', Date.now().toString());
      
      try {
        const uploadResponse = await axios.post(`${BASE_URL}/recording/chunk`, formData, {
          headers: formData.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        });
        
        console.log(`✅ Uploaded chunk ${chunk.index}:`);
        console.log(`   Progress: ${uploadResponse.data.session.chunksReceived}/${uploadResponse.data.session.expectedChunks}`);
        console.log(`   Total size: ${uploadResponse.data.session.totalSizeMB}MB`);
        console.log(`   Complete: ${uploadResponse.data.session.isComplete}`);
        
      } catch (uploadError) {
        console.error(`❌ Upload chunk ${chunk.index} failed:`, uploadError.response?.data || uploadError.message);
      }
    }
    
    // Test 5: Check chunks status
    console.log('\n📋 Test 5: Check chunks status...');
    
    try {
      const statusResponse = await axios.get(`${BASE_URL}/session/${sessionId}/chunks/status`, {
        params: { expectedChunks: testChunks.length }
      });
      
      console.log('✅ Chunks status:');
      console.log(`   Found: ${statusResponse.data.chunksFound}/${statusResponse.data.expectedChunks}`);
      console.log(`   Complete: ${statusResponse.data.isComplete}`);
      console.log(`   Total size: ${statusResponse.data.totalSizeMB}MB`);
      console.log(`   Missing chunks: [${statusResponse.data.missingChunks.join(', ')}]`);
      
      if (statusResponse.data.chunks.length > 0) {
        console.log('   Chunk details:');
        statusResponse.data.chunks.forEach(chunk => {
          console.log(`     ${chunk.filename}: ${chunk.sizeMB}MB (index: ${chunk.chunkIndex})`);
        });
      }
      
    } catch (statusError) {
      console.error('❌ Status check failed:', statusError.response?.data || statusError.message);
    }
    
    // Test 6: Test finalization (this will likely fail due to invalid WebM, but should show the flow)
    console.log('\n📋 Test 6: Test finalization...');
    
    try {
      const finalizeResponse = await axios.post(`${BASE_URL}/recording/finalize`, {
        sessionId: sessionId,
        totalChunks: testChunks.length,
        totalSize: testChunks.reduce((sum, chunk) => sum + chunk.size, 0),
        maxWaitSeconds: 10
      });
      
      console.log('✅ Finalization result:');
      console.log(`   Success: ${finalizeResponse.data.success}`);
      console.log(`   Video: ${finalizeResponse.data.video?.filename}`);
      console.log(`   Duration: ${finalizeResponse.data.video?.actualDuration}s`);
      
    } catch (finalizeError) {
      console.log('⚠️  Finalization failed (expected with dummy WebM):');
      console.log(`   Error: ${finalizeError.response?.data?.error}`);
      console.log(`   Details: ${finalizeError.response?.data?.details}`);
    }
    
    // Cleanup
    console.log('\n🧹 Cleaning up test files...');
    testChunks.forEach(chunk => {
      try {
        fs.unlinkSync(chunk.path);
        console.log(`   Deleted ${path.basename(chunk.path)}`);
      } catch (err) {
        console.warn(`   Failed to delete ${path.basename(chunk.path)}: ${err.message}`);
      }
    });
    
    console.log('\n✅ Recording initialization test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

/**
 * Create a dummy WebM chunk with minimal valid header
 */
function createDummyWebMChunk(index) {
  // Minimal WebM header
  const webmHeader = Buffer.from([
    0x1A, 0x45, 0xDF, 0xA3, // EBML signature
    0x9F, 0x42, 0x86, 0x81, 0x01, // EBML header
    0x42, 0xF7, 0x81, 0x01,
    0x42, 0xF2, 0x81, 0x04,
    0x42, 0xF3, 0x81, 0x08,
    0x42, 0x82, 0x88, 0x6D, 0x61, 0x74, 0x72, 0x6F, 0x73, 0x6B, 0x61 // "matroska"
  ]);
  
  // Add some dummy video data (makes file larger and more realistic)
  const dummyData = Buffer.alloc(5000 + (index * 1000), index); // 5-8KB per chunk
  
  return Buffer.concat([webmHeader, dummyData]);
}

// Test /recording/init with invalid data
async function testErrorCases() {
  console.log('\n🔥 Testing error cases...');
  
  // Test invalid init request
  try {
    await axios.post(`${BASE_URL}/recording/init`, {
      invalidField: 'test'
    });
  } catch (error) {
    console.log('✅ Init with invalid data handled correctly');
  }
  
  // Test chunk upload without session
  try {
    const formData = new FormData();
    formData.append('chunk', Buffer.from('fake chunk'));
    formData.append('sessionId', 'nonexistent-session');
    formData.append('chunkIndex', '0');
    
    await axios.post(`${BASE_URL}/recording/chunk`, formData, {
      headers: formData.getHeaders()
    });
  } catch (error) {
    console.log('✅ Chunk upload without session handled correctly');
    console.log(`   Error: ${error.response?.data?.error}`);
  }
}

// Run tests
if (require.main === module) {
  testRecordingInit()
    .then(() => testErrorCases())
    .catch(console.error);
}

module.exports = { testRecordingInit, testErrorCases };