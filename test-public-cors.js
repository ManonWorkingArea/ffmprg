#!/usr/bin/env node

/**
 * Public CORS Configuration Test
 * 
 * Tests the updated CORS configuration that allows all origins
 */

const http = require('http');
const https = require('https');

// Test configuration
const config = {
  serverUrl: 'https://media.cloudrestfulapi.com',
  localServerUrl: 'http://localhost:3000',
  testOrigins: [
    'http://localhost:8080',
    'http://localhost:3000',
    'https://example.com',
    'https://any-domain.com',
    'http://192.168.1.100:8080',
    'https://testing.cloudrestfulapi.com'
  ]
};

/**
 * Test CORS preflight request
 */
async function testCORSPreflight(serverUrl, origin) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${serverUrl}/api/media/recording/init`);
    const requestModule = url.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'OPTIONS',
      headers: {
        'Origin': origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, X-Session-ID'
      },
      timeout: 10000
    };
    
    const req = requestModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data,
          origin: origin
        });
      });
    });
    
    req.on('error', (error) => {
      reject({ error: error.message, origin });
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject({ error: 'Request timeout', origin });
    });
    
    req.setTimeout(10000);
    req.end();
  });
}

/**
 * Test actual POST request with CORS
 */
async function testCORSPostRequest(serverUrl, origin) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${serverUrl}/api/media/recording/init`);
    const requestModule = url.protocol === 'https:' ? https : http;
    
    const postData = JSON.stringify({
      sessionId: `test_${Date.now()}`,
      timestamp: new Date().toISOString()
    });
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Origin': origin,
        'Content-Type': 'application/json',
        'Content-Length': postData.length,
        'X-Session-ID': `test_${Date.now()}`
      },
      timeout: 10000
    };
    
    const req = requestModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data,
          origin: origin
        });
      });
    });
    
    req.on('error', (error) => {
      reject({ error: error.message, origin });
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject({ error: 'Request timeout', origin });
    });
    
    req.setTimeout(10000);
    req.write(postData);
    req.end();
  });
}

/**
 * Run all CORS tests
 */
async function runCORSTests() {
  console.log('🧪 Testing Public CORS Configuration');
  console.log('=====================================');
  
  for (const serverUrl of [config.serverUrl]) {
    console.log(`\n🌐 Testing server: ${serverUrl}`);
    console.log('─'.repeat(50));
    
    for (const origin of config.testOrigins) {
      console.log(`\n📡 Testing origin: ${origin}`);
      
      // Test preflight request
      try {
        console.log('  ✈️  Testing preflight (OPTIONS)...');
        const preflightResult = await testCORSPreflight(serverUrl, origin);
        
        console.log(`    Status: ${preflightResult.statusCode}`);
        console.log(`    Access-Control-Allow-Origin: ${preflightResult.headers['access-control-allow-origin'] || 'NOT SET'}`);
        console.log(`    Access-Control-Allow-Methods: ${preflightResult.headers['access-control-allow-methods'] || 'NOT SET'}`);
        console.log(`    Access-Control-Allow-Headers: ${preflightResult.headers['access-control-allow-headers'] || 'NOT SET'}`);
        
        if (preflightResult.statusCode === 200) {
          console.log('    ✅ Preflight successful');
        } else {
          console.log(`    ❌ Preflight failed (${preflightResult.statusCode})`);
        }
        
      } catch (error) {
        console.log(`    ❌ Preflight error: ${error.error}`);
      }
      
      // Test actual POST request
      try {
        console.log('  📤 Testing POST request...');
        const postResult = await testCORSPostRequest(serverUrl, origin);
        
        console.log(`    Status: ${postResult.statusCode}`);
        console.log(`    Access-Control-Allow-Origin: ${postResult.headers['access-control-allow-origin'] || 'NOT SET'}`);
        
        if (postResult.statusCode === 200 || postResult.statusCode === 201) {
          console.log('    ✅ POST request successful');
          
          try {
            const responseData = JSON.parse(postResult.data);
            console.log(`    Response: ${responseData.message || responseData.error || 'OK'}`);
          } catch (e) {
            console.log('    Response: Data received');
          }
        } else {
          console.log(`    ❌ POST request failed (${postResult.statusCode})`);
          
          try {
            const responseData = JSON.parse(postResult.data);
            console.log(`    Error: ${responseData.error || responseData.message || 'Unknown'}`);
          } catch (e) {
            console.log(`    Raw response: ${postResult.data.substring(0, 100)}...`);
          }
        }
        
      } catch (error) {
        console.log(`    ❌ POST request error: ${error.error}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between tests
    }
  }
  
  console.log('\n🏁 CORS testing completed!');
  console.log('\n💡 Summary:');
  console.log('   - All origins should now be allowed');
  console.log('   - Both preflight and actual requests should succeed');
  console.log('   - Access-Control-Allow-Origin should reflect the request origin or be "*"');
  console.log('\n📋 Next steps:');
  console.log('   1. Deploy this updated configuration to production');
  console.log('   2. Test with your actual frontend application');
  console.log('   3. Monitor CORS headers in browser developer tools');
}

// Run the tests
if (require.main === module) {
  runCORSTests().catch(console.error);
}

module.exports = { runCORSTests };