#!/usr/bin/env node

/**
 * Test simplified CORS configuration
 * Tests that our CORS setup allows all origins without multiple header conflicts
 */

const https = require('https');
const http = require('http');

// Test configuration
const testConfig = {
  // Production server
  productionUrl: 'https://media.cloudrestfulapi.com',
  // Local server
  localUrl: 'http://localhost:3000',
  // Test origins
  testOrigins: [
    'http://localhost:8080',
    'http://localhost:8081',
    'https://example.com',
    'https://test.com',
    null // No origin header
  ]
};

async function testCorsRequest(baseUrl, origin, endpoint = '/api/media/recording/init') {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, baseUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'OPTIONS',
      headers: {
        'Content-Type': 'application/json',
        ...(origin && { 'Origin': origin })
      },
      timeout: 10000
    };
    
    console.log(`🧪 Testing CORS preflight: ${origin || 'no-origin'} → ${baseUrl}${endpoint}`);
    
    const req = client.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const headers = res.headers;
        const allowOrigin = headers['access-control-allow-origin'];
        const allowCredentials = headers['access-control-allow-credentials'];
        const allowMethods = headers['access-control-allow-methods'];
        const allowHeaders = headers['access-control-allow-headers'];
        
        const result = {
          status: res.statusCode,
          origin: origin,
          headers: {
            'access-control-allow-origin': allowOrigin,
            'access-control-allow-credentials': allowCredentials,
            'access-control-allow-methods': allowMethods,
            'access-control-allow-headers': allowHeaders
          },
          success: res.statusCode === 200 || res.statusCode === 204,
          corsValid: true
        };
        
        // Check for CORS violations
        if (allowOrigin && allowOrigin.includes(',')) {
          result.corsValid = false;
          result.error = 'Multiple values in Access-Control-Allow-Origin header';
        }
        
        if (allowOrigin === '*' && allowCredentials === 'true') {
          result.corsValid = false;
          result.error = 'Cannot use credentials:true with origin:*';
        }
        
        resolve(result);
      });
    });
    
    req.on('error', (error) => {
      resolve({
        status: 'error',
        origin: origin,
        error: error.message,
        success: false,
        corsValid: false
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 'timeout',
        origin: origin,
        error: 'Request timeout',
        success: false,
        corsValid: false
      });
    });
    
    req.end();
  });
}

async function testActualRequest(baseUrl, origin, endpoint = '/api/media/recording/init') {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, baseUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const postData = JSON.stringify({
      sessionId: `test_${Date.now()}`,
      timestamp: new Date().toISOString()
    });
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...(origin && { 'Origin': origin })
      },
      timeout: 10000
    };
    
    console.log(`🚀 Testing actual request: ${origin || 'no-origin'} → ${baseUrl}${endpoint}`);
    
    const req = client.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const allowOrigin = res.headers['access-control-allow-origin'];
        const allowCredentials = res.headers['access-control-allow-credentials'];
        
        resolve({
          status: res.statusCode,
          origin: origin,
          headers: {
            'access-control-allow-origin': allowOrigin,
            'access-control-allow-credentials': allowCredentials
          },
          body: data,
          success: res.statusCode < 400,
          corsValid: !allowOrigin || (!allowOrigin.includes(',') && !(allowOrigin === '*' && allowCredentials === 'true'))
        });
      });
    });
    
    req.on('error', (error) => {
      resolve({
        status: 'error',
        origin: origin,
        error: error.message,
        success: false,
        corsValid: false
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 'timeout',
        origin: origin,
        error: 'Request timeout',
        success: false,
        corsValid: false
      });
    });
    
    req.write(postData);
    req.end();
  });
}

async function runCorsTests() {
  console.log('🧪 Starting CORS Configuration Tests');
  console.log('==================================');
  
  const servers = [
    { name: 'Production', url: testConfig.productionUrl },
    { name: 'Local', url: testConfig.localUrl }
  ];
  
  for (const server of servers) {
    console.log(`\n📡 Testing ${server.name} Server: ${server.url}`);
    console.log('─'.repeat(50));
    
    // Test preflight requests
    console.log('\n🔍 PREFLIGHT TESTS (OPTIONS):');
    for (const origin of testConfig.testOrigins) {
      const result = await testCorsRequest(server.url, origin);
      
      if (result.success && result.corsValid) {
        console.log(`  ✅ ${origin || 'no-origin'}: ${result.status} - CORS OK`);
      } else {
        console.log(`  ❌ ${origin || 'no-origin'}: ${result.status} - ${result.error || 'Failed'}`);
        if (result.headers) {
          console.log(`     Allow-Origin: ${result.headers['access-control-allow-origin']}`);
          console.log(`     Allow-Credentials: ${result.headers['access-control-allow-credentials']}`);
        }
      }
    }
    
    // Test actual requests
    console.log('\n🚀 ACTUAL REQUEST TESTS (POST):');
    for (const origin of testConfig.testOrigins.slice(0, 3)) { // Test fewer for actual requests
      const result = await testActualRequest(server.url, origin);
      
      if (result.success && result.corsValid) {
        console.log(`  ✅ ${origin || 'no-origin'}: ${result.status} - Request OK`);
      } else {
        console.log(`  ❌ ${origin || 'no-origin'}: ${result.status} - ${result.error || 'Failed'}`);
        if (result.headers) {
          console.log(`     Allow-Origin: ${result.headers['access-control-allow-origin']}`);
          console.log(`     Allow-Credentials: ${result.headers['access-control-allow-credentials']}`);
        }
      }
    }
  }
  
  console.log('\n✅ CORS tests completed!');
  console.log('\n📋 Expected Results:');
  console.log('  - Access-Control-Allow-Origin: * (for all requests)');
  console.log('  - Access-Control-Allow-Credentials: undefined or false');
  console.log('  - Status: 200 or 404 (404 is OK if server not running)');
  console.log('  - No multiple values in Access-Control-Allow-Origin header');
}

// Run tests
if (require.main === module) {
  runCorsTests().catch(console.error);
}

module.exports = { testCorsRequest, testActualRequest, runCorsTests };