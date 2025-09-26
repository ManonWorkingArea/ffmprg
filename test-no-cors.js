#!/usr/bin/env node

/**
 * Test script to verify no CORS conflicts after removing CORS middleware
 * This should work with nginx handling CORS instead
 */

const express = require('express');
const path = require('path');

// Create a minimal test app to verify no CORS errors
const testApp = express();
const testPort = 3001;

// Basic middleware
testApp.use(express.json({ limit: '100mb' }));
testApp.use(express.urlencoded({ limit: '100mb', extended: true }));

try {
  // Test importing the routes to verify no missing middleware errors
  const mediaRecordingRoutes = require('./routes/mediaRecording');
  const { requestLogger, performanceMonitor } = require('./middleware/mediaRecording');
  
  console.log('✅ Successfully imported all routes and middleware');
  console.log('✅ No corsHandler dependency issues found');
  
  // Apply media recording middleware and routes (same as main app)
  testApp.use('/api/media', requestLogger);
  testApp.use('/api/media', performanceMonitor);
  testApp.use('/api/media', mediaRecordingRoutes);
  
  console.log('✅ Successfully registered media recording routes');
  
  // Test endpoint
  testApp.get('/test', (req, res) => {
    res.json({
      success: true,
      message: 'No CORS middleware conflicts',
      note: 'CORS will be handled by nginx'
    });
  });
  
  // Start test server
  const server = testApp.listen(testPort, () => {
    console.log(`🧪 Test server running on port ${testPort}`);
    console.log('✅ All middleware loaded successfully - no undefined functions');
    console.log('🌐 CORS handling removed - nginx will handle cross-origin requests');
    
    // Close after successful test
    setTimeout(() => {
      server.close();
      console.log('✅ Test completed successfully - server can start without CORS errors');
      process.exit(0);
    }, 1000);
  });
  
  server.on('error', (error) => {
    console.error('❌ Test server error:', error);
    process.exit(1);
  });
  
} catch (error) {
  console.error('❌ Error testing middleware imports:', error);
  console.error('🔍 Error details:', error.message);
  process.exit(1);
}