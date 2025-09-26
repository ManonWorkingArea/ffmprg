#!/usr/bin/env node

/**
 * Media Recording API Diagnostic Tool
 * 
 * Tests CORS configuration and file upload limits for the media recording API
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  serverUrl: 'https://media.cloudrestfulapi.com',
  // serverUrl: 'http://localhost:3000', // Uncomment for local testing
  testOrigin: 'http://localhost:8080',
  endpoints: [
    '/api/cors-test',
    '/api/media/cors-test',
    '/api/media/recording/init',
    '/api/media/recording/chunk'
  ]
};

/**
 * Test CORS preflight request
 */
async function testCORSPreflight(serverUrl, endpoint, origin) {
  try {
    console.log(`\n🔍 Testing CORS preflight: ${endpoint} from origin ${origin}`);
    
    const response = await axios.options(`${serverUrl}${endpoint}`, {
      headers: {
        'Origin': origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, X-Session-ID, X-Chunk-Index'
      },
      validateStatus: () => true // Don't throw on any status code
    });
    
    const corsHeaders = {
      allowOrigin: response.headers['access-control-allow-origin'],
      allowMethods: response.headers['access-control-allow-methods'],
      allowHeaders: response.headers['access-control-allow-headers'],
      allowCredentials: response.headers['access-control-allow-credentials'],
      maxAge: response.headers['access-control-max-age']
    };
    
    if (response.status === 200) {
      console.log(`  ✅ Preflight OK (${response.status}):`, corsHeaders);
      return { success: true, status: response.status, headers: corsHeaders };
    } else {
      console.log(`  ❌ Preflight failed (${response.status}):`, corsHeaders);
      return { success: false, status: response.status, headers: corsHeaders };
    }
  } catch (error) {
    console.log(`  ❌ Preflight error:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Test CORS request
 */
async function testCORSRequest(serverUrl, endpoint, origin) {
  try {
    console.log(`\n🌐 Testing CORS request: ${endpoint} from origin ${origin}`);
    
    const response = await axios.get(`${serverUrl}${endpoint}`, {
      headers: {
        'Origin': origin
      },
      validateStatus: () => true
    });
    
    const corsHeaders = {
      allowOrigin: response.headers['access-control-allow-origin'],
      allowCredentials: response.headers['access-control-allow-credentials']
    };
    
    if (response.status === 200) {
      console.log(`  ✅ CORS request OK (${response.status}):`, corsHeaders);
      console.log(`  📝 Response:`, response.data);
      return { success: true, status: response.status, headers: corsHeaders, data: response.data };
    } else {
      console.log(`  ❌ CORS request failed (${response.status}):`, corsHeaders);
      return { success: false, status: response.status, headers: corsHeaders };
    }
  } catch (error) {
    console.log(`  ❌ CORS request error:`, error.message);
    if (error.response) {
      console.log(`  📊 Status: ${error.response.status}, Headers:`, error.response.headers);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Create a test chunk file
 */
function createTestChunk(sizeInMB) {
  const fileName = `test-chunk-${sizeInMB}mb.bin`;
  const filePath = path.join(__dirname, fileName);
  
  try {
    // Create a buffer of the specified size
    const sizeInBytes = sizeInMB * 1024 * 1024;
    const buffer = Buffer.alloc(sizeInBytes, 0);
    fs.writeFileSync(filePath, buffer);
    console.log(`📁 Created test file: ${fileName} (${sizeInMB}MB)`);
    return filePath;
  } catch (error) {
    console.error(`❌ Failed to create test file:`, error.message);
    return null;
  }
}

/**
 * Test file upload limits
 */
async function testFileUpload(serverUrl, origin, fileSizeMB) {
  try {
    console.log(`\n📤 Testing file upload: ${fileSizeMB}MB chunk from origin ${origin}`);
    
    // Create test file
    const filePath = createTestChunk(fileSizeMB);
    if (!filePath) {
      return { success: false, error: 'Failed to create test file' };
    }
    
    // Create form data
    const formData = new FormData();
    formData.append('chunk', fs.createReadStream(filePath));
    formData.append('metadata', JSON.stringify({
      sessionId: 'test-session-' + Date.now(),
      chunkIndex: 0,
      totalChunks: 1
    }));
    
    // Test upload
    const response = await axios.post(`${serverUrl}/api/media/recording/chunk`, formData, {
      headers: {
        ...formData.getHeaders(),
        'Origin': origin,
        'X-Session-ID': 'test-session-' + Date.now(),
        'X-Chunk-Index': '0'
      },
      timeout: 60000, // 60 second timeout
      validateStatus: () => true,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    // Clean up test file
    fs.unlinkSync(filePath);
    
    if (response.status === 200 || response.status === 201) {
      console.log(`  ✅ Upload OK (${response.status}):`, response.data);
      return { success: true, status: response.status, data: response.data };
    } else if (response.status === 413) {
      console.log(`  ❌ Upload failed - Content Too Large (${response.status})`);
      console.log(`  💡 Server rejected ${fileSizeMB}MB file - size limit exceeded`);
      return { success: false, status: response.status, error: 'Content Too Large' };
    } else {
      console.log(`  ❌ Upload failed (${response.status}):`, response.data);
      return { success: false, status: response.status, data: response.data };
    }
  } catch (error) {
    console.log(`  ❌ Upload error:`, error.message);
    if (error.response?.status === 413) {
      console.log(`  💡 Server rejected upload - 413 Content Too Large`);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Run all diagnostic tests
 */
async function runDiagnostics() {
  console.log('🏥 Media Recording API Diagnostics');
  console.log('==================================');
  console.log(`Server: ${config.serverUrl}`);
  console.log(`Test Origin: ${config.testOrigin}`);
  
  const results = {
    cors: { preflight: [], requests: [] },
    uploads: []
  };
  
  // Test CORS for each endpoint
  for (const endpoint of config.endpoints) {
    // Test preflight
    const preflightResult = await testCORSPreflight(config.serverUrl, endpoint, config.testOrigin);
    results.cors.preflight.push({ endpoint, ...preflightResult });
    
    // Test actual request (only for GET endpoints)
    if (endpoint.includes('cors-test') || endpoint.includes('/init')) {
      const requestResult = await testCORSRequest(config.serverUrl, endpoint, config.testOrigin);
      results.cors.requests.push({ endpoint, ...requestResult });
    }
  }
  
  // Test file uploads with different sizes
  const testSizes = [10, 25, 50, 75, 100]; // MB
  for (const size of testSizes) {
    const uploadResult = await testFileUpload(config.serverUrl, config.testOrigin, size);
    results.uploads.push({ size, ...uploadResult });
  }
  
  // Summary
  console.log('\n📊 Diagnostic Summary');
  console.log('====================');
  
  const successfulPreflights = results.cors.preflight.filter(r => r.success).length;
  const totalPreflights = results.cors.preflight.length;
  console.log(`🔍 CORS Preflights: ${successfulPreflights}/${totalPreflights} passed`);
  
  const successfulRequests = results.cors.requests.filter(r => r.success).length;
  const totalRequests = results.cors.requests.length;
  console.log(`🌐 CORS Requests: ${successfulRequests}/${totalRequests} passed`);
  
  const successfulUploads = results.uploads.filter(r => r.success).length;
  const totalUploads = results.uploads.length;
  console.log(`📤 File Uploads: ${successfulUploads}/${totalUploads} passed`);
  
  // Find maximum successful upload size
  const maxSuccessfulUpload = results.uploads
    .filter(r => r.success)
    .reduce((max, r) => Math.max(max, r.size), 0);
  
  if (maxSuccessfulUpload > 0) {
    console.log(`📈 Maximum successful upload: ${maxSuccessfulUpload}MB`);
  } else {
    console.log(`❌ No successful uploads - check server configuration`);
  }
  
  // Recommendations
  console.log('\n💡 Recommendations');
  console.log('==================');
  
  if (successfulPreflights < totalPreflights) {
    console.log('❌ CORS preflight issues detected:');
    console.log('   - Check server CORS configuration');
    console.log('   - Verify allowed origins include localhost:8080');
    console.log('   - Ensure preflight requests return 200 OK');
  }
  
  if (maxSuccessfulUpload < 50) {
    console.log('❌ File upload size limits too low:');
    console.log('   - Update Express body size limits (express.json, express.urlencoded)');
    console.log('   - Update multer file size limits');
    console.log('   - Check nginx client_max_body_size if using proxy');
    console.log('   - Verify production server memory limits');
  }
  
  if (successfulPreflights === totalPreflights && maxSuccessfulUpload >= 50) {
    console.log('✅ API configuration looks good!');
    console.log('   - CORS is properly configured');
    console.log('   - File upload limits support video chunks');
  }
  
  return results;
}

// Run diagnostics if called directly
if (require.main === module) {
  runDiagnostics().catch(console.error);
}

module.exports = { runDiagnostics, testCORSPreflight, testCORSRequest, testFileUpload };