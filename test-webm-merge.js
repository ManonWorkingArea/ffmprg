#!/usr/bin/env node

/**
 * Test Real WebM Chunk Merging
 * Creates actual WebM chunks and tests the FFmpeg merging process
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class WebMChunkMergeTester {
  constructor(options = {}) {
    this.testDir = options.testDir || path.join(__dirname, 'test-webm-merge');
    this.sessionId = `webm_test_${Date.now()}`;
    this.chunks = [];
  }
  
  /**
   * Create test WebM chunks using FFmpeg
   */
  async createTestWebMChunks() {
    console.log('🎬 Creating Test WebM Chunks');
    console.log('============================');
    
    // Create test directory
    const sessionDir = path.join(this.testDir, this.sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    
    await fs.mkdir(chunksDir, { recursive: true });
    console.log(`📁 Created test directory: ${sessionDir}`);
    
    // Create a simple test video source (color patterns)
    const numChunks = 3;
    const chunkDurationSeconds = 2;
    
    for (let i = 0; i < numChunks; i++) {
      const chunkPath = path.join(chunksDir, `chunk_${i}.webm`);
      
      try {
        // Create different colored chunks to verify they're being merged
        const colors = ['red', 'green', 'blue'];
        const color = colors[i % colors.length];
        
        const ffmpegCmd = [
          'ffmpeg',
          '-f', 'lavfi',
          '-i', `color=${color}:size=640x480:duration=${chunkDurationSeconds}:rate=30`,
          '-c:v', 'libvpx-vp9',
          '-crf', '30',
          '-b:v', '1M',
          '-y', // Overwrite output files
          chunkPath
        ].join(' ');
        
        console.log(`🎨 Creating chunk ${i}: ${color} (${chunkDurationSeconds}s)`);
        console.log(`   Command: ${ffmpegCmd}`);
        
        execSync(ffmpegCmd, { stdio: 'pipe' });
        
        // Verify chunk was created
        const stats = await fs.stat(chunkPath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        
        console.log(`✅ Chunk ${i} created: ${sizeMB}MB`);
        
        this.chunks.push({
          index: i,
          path: chunkPath,
          filename: `chunk_${i}.webm`,
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
   * Test the merging process using our FFmpeg logic
   */
  async testMergeProcess(sessionDir, chunksDir) {
    console.log('\n🔧 Testing FFmpeg Merge Process');
    console.log('===============================');
    
    const outputPath = path.join(sessionDir, `${this.sessionId}_final.mp4`);
    
    try {
      // Sort chunks by index (same as our production logic)
      this.chunks.sort((a, b) => a.index - b.index);
      
      console.log(`🔢 Merging ${this.chunks.length} chunks:`);
      this.chunks.forEach(chunk => {
        console.log(`   ${chunk.index}: ${chunk.filename} (${chunk.color}, ${(chunk.size / 1024 / 1024).toFixed(2)}MB)`);
      });
      
      // Build FFmpeg command using filter_complex (same as production)
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
      
      console.log(`🚀 Running FFmpeg merge:`);
      console.log(`   Filter: ${filterComplex}`);
      console.log(`   Output: ${outputPath}`);
      
      const startTime = Date.now();
      execSync(ffmpegCmd, { stdio: 'inherit' });
      const endTime = Date.now();
      
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      
      // Verify output
      const outputStats = await fs.stat(outputPath);
      const outputSizeMB = (outputStats.size / 1024 / 1024).toFixed(2);
      
      console.log(`✅ Merge completed in ${duration}s`);
      console.log(`📊 Final video: ${outputSizeMB}MB`);
      
      // Get video info
      try {
        const ffprobeCmd = `ffprobe -v quiet -show_entries format=duration,size,bit_rate -show_entries stream=width,height,avg_frame_rate -of json "${outputPath}"`;
        const probeOutput = execSync(ffprobeCmd, { encoding: 'utf8' });
        const videoInfo = JSON.parse(probeOutput);
        
        console.log(`📹 Video Info:`);
        if (videoInfo.format) {
          console.log(`   Duration: ${parseFloat(videoInfo.format.duration).toFixed(2)}s`);
          console.log(`   Bitrate: ${Math.round(videoInfo.format.bit_rate / 1000)}kbps`);
        }
        if (videoInfo.streams && videoInfo.streams[0]) {
          const stream = videoInfo.streams[0];
          console.log(`   Resolution: ${stream.width}x${stream.height}`);
          console.log(`   Frame rate: ${stream.avg_frame_rate}`);
        }
        
        // Expected duration should be sum of all chunks
        const expectedDuration = this.chunks.length * 2; // 2 seconds per chunk
        const actualDuration = parseFloat(videoInfo.format.duration);
        
        if (Math.abs(actualDuration - expectedDuration) < 0.5) {
          console.log(`✅ Duration verification: Expected ${expectedDuration}s, got ${actualDuration.toFixed(2)}s`);
        } else {
          console.log(`⚠️  Duration mismatch: Expected ${expectedDuration}s, got ${actualDuration.toFixed(2)}s`);
        }
        
      } catch (probeError) {
        console.warn(`⚠️  Could not get video info: ${probeError.message}`);
      }
      
      return {
        success: true,
        outputPath,
        sizeMB: parseFloat(outputSizeMB),
        duration: parseFloat(duration),
        chunksProcessed: this.chunks.length
      };
      
    } catch (error) {
      console.error(`❌ Merge process failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Test cleanup process
   */
  async testCleanup(sessionDir, chunksDir) {
    console.log('\n🧹 Testing Cleanup Process');
    console.log('==========================');
    
    let deletedFiles = 0;
    let totalSizeFreed = 0;
    
    for (const chunk of this.chunks) {
      try {
        const stats = await fs.stat(chunk.path);
        await fs.unlink(chunk.path);
        
        deletedFiles++;
        totalSizeFreed += stats.size;
        console.log(`🗑️  Deleted: ${chunk.filename} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
        
      } catch (error) {
        console.error(`❌ Failed to delete ${chunk.path}: ${error.message}`);
      }
    }
    
    // Try to remove chunks directory
    try {
      await fs.rmdir(chunksDir);
      console.log(`🗑️  Removed chunks directory`);
    } catch (error) {
      console.warn(`⚠️  Could not remove chunks directory: ${error.message}`);
    }
    
    const totalSizeFreedMB = (totalSizeFreed / 1024 / 1024).toFixed(2);
    console.log(`✅ Cleanup completed: ${deletedFiles} files deleted, ${totalSizeFreedMB}MB freed`);
    
    return {
      deletedFiles,
      totalSizeFreedMB: parseFloat(totalSizeFreedMB)
    };
  }
  
  /**
   * Run complete test
   */
  async runCompleteTest() {
    console.log('🧪 WebM Chunk Merge Test');
    console.log('========================');
    
    try {
      // Check if FFmpeg is available
      try {
        execSync('ffmpeg -version', { stdio: 'pipe' });
        execSync('ffprobe -version', { stdio: 'pipe' });
        console.log('✅ FFmpeg and FFprobe are available');
      } catch (error) {
        throw new Error('FFmpeg is not installed or not in PATH');
      }
      
      // Step 1: Create test WebM chunks
      const { sessionDir, chunksDir } = await this.createTestWebMChunks();
      
      // Step 2: Test merge process
      const mergeResult = await this.testMergeProcess(sessionDir, chunksDir);
      
      // Step 3: Test cleanup
      const cleanupResult = await this.testCleanup(sessionDir, chunksDir);
      
      console.log('\n🎉 Test Completed Successfully!');
      console.log('==============================');
      console.log(`📁 Test directory: ${sessionDir}`);
      console.log(`📹 Final video: ${mergeResult.outputPath}`);
      console.log(`⏱️  Merge time: ${mergeResult.duration}s`);
      console.log(`📊 Final size: ${mergeResult.sizeMB}MB`);
      console.log(`🧹 Cleanup: ${cleanupResult.deletedFiles} files, ${cleanupResult.totalSizeFreedMB}MB freed`);
      
      console.log('\n🎬 You can play the final video with:');
      console.log(`   ffplay "${mergeResult.outputPath}"`);
      console.log(`   or open it in any video player`);
      
    } catch (error) {
      console.error('\n❌ Test Failed:', error.message);
      console.error('Stack trace:', error.stack);
    }
  }
  
  /**
   * Cleanup test directory
   */
  async cleanup() {
    try {
      await fs.rm(this.testDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up test directory: ${this.testDir}`);
    } catch (error) {
      console.warn(`⚠️  Could not clean up test directory: ${error.message}`);
    }
  }
}

// Run the test
if (require.main === module) {
  const tester = new WebMChunkMergeTester();
  
  tester.runCompleteTest()
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

module.exports = WebMChunkMergeTester;