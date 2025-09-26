#!/usr/bin/env node

/**
 * Directory Permissions Test
 * 
 * This script helps diagnose directory creation and permission issues
 * for the media recording system in production environments
 */

const fs = require('fs').promises;
const path = require('path');

// Test configuration
const TESTS = {
  WORKING_DIR: process.cwd(),
  UPLOADS_DIR: path.resolve(process.cwd(), 'uploads'),
  MEDIA_DIR: path.resolve(process.cwd(), 'uploads', 'media-recording'),
  SESSIONS_DIR: path.resolve(process.cwd(), 'uploads', 'media-recording', 'sessions'),
  FALLBACK_DIR: path.join('/tmp', 'ffmprg-media-recording', 'sessions'),
  TEST_SESSION_ID: `test_${Date.now()}_permissions`
};

/**
 * Test directory creation and permissions
 */
async function testDirectoryCreation(dirPath, description) {
  console.log(`\n🔍 Testing ${description}: ${dirPath}`);
  
  try {
    // Check if directory exists
    try {
      await fs.access(dirPath);
      console.log(`  ✅ Directory already exists`);
    } catch (error) {
      console.log(`  📁 Directory does not exist, creating...`);
    }
    
    // Try to create directory
    await fs.mkdir(dirPath, { recursive: true, mode: 0o755 });
    console.log(`  ✅ Directory created successfully`);
    
    // Test write permissions
    await fs.access(dirPath, fs.constants.W_OK);
    console.log(`  ✅ Directory is writable`);
    
    // Test read permissions
    await fs.access(dirPath, fs.constants.R_OK);
    console.log(`  ✅ Directory is readable`);
    
    // Create test file
    const testFilePath = path.join(dirPath, 'permission-test.json');
    const testData = {
      test: true,
      timestamp: new Date().toISOString(),
      pid: process.pid
    };
    
    await fs.writeFile(testFilePath, JSON.stringify(testData, null, 2), { mode: 0o644 });
    console.log(`  ✅ Test file created successfully`);
    
    // Read test file
    const readData = await fs.readFile(testFilePath, 'utf8');
    const parsedData = JSON.parse(readData);
    console.log(`  ✅ Test file read successfully`);
    
    // Clean up test file
    await fs.unlink(testFilePath);
    console.log(`  ✅ Test file cleaned up`);
    
    return true;
    
  } catch (error) {
    console.error(`  ❌ FAILED: ${error.message}`);
    console.error(`  📍 Error code: ${error.code}`);
    
    if (error.code === 'EACCES') {
      console.error(`  💡 Permission denied - check file system permissions`);
    } else if (error.code === 'ENOENT') {
      console.error(`  💡 Path does not exist and cannot be created`);
    } else if (error.code === 'EROFS') {
      console.error(`  💡 Read-only file system`);
    }
    
    return false;
  }
}

/**
 * Test session creation workflow
 */
async function testSessionWorkflow(baseDir, description) {
  console.log(`\n🎯 Testing session workflow in ${description}`);
  
  try {
    const sessionId = TESTS.TEST_SESSION_ID;
    const sessionDir = path.join(baseDir, sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    const metadataPath = path.join(sessionDir, 'session.json');
    
    // Create session directory
    await fs.mkdir(sessionDir, { recursive: true, mode: 0o755 });
    console.log(`  ✅ Session directory created: ${sessionDir}`);
    
    // Create chunks directory
    await fs.mkdir(chunksDir, { recursive: true, mode: 0o755 });
    console.log(`  ✅ Chunks directory created: ${chunksDir}`);
    
    // Create session metadata
    const sessionData = {
      sessionId: sessionId,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      status: 'test',
      totalChunks: 0,
      totalSize: 0,
      chunks: [],
      testWorkflow: true
    };
    
    await fs.writeFile(metadataPath, JSON.stringify(sessionData, null, 2), { 
      encoding: 'utf8',
      mode: 0o644 
    });
    console.log(`  ✅ Session metadata created: ${metadataPath}`);
    
    // Verify session metadata can be read
    const readSessionData = await fs.readFile(metadataPath, 'utf8');
    const parsedSessionData = JSON.parse(readSessionData);
    console.log(`  ✅ Session metadata verified`);
    
    // Create test chunk file
    const chunkFilename = 'chunk_0001.webm';
    const chunkPath = path.join(chunksDir, chunkFilename);
    const chunkData = Buffer.from('TEST_CHUNK_DATA');
    
    await fs.writeFile(chunkPath, chunkData, { mode: 0o644 });
    console.log(`  ✅ Test chunk file created: ${chunkPath}`);
    
    // Clean up test session
    await fs.unlink(chunkPath);
    await fs.unlink(metadataPath);
    await fs.rmdir(chunksDir);
    await fs.rmdir(sessionDir);
    console.log(`  ✅ Test session cleaned up`);
    
    return true;
    
  } catch (error) {
    console.error(`  ❌ Session workflow failed: ${error.message}`);
    
    // Try to clean up if possible
    try {
      const sessionId = TESTS.TEST_SESSION_ID;
      const sessionDir = path.join(baseDir, sessionId);
      await fs.rm(sessionDir, { recursive: true, force: true });
      console.log(`  🗑️ Cleanup attempted`);
    } catch (cleanupError) {
      console.error(`  ⚠️  Cleanup failed: ${cleanupError.message}`);
    }
    
    return false;
  }
}

/**
 * Display system information
 */
async function displaySystemInfo() {
  console.log(`\n📊 SYSTEM INFORMATION`);
  console.log(`════════════════════════════════════════════════════`);
  console.log(`Process ID: ${process.pid}`);
  console.log(`Node.js Version: ${process.version}`);
  console.log(`Platform: ${process.platform}`);
  console.log(`Architecture: ${process.arch}`);
  console.log(`Current Working Directory: ${process.cwd()}`);
  
  if (process.getuid) {
    console.log(`Process UID: ${process.getuid()}`);
  }
  
  if (process.getgid) {
    console.log(`Process GID: ${process.getgid()}`);
  }
  
  // Check environment variables
  console.log(`\n🔧 ENVIRONMENT VARIABLES`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  console.log(`PM2_HOME: ${process.env.PM2_HOME || 'not set'}`);
  console.log(`HOME: ${process.env.HOME || 'not set'}`);
  console.log(`USER: ${process.env.USER || 'not set'}`);
  
  // Check disk space
  try {
    const stats = await fs.stat(process.cwd());
    console.log(`\n💾 WORKING DIRECTORY INFO`);
    console.log(`Directory exists: ✅`);
    console.log(`Is Directory: ${stats.isDirectory() ? '✅' : '❌'}`);
    console.log(`Mode: ${stats.mode.toString(8)}`);
  } catch (error) {
    console.error(`Working directory check failed: ${error.message}`);
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log(`🚀 DIRECTORY PERMISSIONS TEST SUITE`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`Starting directory permissions tests...`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  
  await displaySystemInfo();
  
  console.log(`\n🧪 RUNNING DIRECTORY TESTS`);
  console.log(`════════════════════════════════════════════════════`);
  
  const results = {};
  
  // Test each directory
  for (const [key, dir] of Object.entries(TESTS)) {
    if (key === 'TEST_SESSION_ID') continue;
    
    const success = await testDirectoryCreation(dir, key);
    results[key] = success;
  }
  
  console.log(`\n🎯 RUNNING WORKFLOW TESTS`);
  console.log(`════════════════════════════════════════════════════`);
  
  // Test session workflow in main directory
  const mainWorkflowSuccess = await testSessionWorkflow(TESTS.SESSIONS_DIR, 'main sessions directory');
  results.MAIN_WORKFLOW = mainWorkflowSuccess;
  
  // Test session workflow in fallback directory
  const fallbackWorkflowSuccess = await testSessionWorkflow(TESTS.FALLBACK_DIR, 'fallback directory');
  results.FALLBACK_WORKFLOW = fallbackWorkflowSuccess;
  
  console.log(`\n📋 TEST RESULTS SUMMARY`);
  console.log(`════════════════════════════════════════════════════`);
  
  let allPassed = true;
  for (const [test, passed] of Object.entries(results)) {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${test}: ${status}`);
    if (!passed) allPassed = false;
  }
  
  console.log(`\n${allPassed ? '🎉' : '⚠️'} OVERALL RESULT: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  
  if (!allPassed) {
    console.log(`\n💡 RECOMMENDATIONS`);
    console.log(`════════════════════════════════════════════════════`);
    console.log(`1. Check file system permissions on the working directory`);
    console.log(`2. Ensure Node.js process has write access to create directories`);
    console.log(`3. Consider using a different directory with appropriate permissions`);
    console.log(`4. Check if the file system is read-only`);
    console.log(`5. Verify disk space availability`);
    console.log(`\n🔧 Commands to check permissions:`);
    console.log(`   ls -la ${process.cwd()}`);
    console.log(`   df -h ${process.cwd()}`);
    console.log(`   whoami`);
    console.log(`   id`);
  } else {
    console.log(`\n✅ All tests passed! Media recording system should work correctly.`);
  }
  
  console.log(`\n🏁 Test completed at: ${new Date().toISOString()}`);
  
  return allPassed;
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error(`\n❌ CRITICAL ERROR: ${error.message}`);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = { runTests, testDirectoryCreation, testSessionWorkflow };