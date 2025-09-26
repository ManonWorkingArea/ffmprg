#!/usr/bin/env node

/**
 * WebM Chunk Diagnostic Tool
 * Analyzes chunk files to identify issues with recording/upload process
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class ChunkDiagnostic {
  constructor(sessionId, basePath = '/var/www/app/uploads/media-recording/sessions') {
    this.sessionId = sessionId;
    this.basePath = basePath;
    this.sessionPath = path.join(basePath, sessionId);
    this.chunksPath = path.join(this.sessionPath, 'chunks');
  }
  
  /**
   * Run complete diagnostic
   */
  async runDiagnostic() {
    console.log('🔍 WebM Chunk Diagnostic Tool');
    console.log('=============================');
    console.log(`Session ID: ${this.sessionId}`);
    console.log(`Session Path: ${this.sessionPath}`);
    console.log('');
    
    try {
      // Step 1: Check directory structure
      await this.checkDirectoryStructure();
      
      // Step 2: Analyze session metadata
      await this.analyzeSessionMetadata();
      
      // Step 3: Analyze chunk files
      await this.analyzeChunkFiles();
      
      // Step 4: Run FFmpeg tests
      await this.testFFmpegCompatibility();
      
      console.log('\n🎯 Diagnostic Summary and Recommendations');
      console.log('==========================================');
      await this.generateRecommendations();
      
    } catch (error) {
      console.error(`❌ Diagnostic failed: ${error.message}`);
      console.error('Stack trace:', error.stack);
    }
  }
  
  /**
   * Check directory structure
   */
  async checkDirectoryStructure() {
    console.log('📁 Directory Structure Check');
    console.log('----------------------------');
    
    try {
      const sessionExists = await this.pathExists(this.sessionPath);
      const chunksExists = await this.pathExists(this.chunksPath);
      
      console.log(`Session directory: ${sessionExists ? '✅' : '❌'} ${this.sessionPath}`);
      console.log(`Chunks directory: ${chunksExists ? '✅' : '❌'} ${this.chunksPath}`);
      
      if (!sessionExists) {
        throw new Error('Session directory not found');
      }
      
      // List all files in session directory
      const sessionFiles = await fs.readdir(this.sessionPath);
      console.log(`\nSession files: ${sessionFiles.length} items`);
      sessionFiles.forEach(file => {
        console.log(`  - ${file}`);
      });
      
      if (chunksExists) {
        const chunkFiles = await fs.readdir(this.chunksPath);
        console.log(`\nChunk files: ${chunkFiles.length} items`);
        chunkFiles.forEach(file => {
          console.log(`  - ${file}`);
        });
      }
      
    } catch (error) {
      console.error(`❌ Directory check failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Analyze session metadata
   */
  async analyzeSessionMetadata() {
    console.log('\n📋 Session Metadata Analysis');
    console.log('-----------------------------');
    
    const metadataPath = path.join(this.sessionPath, 'session.json');
    
    try {
      const exists = await this.pathExists(metadataPath);
      if (!exists) {
        console.log('❌ session.json not found');
        return null;
      }
      
      const metadataContent = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(metadataContent);
      
      console.log('✅ Session metadata found');
      console.log(`Session ID: ${metadata.sessionId}`);
      console.log(`Status: ${metadata.status}`);
      console.log(`Created: ${metadata.createdAt}`);
      console.log(`Updated: ${metadata.updatedAt}`);
      console.log(`Total chunks: ${metadata.totalChunks}`);
      console.log(`Total size: ${(metadata.totalSize / 1024 / 1024).toFixed(2)}MB`);
      
      if (metadata.chunks && Array.isArray(metadata.chunks)) {
        console.log(`\nChunk metadata: ${metadata.chunks.length} entries`);
        metadata.chunks.forEach((chunk, index) => {
          console.log(`  ${index}: ${chunk.filename} (${(chunk.size / 1024 / 1024).toFixed(2)}MB, index: ${chunk.chunkIndex})`);
        });
      }
      
      if (metadata.videoProcessing) {
        console.log(`\nVideo processing: ${JSON.stringify(metadata.videoProcessing, null, 2)}`);
      }
      
      return metadata;
      
    } catch (error) {
      console.error(`❌ Metadata analysis failed: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Analyze chunk files in detail
   */
  async analyzeChunkFiles() {
    console.log('\n🎬 Chunk Files Analysis');
    console.log('------------------------');
    
    try {
      const chunksExist = await this.pathExists(this.chunksPath);
      if (!chunksExist) {
        console.log('❌ Chunks directory not found');
        return;
      }
      
      const chunkFiles = await fs.readdir(this.chunksPath);
      const webmFiles = chunkFiles.filter(f => f.endsWith('.webm'));
      
      console.log(`Found ${webmFiles.length} WebM files out of ${chunkFiles.length} total files`);
      
      if (webmFiles.length === 0) {
        console.log('❌ No WebM files found');
        return;
      }
      
      for (let i = 0; i < webmFiles.length; i++) {
        const filename = webmFiles[i];
        const filePath = path.join(this.chunksPath, filename);
        
        console.log(`\n📄 Analyzing: ${filename}`);
        console.log('   ' + '='.repeat(filename.length + 12));
        
        await this.analyzeChunkFile(filePath);
      }
      
    } catch (error) {
      console.error(`❌ Chunk analysis failed: ${error.message}`);
    }
  }
  
  /**
   * Analyze individual chunk file
   */
  async analyzeChunkFile(filePath) {
    try {
      // Basic file info
      const stats = await fs.stat(filePath);
      console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)}MB (${stats.size} bytes)`);
      console.log(`   Modified: ${stats.mtime.toISOString()}`);
      
      if (stats.size === 0) {
        console.log('   ❌ File is empty');
        return;
      }
      
      if (stats.size < 100) {
        console.log('   ❌ File is too small (likely corrupted)');
        return;
      }
      
      // Read file header
      const buffer = Buffer.alloc(256);
      const fileHandle = await fs.open(filePath, 'r');
      
      try {
        const { bytesRead } = await fileHandle.read(buffer, 0, 256, 0);
        console.log(`   Header bytes read: ${bytesRead}`);
        
        // Format detection
        const headerHex = buffer.slice(0, 32).toString('hex');
        const headerAscii = buffer.slice(0, 32).toString('ascii').replace(/[^\x20-\x7E]/g, '.');
        
        console.log(`   Header (hex): ${headerHex}`);
        console.log(`   Header (ascii): ${headerAscii}`);
        
        // WebM validation
        const ebmlSignature = Buffer.from([0x1A, 0x45, 0xDF, 0xA3]);
        const hasEBML = buffer.indexOf(ebmlSignature) !== -1;
        const hasWebM = buffer.toString('ascii').toLowerCase().includes('webm');
        const matroskaSignature = Buffer.from([0x42, 0x86]);
        const hasMatroska = buffer.indexOf(matroskaSignature) !== -1;
        
        console.log(`   EBML header: ${hasEBML ? '✅' : '❌'}`);
        console.log(`   WebM string: ${hasWebM ? '✅' : '❌'}`);
        console.log(`   Matroska signature: ${hasMatroska ? '✅' : '❌'}`);
        
        // Identify format if not WebM
        if (!hasEBML && !hasWebM && !hasMatroska) {
          const formatInfo = this.identifyFormat(buffer);
          console.log(`   ⚠️  Detected format: ${formatInfo}`);
        }
        
      } finally {
        await fileHandle.close();
      }
      
      // Try FFprobe analysis
      await this.ffprobeAnalysis(filePath);
      
    } catch (error) {
      console.error(`   ❌ Analysis error: ${error.message}`);
    }
  }
  
  /**
   * Try FFprobe on file
   */
  async ffprobeAnalysis(filePath) {
    try {
      console.log('   🔍 FFprobe analysis...');
      
      const command = `ffprobe -v quiet -show_entries format=format_name,duration,size,bit_rate -show_entries stream=codec_name,codec_type,width,height,avg_frame_rate -of json "${filePath}"`;
      const output = execSync(command, { encoding: 'utf8', timeout: 10000 });
      const data = JSON.parse(output);
      
      if (data.format) {
        console.log(`   ✅ Format: ${data.format.format_name}`);
        console.log(`   ✅ Duration: ${parseFloat(data.format.duration || 0).toFixed(2)}s`);
        console.log(`   ✅ Bitrate: ${Math.round((data.format.bit_rate || 0) / 1000)}kbps`);
      }
      
      if (data.streams && data.streams.length > 0) {
        data.streams.forEach((stream, index) => {
          console.log(`   Stream ${index}: ${stream.codec_type} (${stream.codec_name})`);
          if (stream.codec_type === 'video') {
            console.log(`   Resolution: ${stream.width}x${stream.height}`);
            console.log(`   Frame rate: ${stream.avg_frame_rate}`);
          }
        });
      }
      
    } catch (error) {
      console.error(`   ❌ FFprobe failed: ${error.message}`);
    }
  }
  
  /**
   * Test FFmpeg compatibility
   */
  async testFFmpegCompatibility() {
    console.log('\n🧪 FFmpeg Compatibility Test');
    console.log('-----------------------------');
    
    try {
      const chunksExist = await this.pathExists(this.chunksPath);
      if (!chunksExist) {
        console.log('❌ No chunks to test');
        return;
      }
      
      const chunkFiles = await fs.readdir(this.chunksPath);
      const webmFiles = chunkFiles.filter(f => f.endsWith('.webm')).slice(0, 2); // Test first 2 files
      
      if (webmFiles.length === 0) {
        console.log('❌ No WebM files to test');
        return;
      }
      
      console.log(`Testing ${webmFiles.length} chunk file(s)`);
      
      for (const filename of webmFiles) {
        const filePath = path.join(this.chunksPath, filename);
        console.log(`\n🎬 Testing: ${filename}`);
        
        try {
          // Test simple conversion
          const tempOutput = path.join(this.chunksPath, `test_${Date.now()}.mp4`);
          const convertCommand = `ffmpeg -i "${filePath}" -t 1 -c:v libx264 -crf 23 -y "${tempOutput}"`;
          
          console.log(`   Command: ${convertCommand}`);
          execSync(convertCommand, { timeout: 30000, stdio: 'pipe' });
          
          // Check if output was created
          const outputExists = await this.pathExists(tempOutput);
          if (outputExists) {
            const outputStats = await fs.stat(tempOutput);
            console.log(`   ✅ Conversion successful: ${outputStats.size} bytes`);
            
            // Clean up
            await fs.unlink(tempOutput);
          } else {
            console.log(`   ❌ Conversion failed: no output file created`);
          }
          
        } catch (ffmpegError) {
          console.log(`   ❌ FFmpeg test failed: ${ffmpegError.message}`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Compatibility test failed: ${error.message}`);
    }
  }
  
  /**
   * Generate recommendations
   */
  async generateRecommendations() {
    // This would analyze all the collected data and provide recommendations
    console.log('📋 Recommendations:');
    console.log('1. Check if MediaRecorder is properly configured to output WebM');
    console.log('2. Verify chunk upload process is not corrupting files');
    console.log('3. Ensure proper file permissions in upload directories');
    console.log('4. Consider adding chunk validation during upload');
    console.log('5. Implement chunk repair/re-upload mechanism');
  }
  
  /**
   * Identify file format from header
   */
  identifyFormat(buffer) {
    const header = buffer.slice(0, 16);
    
    if (header.slice(0, 4).toString('ascii') === 'ftyp') return 'MP4';
    if (header.slice(0, 3).toString('ascii') === 'GIF') return 'GIF';
    if (header.slice(0, 2).toString('hex') === 'ffd8') return 'JPEG';
    if (header.slice(0, 8).toString('ascii').includes('PNG')) return 'PNG';
    if (header.slice(0, 4).toString('ascii') === 'RIFF') return 'AVI/WAV';
    if (header.slice(0, 3).toString('ascii') === 'ID3') return 'MP3';
    
    return 'Unknown binary format';
  }
  
  /**
   * Check if path exists
   */
  async pathExists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}

// Command line usage
if (require.main === module) {
  const sessionId = process.argv[2];
  const basePath = process.argv[3];
  
  if (!sessionId) {
    console.log('Usage: node chunk-diagnostic.js <sessionId> [basePath]');
    console.log('Example: node chunk-diagnostic.js rec_1758887821007_iptk3h0wvo');
    console.log('Example: node chunk-diagnostic.js rec_1758887821007_iptk3h0wvo /var/www/app/uploads/media-recording/sessions');
    process.exit(1);
  }
  
  const diagnostic = new ChunkDiagnostic(sessionId, basePath);
  diagnostic.runDiagnostic().catch(console.error);
}

module.exports = ChunkDiagnostic;