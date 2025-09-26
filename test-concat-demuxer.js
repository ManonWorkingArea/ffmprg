#!/usr/bin/env node

/**
 * Test FFmpeg Concat Demuxer with File List
 * Tests the new approach using filelist.txt instead of multiple inputs
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class ConcatDemuxerTester {
  constructor(options = {}) {
    this.testDir = options.testDir || path.join(__dirname, 'test-concat-demux');
    this.sessionId = `concat_test_${Date.now()}`;
    this.chunks = [];
  }
  
  /**
   * Create test WebM chunks
   */
  async createTestChunks() {
    console.log('🎬 Creating Test WebM Chunks for Concat Demuxer');
    console.log('================================================');
    
    const sessionDir = path.join(this.testDir, this.sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    
    await fs.mkdir(chunksDir, { recursive: true });
    console.log(`📁 Created test directory: ${sessionDir}`);
    
    // Create more chunks to test the efficiency gain
    const numChunks = 10;
    const chunkDurationSeconds = 1;
    
    for (let i = 0; i < numChunks; i++) {
      const chunkPath = path.join(chunksDir, `chunk_${String(i).padStart(4, '0')}.webm`);
      
      try {
        // Create colored test patterns
        const colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'pink', 'brown', 'gray', 'cyan'];
        const color = colors[i % colors.length];
        
        // Add text overlay to identify chunks
        const ffmpegCmd = [
          'ffmpeg',
          '-f', 'lavfi',
          '-i', `color=${color}:size=320x240:duration=${chunkDurationSeconds}:rate=30`,
          '-vf', `drawtext=fontsize=30:fontcolor=white:text='Chunk ${i}':x=10:y=10`,
          '-c:v', 'libvpx-vp9',
          '-crf', '35',
          '-b:v', '500k',
          '-cpu-used', '8', // Fast encoding
          '-y',
          chunkPath
        ].join(' ');
        
        console.log(`🎨 Creating chunk ${i}: ${color}`);
        execSync(ffmpegCmd, { stdio: 'pipe' });
        
        const stats = await fs.stat(chunkPath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        
        console.log(`✅ Chunk ${i} created: ${sizeMB}MB`);
        
        this.chunks.push({
          index: i,
          path: chunkPath,
          filename: `chunk_${String(i).padStart(4, '0')}.webm`,
          size: stats.size,
          color: color
        });
        
      } catch (error) {
        console.error(`❌ Failed to create chunk ${i}:`, error.message);
        throw error;
      }
    }
    
    console.log(`✅ Created ${this.chunks.length} test WebM chunks`);
    return { sessionDir, chunksDir };
  }
  
  /**
   * Test concat demuxer approach
   */
  async testConcatDemuxer(sessionDir) {
    console.log('\n📝 Testing Concat Demuxer with File List');
    console.log('=========================================');
    
    const outputPath = path.join(sessionDir, `${this.sessionId}_concat.mp4`);
    const fileListPath = path.join(sessionDir, 'filelist.txt');
    
    try {
      // Create file list
      const fileListContent = this.chunks
        .sort((a, b) => a.index - b.index)
        .map(chunk => {
          const relativePath = path.relative(sessionDir, chunk.path);
          return `file '${relativePath}'`;
        })
        .join('\n');
      
      await fs.writeFile(fileListPath, fileListContent, 'utf8');
      console.log(`📝 Created file list: ${fileListPath}`);
      console.log(`📋 File list content:`);
      console.log(fileListContent);
      
      // Build FFmpeg command using concat demuxer
      const ffmpegCmd = [
        'ffmpeg',
        '-f', 'concat',
        '-safe', '0',
        '-i', `"${fileListPath}"`,
        '-c', 'copy',  // Try stream copy first
        '-avoid_negative_ts', 'make_zero',
        '-fflags', '+genpts',
        '-y',
        `"${outputPath}"`
      ].join(' ');
      
      console.log(`🚀 Running concat demuxer test:`);
      console.log(`   Command: ${ffmpegCmd}`);
      
      const startTime = Date.now();
      
      try {
        execSync(ffmpegCmd, { stdio: 'inherit', timeout: 60000 });
        
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        
        // Verify output
        const outputStats = await fs.stat(outputPath);
        const outputSizeMB = (outputStats.size / 1024 / 1024).toFixed(2);
        
        console.log(`✅ Concat demuxer success!`);
        console.log(`   Duration: ${duration}s`);
        console.log(`   Output size: ${outputSizeMB}MB`);
        
        return {
          method: 'concat_demuxer_stream_copy',
          success: true,
          duration: parseFloat(duration),
          outputSize: parseFloat(outputSizeMB),
          outputPath
        };
        
      } catch (streamCopyError) {
        console.log(`⚠️  Stream copy failed, trying re-encode: ${streamCopyError.message}`);
        
        // Try with re-encoding
        const reencodeCmd = [
          'ffmpeg',
          '-f', 'concat',
          '-safe', '0',
          '-i', `"${fileListPath}"`,
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-movflags', 'faststart',
          '-avoid_negative_ts', 'make_zero',
          '-y',
          `"${outputPath}"`
        ].join(' ');
        
        console.log(`🔄 Trying with re-encoding: ${reencodeCmd}`);
        
        const reencodeStartTime = Date.now();
        execSync(reencodeCmd, { stdio: 'inherit', timeout: 120000 });
        
        const reencodeEndTime = Date.now();
        const reencodeDuration = ((reencodeEndTime - reencodeStartTime) / 1000).toFixed(2);
        
        const outputStats = await fs.stat(outputPath);
        const outputSizeMB = (outputStats.size / 1024 / 1024).toFixed(2);
        
        console.log(`✅ Re-encoding success!`);
        console.log(`   Duration: ${reencodeDuration}s`);
        console.log(`   Output size: ${outputSizeMB}MB`);
        
        return {
          method: 'concat_demuxer_reencode',
          success: true,
          duration: parseFloat(reencodeDuration),
          outputSize: parseFloat(outputSizeMB),
          outputPath
        };
      }
      
    } catch (error) {
      console.error(`❌ Concat demuxer test failed: ${error.message}`);
      throw error;
    } finally {
      // Clean up file list
      try {
        await fs.unlink(fileListPath);
        console.log(`🗑️  Cleaned up file list`);
      } catch (cleanupError) {
        console.warn(`⚠️  Could not clean up file list: ${cleanupError.message}`);
      }
    }
  }
  
  /**
   * Compare with filter_complex approach
   */
  async testFilterComplex(sessionDir) {
    console.log('\n🔧 Testing Filter Complex (for comparison)');
    console.log('==========================================');
    
    const outputPath = path.join(sessionDir, `${this.sessionId}_filter.mp4`);
    
    try {
      // Build inputs and filter
      const inputs = this.chunks.map(chunk => `-i "${chunk.path}"`).join(' ');
      const filterInputs = this.chunks.map((_, index) => `[${index}:v]`).join('');
      const filterComplex = `${filterInputs}concat=n=${this.chunks.length}:v=1:a=0[outv]`;
      
      const ffmpegCmd = [
        'ffmpeg',
        inputs,
        '-filter_complex', `"${filterComplex}"`,
        '-map', '[outv]',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-movflags', 'faststart',
        '-y',
        `"${outputPath}"`
      ].join(' ');
      
      console.log(`🔧 Filter complex command length: ${ffmpegCmd.length} characters`);
      console.log(`🚀 Running filter complex test...`);
      
      const startTime = Date.now();
      execSync(ffmpegCmd, { stdio: 'inherit', timeout: 120000 });
      const endTime = Date.now();
      
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      const outputStats = await fs.stat(outputPath);
      const outputSizeMB = (outputStats.size / 1024 / 1024).toFixed(2);
      
      console.log(`✅ Filter complex success!`);
      console.log(`   Duration: ${duration}s`);
      console.log(`   Output size: ${outputSizeMB}MB`);
      
      return {
        method: 'filter_complex',
        success: true,
        duration: parseFloat(duration),
        outputSize: parseFloat(outputSizeMB),
        outputPath,
        commandLength: ffmpegCmd.length
      };
      
    } catch (error) {
      console.error(`❌ Filter complex test failed: ${error.message}`);
      return {
        method: 'filter_complex',
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Run comparison test
   */
  async runComparison() {
    console.log('🧪 FFmpeg Concat Methods Comparison');
    console.log('===================================');
    
    try {
      // Check FFmpeg availability
      execSync('ffmpeg -version', { stdio: 'pipe' });
      console.log('✅ FFmpeg is available\n');
      
      // Create test chunks
      const { sessionDir } = await this.createTestChunks();
      
      // Test both methods
      const concatResult = await this.testConcatDemuxer(sessionDir);
      const filterResult = await this.testFilterComplex(sessionDir);
      
      // Compare results
      console.log('\n📊 Comparison Results');
      console.log('=====================');
      
      console.log('\n📝 Concat Demuxer:');
      console.log(`   Success: ${concatResult.success ? '✅' : '❌'}`);
      console.log(`   Method: ${concatResult.method}`);
      console.log(`   Duration: ${concatResult.duration}s`);
      console.log(`   Output size: ${concatResult.outputSize}MB`);
      
      console.log('\n🔧 Filter Complex:');
      console.log(`   Success: ${filterResult.success ? '✅' : '❌'}`);
      console.log(`   Duration: ${filterResult.success ? filterResult.duration + 's' : 'Failed'}`);
      console.log(`   Output size: ${filterResult.success ? filterResult.outputSize + 'MB' : 'N/A'}`);
      console.log(`   Command length: ${filterResult.commandLength || 'N/A'} characters`);
      
      if (concatResult.success && filterResult.success) {
        const speedImprovement = ((filterResult.duration - concatResult.duration) / filterResult.duration * 100).toFixed(1);
        console.log(`\n🏆 Performance Comparison:`);
        console.log(`   Concat demuxer is ${speedImprovement}% faster`);
        console.log(`   Command length reduction: ${(((filterResult.commandLength - 200) / filterResult.commandLength) * 100).toFixed(1)}%`);
      }
      
      console.log('\n💡 Recommendations:');
      if (concatResult.method === 'concat_demuxer_stream_copy') {
        console.log('   ✅ Use concat demuxer with stream copy for best performance');
      } else {
        console.log('   🔄 Use concat demuxer with re-encoding (still better than filter_complex)');
      }
      console.log('   📝 File list approach handles unlimited number of chunks');
      console.log('   🚀 Much shorter command lines');
      console.log('   💾 Less memory usage');
      
    } catch (error) {
      console.error('\n❌ Comparison test failed:', error.message);
      console.error('Stack trace:', error.stack);
    }
  }
  
  /**
   * Cleanup test files
   */
  async cleanup() {
    try {
      await fs.rm(this.testDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up test directory: ${this.testDir}`);
    } catch (error) {
      console.warn(`⚠️  Could not clean up: ${error.message}`);
    }
  }
}

// Run the test
if (require.main === module) {
  const tester = new ConcatDemuxerTester();
  
  tester.runComparison()
    .then(() => {
      console.log('\n❓ Keep test files? (Ctrl+C to keep, Enter to delete)');
      process.stdin.once('data', () => {
        tester.cleanup().then(() => process.exit(0));
      });
    })
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

module.exports = ConcatDemuxerTester;