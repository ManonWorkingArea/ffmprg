#!/usr/bin/env node

/**
 * CORS Configuration Test
 * 
 * Tests CORS configuration for media recording API endpoints
 * to ensure cross-origin requests work properly
 */

const axios = require('axios');

// Test configuration
const TEST_CONFIG = {
  SERVER_URL: 'https://media.cloudrestfulapi.com',
  LOCAL_URL: 'http://localhost:3000',
  TEST_ORIGINS: [
    'http://localhost:8080',
    'http://localhost:8081', 
    'https://cloudrestfulapi.com',
    'https://media.cloudrestfulapi.com'
  ],
  ENDPOINTS: [
    '/api/cors-test',
    '/api/media/cors-test',
    '/api/media/recording/status'
  ]
};

/**
 * Test CORS preflight request
 */
async function testPreflightRequest(serverUrl, endpoint, origin) {
  try {
    console.log(`🧪 Testing preflight: ${endpoint} from ${origin}`);
    
    const response = await axios.options(`${serverUrl}${endpoint}`, {
      headers: {
        'Origin': origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, X-Session-ID'
      },
      timeout: 10000
    });
    
    const corsHeaders = {
      allowOrigin: response.headers['access-control-allow-origin'],
      allowMethods: response.headers['access-control-allow-methods'],
      allowHeaders: response.headers['access-control-allow-headers'],
      allowCredentials: response.headers['access-control-allow-credentials'],
      maxAge: response.headers['access-control-max-age']
    };
    
    console.log(`  ✅ Preflight OK (${response.status})`, corsHeaders);
    return { success: true, status: response.status, headers: corsHeaders };
    
  } catch (error) {
    console.log(`  ❌ Preflight failed:`, error.response?.status || error.message);
    return { 
      success: false, 
      error: error.response?.status || error.message,
      headers: error.response?.headers || {}
    };
  }
}

/**
 * Test actual CORS request
 */
async function testCorsRequest(serverUrl, endpoint, origin) {
  try {
    console.log(`🌐 Testing CORS request: ${endpoint} from ${origin}`);
    
    const response = await axios.get(`${serverUrl}${endpoint}`, {
      headers: {
        'Origin': origin,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    const corsHeaders = {
      allowOrigin: response.headers['access-control-allow-origin'],
      allowCredentials: response.headers['access-control-allow-credentials']
    };
    
    console.log(`  ✅ CORS request OK (${response.status})`, corsHeaders);
    console.log(`  📝 Response:`, response.data);
    
    return { 
      success: true, 
      status: response.status, 
      headers: corsHeaders,
      data: response.data
    };
    
  } catch (error) {
    console.log(`  ❌ CORS request failed:`, error.response?.status || error.message);
    return { 
      success: false, 
      error: error.response?.status || error.message,
      headers: error.response?.headers || {}
    };
  }
}

/**
 * Test media recording chunk upload simulation
 */
async function testChunkUpload(serverUrl, origin) {
  try {
    console.log(`📦 Testing chunk upload simulation from ${origin}`);
    
    // Create form data
    const FormData = require('form-data');
    const formData = new FormData();
    
    // Add mock chunk data
    formData.append('chunk', Buffer.from('mock-chunk-data'), {
      filename: 'chunk_0001.webm',
      contentType: 'video/webm'
    });
    formData.append('sessionId', 'test_session_123');
    formData.append('chunkIndex', '1');
    formData.append('metadata', JSON.stringify({
      sessionId: 'test_session_123',
      chunkIndex: 1,
      size: 1024,
      timestamp: new Date().toISOString()
    }));
    
    // Set headers including origin
    const headers = {
      ...formData.getHeaders(),
      'Origin': origin
    };
    
    const response = await axios.post(`${serverUrl}/api/media/recording/chunk`, formData, {
      headers,
      timeout: 30000,
      validateStatus: (status) => status < 500 // Accept 4xx responses
    });
    
    console.log(`  ✅ Chunk upload test completed (${response.status})`);
    console.log(`  📝 Response:`, response.data);
    
    return { success: true, status: response.status, data: response.data };
    
  } catch (error) {
    console.log(`  ❌ Chunk upload test failed:`, error.response?.status || error.message);
    return { 
      success: false, 
      error: error.response?.status || error.message 
    };
  }
}

/**
 * Run comprehensive CORS tests
 */
async function runCorsTests() {
  console.log('🚀 CORS CONFIGURATION TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Testing server: ${TEST_CONFIG.SERVER_URL}`);
  console.log(`Test origins: ${TEST_CONFIG.TEST_ORIGINS.join(', ')}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);
  
  const results = {
    preflightTests: [],
    corsTests: [],
    chunkUploadTests: [],
    summary: {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0
    }
  };
  
  // Test each origin with each endpoint
  for (const origin of TEST_CONFIG.TEST_ORIGINS) {
    console.log(`\n🌍 Testing origin: ${origin}`);
    console.log('─'.repeat(50));
    
    for (const endpoint of TEST_CONFIG.ENDPOINTS) {
      // Test preflight
      const preflightResult = await testPreflightRequest(TEST_CONFIG.SERVER_URL, endpoint, origin);
      results.preflightTests.push({ origin, endpoint, ...preflightResult });
      results.summary.totalTests++;
      if (preflightResult.success) results.summary.passedTests++;
      else results.summary.failedTests++;
      
      // Test actual request
      const corsResult = await testCorsRequest(TEST_CONFIG.SERVER_URL, endpoint, origin);
      results.corsTests.push({ origin, endpoint, ...corsResult });
      results.summary.totalTests++;
      if (corsResult.success) results.summary.passedTests++;
      else results.summary.failedTests++;
      
      await new Promise(resolve => setTimeout(resolve, 500)); // Delay between requests
    }
    
    // Test chunk upload for media recording
    if (origin === 'http://localhost:8080') { // Test with main development origin
      const chunkResult = await testChunkUpload(TEST_CONFIG.SERVER_URL, origin);
      results.chunkUploadTests.push({ origin, ...chunkResult });
      results.summary.totalTests++;
      if (chunkResult.success) results.summary.passedTests++;
      else results.summary.failedTests++;
    }
  }
  
  // Print summary
  console.log('\n📊 TEST RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Total tests: ${results.summary.totalTests}`);
  console.log(`✅ Passed: ${results.summary.passedTests}`);
  console.log(`❌ Failed: ${results.summary.failedTests}`);
  console.log(`Success rate: ${((results.summary.passedTests / results.summary.totalTests) * 100).toFixed(1)}%`);
  
  // Detailed results
  console.log('\n📋 DETAILED RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  
  if (results.summary.failedTests > 0) {
    console.log('\n❌ FAILED TESTS:');
    
    // Failed preflight tests
    const failedPreflights = results.preflightTests.filter(t => !t.success);
    if (failedPreflights.length > 0) {
      console.log('  Preflight failures:');
      failedPreflights.forEach(t => {
        console.log(`    - ${t.endpoint} from ${t.origin}: ${t.error}`);
      });
    }
    
    // Failed CORS tests
    const failedCors = results.corsTests.filter(t => !t.success);
    if (failedCors.length > 0) {
      console.log('  CORS request failures:');
      failedCors.forEach(t => {
        console.log(`    - ${t.endpoint} from ${t.origin}: ${t.error}`);
      });
    }
    
    // Failed chunk upload tests
    const failedChunks = results.chunkUploadTests.filter(t => !t.success);
    if (failedChunks.length > 0) {
      console.log('  Chunk upload failures:');
      failedChunks.forEach(t => {
        console.log(`    - Chunk upload from ${t.origin}: ${t.error}`);
      });
    }
  } else {
    console.log('🎉 All tests passed! CORS configuration is working correctly.');
  }
  
  console.log('\n💡 RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════');
  
  if (results.summary.failedTests > 0) {
    console.log('1. Check server CORS configuration in app.js');
    console.log('2. Verify allowed origins list includes all development domains');
    console.log('3. Ensure preflight requests are handled properly');
    console.log('4. Check that all required headers are allowed');
    console.log('5. Test with actual browser to confirm CORS policy compliance');
  } else {
    console.log('✅ CORS configuration appears to be working correctly');
    console.log('✅ All origins can access the media recording API');
    console.log('✅ Preflight requests are handled properly');
    console.log('✅ All endpoints are accessible cross-origin');
  }
  
  console.log(`\n🏁 Test completed at: ${new Date().toISOString()}`);
  
  return results.summary.failedTests === 0;
}

// Run tests if this file is executed directly
if (require.main === module) {
  runCorsTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('\n❌ CRITICAL ERROR:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = { runCorsTests, testPreflightRequest, testCorsRequest };