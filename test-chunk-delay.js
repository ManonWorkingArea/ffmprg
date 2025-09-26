/**
 * Test script to simulate chunk upload delays and race conditions
 * This helps test the new waitForChunks and WebM duration fix functionality
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/media';
const SESSION_ID = `test-delay-${Date.now()}`;

async function simulateDelayedChunks() {
  console.log('🎬 Testing Chunk Delay Handling');
  console.log(`📍 Session ID: ${SESSION_ID}`);
  
  // Create test session directory structure
  const sessionsDir = path.resolve(process.cwd(), 'uploads', 'media-recording', 'sessions');
  const sessionDir = path.join(sessionsDir, SESSION_ID);
  const chunksDir = path.join(sessionDir, 'chunks');
  
  await fs.mkdir(chunksDir, { recursive: true });
  console.log(`📁 Created session directory: ${sessionDir}`);
  
  // Simulate chunk creation with delays
  const totalChunks = 10;
  const chunkDelays = [0, 500, 1000, 1500, 3000, 4000, 6000, 8000, 10000, 12000]; // ms
  
  console.log(`\n📦 Simulating ${totalChunks} chunks with various delays...`);
  
  // Create dummy WebM chunks
  const createChunk = async (index, delay) => {
    await new Promise(resolve => setTimeout(resolve, delay));
    
    const chunkPath = path.join(chunksDir, `chunk-${index}.webm`);
    // Create a minimal WebM header + dummy data
    const webmHeader = Buffer.from([
      0x1A, 0x45, 0xDF, 0xA3, // EBML signature
      0x9F, 0x42, 0x86, 0x81, 0x01, // EBML header
      0x42, 0xF7, 0x81, 0x01,
      0x42, 0xF2, 0x81, 0x04,
      0x42, 0xF3, 0x81, 0x08,
      0x42, 0x82, 0x88, 0x6D, 0x61, 0x74, 0x72, 0x6F, 0x73, 0x6B, 0x61
    ]);
    
    // Create chunk with some size variation
    const dummyData = Buffer.alloc(1000 + (index * 500)); // 1KB to 5KB
    const chunkData = Buffer.concat([webmHeader, dummyData]);
    
    await fs.writeFile(chunkPath, chunkData);
    console.log(`✅ Created chunk-${index}.webm (delay: ${delay}ms)`);
  };
  
  // Start creating chunks with delays
  const chunkPromises = chunkDelays.map((delay, index) => 
    createChunk(index, delay)
  );
  
  // Test 1: Immediate finalization (should wait for chunks)
  console.log(`\n🚀 Test 1: Synchronous finalization with waiting...`);
  
  setTimeout(async () => {
    try {
      const response = await axios.post(`${BASE_URL}/recording/finalize`, {
        sessionId: SESSION_ID,
        totalChunks: totalChunks,
        totalSize: totalChunks * 2000,
        maxWaitSeconds: 15
      });
      
      console.log(`✅ Sync finalization result:`, {
        success: response.data.success,
        chunksProcessed: response.data.video?.chunksProcessed,
        expectedDuration: response.data.video?.expectedDuration,
        actualDuration: response.data.video?.actualDuration,
        warnings: response.data.warnings
      });
      
    } catch (error) {
      console.error(`❌ Sync finalization failed:`, error.response?.data || error.message);
    }
  }, 2000); // Start finalization after 2 seconds
  
  // Test 2: Check chunks status periodically
  console.log(`\n🔍 Test 2: Monitoring chunks status...`);
  
  const statusChecker = setInterval(async () => {
    try {
      const response = await axios.get(`${BASE_URL}/session/${SESSION_ID}/chunks/status`, {
        params: { expectedChunks: totalChunks }
      });
      
      const status = response.data;
      console.log(`📊 Chunks status: ${status.chunksFound}/${status.expectedChunks} | Complete: ${status.isComplete} | Missing: [${status.missingChunks.join(', ')}]`);
      
      if (status.isComplete) {
        console.log(`✅ All chunks ready!`);
        clearInterval(statusChecker);
      }
      
    } catch (error) {
      // Ignore 404 errors (session not ready yet)
      if (error.response?.status !== 404) {
        console.warn(`⚠️  Status check error:`, error.response?.data?.error || error.message);
      }
    }
  }, 2000);
  
  // Test 3: Async finalization
  setTimeout(async () => {
    console.log(`\n🎯 Test 3: Asynchronous finalization...`);
    
    try {
      const response = await axios.post(`${BASE_URL}/recording/finalize-async`, {
        sessionId: SESSION_ID + '-async',
        totalChunks: 5,
        totalSize: 10000
      });
      
      const jobId = response.data.jobId;
      console.log(`✅ Async job started: ${jobId}`);
      
      // Check job status
      const checkJobStatus = setInterval(async () => {
        try {
          const jobResponse = await axios.get(`${BASE_URL}/recording/job/${jobId}`);
          const jobStatus = jobResponse.data;
          
          console.log(`📋 Job ${jobId} status: ${jobStatus.status}`);
          
          if (jobStatus.status === 'completed') {
            console.log(`✅ Async job completed successfully!`);
            clearInterval(checkJobStatus);
          } else if (jobStatus.status === 'failed') {
            console.log(`❌ Async job failed: ${jobStatus.error}`);
            clearInterval(checkJobStatus);
          }
          
        } catch (error) {
          console.warn(`⚠️  Job status check error:`, error.response?.data?.error || error.message);
        }
      }, 3000);
      
      // Stop checking after 30 seconds
      setTimeout(() => clearInterval(checkJobStatus), 30000);
      
    } catch (error) {
      console.error(`❌ Async finalization failed:`, error.response?.data || error.message);
    }
  }, 5000);
  
  // Wait for all chunks to be created
  await Promise.all(chunkPromises);
  console.log(`\n✅ All ${totalChunks} chunks created successfully!`);
  
  // Clean up after tests
  setTimeout(async () => {
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
      console.log(`\n🗑️  Cleaned up test session: ${sessionDir}`);
      clearInterval(statusChecker);
    } catch (error) {
      console.warn(`⚠️  Cleanup warning:`, error.message);
    }
  }, 30000);
}

// Run the test
if (require.main === module) {
  simulateDelayedChunks().catch(console.error);
}

module.exports = { simulateDelayedChunks };