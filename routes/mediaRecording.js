const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

// Configure multer for chunk uploads with increased limits for 4K@60fps video
const upload = multer({ 
  dest: 'uploads/chunks/',
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB per chunk (for 4K@60fps chunks)
    fieldSize: 10 * 1024 * 1024,  // 10MB for metadata
    fields: 10, // Maximum number of fields
    files: 1    // Maximum number of files
  }
});

// Base directories for media recording storage - use absolute path to ensure consistency
const MEDIA_BASE_DIR = path.resolve(process.cwd(), 'uploads', 'media-recording');
const SESSIONS_DIR = path.resolve(MEDIA_BASE_DIR, 'sessions');

// Ensure base directories exist with proper error handling and permission checks
const initializeDirectories = async () => {
  try {
    // Check if we can write to the working directory first
    console.log(`🔍 Checking write permissions for: ${process.cwd()}`);
    
    // Create uploads directory first
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true, mode: 0o755 });
    console.log(`📁 Created/verified uploads directory: ${uploadsDir}`);
    
    // Create media-recording directory
    await fs.mkdir(MEDIA_BASE_DIR, { recursive: true, mode: 0o755 });
    console.log(`📁 Created/verified media-recording directory: ${MEDIA_BASE_DIR}`);
    
    // Create sessions directory
    await fs.mkdir(SESSIONS_DIR, { recursive: true, mode: 0o755 });
    console.log(`📁 Created/verified sessions directory: ${SESSIONS_DIR}`);
    
    // Verify directories were created and are accessible
    try {
      await fs.access(SESSIONS_DIR, fs.constants.R_OK | fs.constants.W_OK);
      console.log('✅ Media recording directories initialized successfully');
      console.log(`📍 Working directory: ${process.cwd()}`);
      console.log(`📍 Sessions directory: ${SESSIONS_DIR}`);
    } catch (accessError) {
      console.error('❌ Directory access verification failed:', accessError);
      throw accessError;
    }
    
  } catch (error) {
    // Provide detailed error information for debugging
    if (error.code === 'EACCES') {
      console.error('❌ Permission denied creating media recording directories');
      console.error(`   Working directory: ${process.cwd()}`);
      console.error(`   Target directory: ${SESSIONS_DIR}`);
      console.error(`   User: ${process.env.USER || 'unknown'}`);
      console.error(`   Process UID/GID: ${process.getuid?.() || 'unknown'}/${process.getgid?.() || 'unknown'}`);
    } else if (error.code === 'ENOSPC') {
      console.error('❌ Insufficient disk space for media recording directories');
    } else if (error.code === 'EROFS') {
      console.error('❌ File system is read-only, cannot create media recording directories');
    } else {
      console.error(`❌ Unexpected error creating media recording directories: ${error.message}`);
      console.error('Error details:', error);
    }
    
    throw new Error(`Failed to initialize media recording directories: ${error.message}`);
  }
};

// Global session store for active sessions
const activeSessions = new Map();
let directoryInitialized = false;

/**
 * Initialize directories when the module is first loaded
 */
const initializeOnce = async () => {
  if (!directoryInitialized) {
    await initializeDirectories();
    directoryInitialized = true;
    
    // Clean up any stale upload files on startup
    try {
      const uploadsDir = path.resolve(process.cwd(), 'uploads', 'chunks');
      const files = await fs.readdir(uploadsDir).catch(() => []);
      
      if (files.length > 0) {
        console.log(`🧹 Cleaning up ${files.length} stale chunk files from previous session`);
        await Promise.allSettled(
          files.map(file => fs.unlink(path.join(uploadsDir, file)))
        );
        console.log('✅ Stale chunk cleanup completed');
      }
    } catch (error) {
      console.warn('⚠️  Could not clean up stale chunks:', error.message);
    }
  }
};

/**
 * Validate chunk file integrity and get metadata
 */
async function validateChunkFile(chunkPath) {
  try {
    // Check file exists and get stats
    const stats = await fs.stat(chunkPath);
    
    if (stats.size === 0) {
      return { isValid: false, error: 'File is empty' };
    }
    
    if (stats.size < 100) {
      return { isValid: false, error: `File too small (${stats.size} bytes)` };
    }
    
    // Read file header for format validation
    const buffer = Buffer.alloc(128);
    const fileHandle = await fs.open(chunkPath, 'r');
    
    try {
      await fileHandle.read(buffer, 0, 128, 0);
    } finally {
      await fileHandle.close();
    }
    
    // Check for WebM signature
    const isWebM = buffer.slice(0, 4).toString('hex') === '1a45dfa3';
    
    if (!isWebM) {
      return { 
        isValid: false, 
        error: 'Not a valid WebM file (missing EBML header)' 
      };
    }
    
    // Use ffprobe to get detailed metadata
    const ffprobe = require('fluent-ffmpeg').ffprobe;
    const metadata = await new Promise((resolve, reject) => {
      ffprobe(chunkPath, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    
    const videoStream = metadata.streams.find(s => s.codec_type === 'video');
    
    if (!videoStream) {
      return { 
        isValid: false, 
        error: 'No video stream found in file' 
      };
    }
    
    return {
      isValid: true,
      duration: parseFloat(metadata.format.duration) || 0,
      format: metadata.format.format_name || 'unknown',
      codec: videoStream.codec_name || 'unknown',
      resolution: `${videoStream.width}x${videoStream.height}`,
      bitrate: parseInt(metadata.format.bit_rate) || 0,
      size: stats.size
    };
    
  } catch (error) {
    return { 
      isValid: false, 
      error: `Validation failed: ${error.message}` 
    };
  }
}

/**
 * Enhanced video merging with accurate duration handling
 */
/**
 * Wait for chunks to arrive with retry mechanism
 * Handles race condition where finalize is called before all chunks arrive
 */
async function waitForChunks(sessionId, expectedChunks, maxWaitSeconds = 30) {
  const sessionsDir = global.MEDIA_FALLBACK_DIR || SESSIONS_DIR;
  const chunksDir = path.join(sessionsDir, sessionId, 'chunks');
  
  console.log(`⏳ Waiting for chunks: ${expectedChunks} expected, max wait: ${maxWaitSeconds}s`);
  
  const startTime = Date.now();
  const checkInterval = 1000; // Check every 1 second
  let attempts = 0;
  const maxAttempts = Math.ceil(maxWaitSeconds * 1000 / checkInterval);
  
  while (attempts < maxAttempts) {
    try {
      // Check current chunk count
      const files = await fs.readdir(chunksDir);
      const webmFiles = files.filter(file => file.endsWith('.webm'));
      const currentCount = webmFiles.length;
      
      console.log(`🔍 Attempt ${attempts + 1}: Found ${currentCount}/${expectedChunks} chunks`);
      
      if (currentCount >= expectedChunks) {
        const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ All chunks ready after ${elapsedSeconds}s`);
        return {
          success: true,
          actualChunks: currentCount,
          expectedChunks: expectedChunks,
          waitTimeSeconds: parseFloat(elapsedSeconds)
        };
      }
      
      // Show progress every 5 seconds
      if (attempts % 5 === 0 && attempts > 0) {
        const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`⌛ Still waiting... ${currentCount}/${expectedChunks} chunks after ${elapsedSeconds}s`);
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      
    } catch (error) {
      console.warn(`⚠️  Error checking chunks: ${error.message}`);
      
      // If directory doesn't exist, return early
      if (error.code === 'ENOENT') {
        return {
          success: false,
          actualChunks: 0,
          expectedChunks: expectedChunks,
          message: 'Chunks directory not found'
        };
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }
  
  // Timeout reached - get final count
  try {
    const files = await fs.readdir(chunksDir);
    const webmFiles = files.filter(file => file.endsWith('.webm'));
    const finalCount = webmFiles.length;
    
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`⏰ Timeout reached after ${elapsedSeconds}s: ${finalCount}/${expectedChunks} chunks`);
    
    return {
      success: finalCount >= expectedChunks,
      actualChunks: finalCount,
      expectedChunks: expectedChunks,
      message: `Timeout: Only ${finalCount}/${expectedChunks} chunks received after ${elapsedSeconds}s`,
      waitTimeSeconds: parseFloat(elapsedSeconds)
    };
    
  } catch (error) {
    return {
      success: false,
      actualChunks: 0,
      expectedChunks: expectedChunks,
      message: `Error during final chunk count: ${error.message}`
    };
  }
}

/**
 * Enhanced merge function with WebM duration fixes
 * Addresses specific WebM timestamp and duration issues
 */
async function mergeVideoChunksWithWebMFix(sessionId, sessionData) {
  try {
    const sessionsDir = global.MEDIA_FALLBACK_DIR || SESSIONS_DIR;
    const sessionDir = path.join(sessionsDir, sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    const outputPath = path.join(sessionDir, `${sessionId}_final.mp4`);
    
    console.log(`🎬 Starting WebM-optimized merge for session: ${sessionId}`);
    console.log(`📁 Chunks directory: ${chunksDir}`);
    console.log(`📤 Output file: ${outputPath}`);
    
    // Validate and analyze chunk files
    const chunkFiles = [];
    let totalExpectedDuration = 0;
    let hasTimestampIssues = false;
    
    for (const chunk of sessionData.chunks) {
      const chunkPath = path.join(chunksDir, chunk.filename);
      
      try {
        await fs.access(chunkPath);
        const stats = await fs.stat(chunkPath);
        
        if (stats.size < 1000) { // Minimum 1KB for valid WebM
          console.warn(`⚠️  Chunk ${chunk.chunkIndex} too small: ${stats.size} bytes, skipping`);
          continue;
        }
        
        console.log(`📋 Analyzing WebM chunk ${chunk.chunkIndex}: ${chunk.filename}`);
        
        // Get detailed WebM info with ffprobe
        let chunkInfo = {};
        try {
          const ffprobe = require('fluent-ffmpeg').ffprobe;
          const metadata = await new Promise((resolve, reject) => {
            ffprobe(chunkPath, (err, data) => {
              if (err) reject(err);
              else resolve(data);
            });
          });
          
          chunkInfo = {
            duration: parseFloat(metadata.format.duration) || 0,
            startTime: parseFloat(metadata.format.start_time) || 0,
            bitrate: parseInt(metadata.format.bit_rate) || 0,
            hasVideo: metadata.streams.some(s => s.codec_type === 'video'),
            videoCodec: metadata.streams.find(s => s.codec_type === 'video')?.codec_name || 'unknown',
            resolution: metadata.streams.find(s => s.codec_type === 'video') ? 
              `${metadata.streams.find(s => s.codec_type === 'video').width}x${metadata.streams.find(s => s.codec_type === 'video').height}` : 'unknown'
          };
          
          // Check for timestamp issues common in WebM
          if (chunkInfo.startTime < 0 || (chunkInfo.startTime > 0 && chunk.chunkIndex === 0)) {
            hasTimestampIssues = true;
            console.log(`⚠️  Timestamp issue detected in chunk ${chunk.chunkIndex}: start_time=${chunkInfo.startTime}`);
          }
          
        } catch (probeError) {
          console.warn(`⚠️  Could not probe chunk ${chunk.chunkIndex}: ${probeError.message}`);
          chunkInfo = {
            duration: 0,
            startTime: 0,
            bitrate: 0,
            hasVideo: true,
            videoCodec: 'webm',
            resolution: 'unknown'
          };
        }
        
        totalExpectedDuration += chunkInfo.duration;
        
        chunkFiles.push({
          index: chunk.chunkIndex,
          path: chunkPath,
          filename: chunk.filename,
          size: stats.size,
          ...chunkInfo
        });
        
        console.log(`✅ Chunk ${chunk.chunkIndex}: ${chunkInfo.videoCodec} ${chunkInfo.resolution} (${chunkInfo.duration.toFixed(2)}s)`);
        
      } catch (error) {
        console.warn(`⚠️  Error processing chunk ${chunk.chunkIndex}: ${error.message}`);
      }
    }
    
    if (chunkFiles.length === 0) {
      throw new Error('No valid WebM chunk files found after analysis');
    }
    
    // Sort by index
    chunkFiles.sort((a, b) => a.index - b.index);
    
    console.log(`📊 WebM Analysis Summary:`);
    console.log(`   Valid chunks: ${chunkFiles.length}/${sessionData.chunks.length}`);
    console.log(`   Expected duration: ${totalExpectedDuration.toFixed(2)}s`);
    console.log(`   Total size: ${(chunkFiles.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   Timestamp issues: ${hasTimestampIssues ? 'YES (will fix)' : 'NO'}`);
    
    // Use optimized FFmpeg strategy for WebM
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const ffmpegCommand = ffmpeg();
      
      // Add all inputs
      chunkFiles.forEach((chunk) => {
        ffmpegCommand.input(chunk.path);
      });
      
      // WebM-optimized concat strategy
      const concatFilter = {
        filter: 'concat',
        options: {
          n: chunkFiles.length,
          v: 1,
          a: 0,
          unsafe: 1  // Allow different timestamps/formats
        },
        inputs: chunkFiles.map((_, index) => `${index}:v`),
        outputs: 'concatenated'
      };
      
      // Add timestamp fixing filter if needed
      if (hasTimestampIssues) {
        console.log(`🔧 Applying WebM timestamp fixes...`);
        ffmpegCommand
          .complexFilter([
            concatFilter,
            // Fix timestamp discontinuities
            {
              filter: 'setpts',
              options: 'PTS-STARTPTS', // Reset PTS to start from 0
              inputs: '[concatenated]',
              outputs: 'fixed_pts'
            }
          ])
          .outputOptions([
            '-map', '[fixed_pts]',
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-movflags', 'faststart',
            '-vsync', 'cfr',              // Force constant frame rate
            '-r', '30',                   // Explicit frame rate
            '-avoid_negative_ts', 'make_zero',
            '-fflags', '+genpts',         // Generate new PTS
            '-max_muxing_queue_size', '9999'
          ]);
      } else {
        console.log(`🚀 Using standard WebM concatenation (no timestamp issues)...`);
        ffmpegCommand
          .complexFilter([concatFilter])
          .outputOptions([
            '-map', '[concatenated]',
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-movflags', 'faststart',
            '-vsync', 'cfr',
            '-avoid_negative_ts', 'make_zero',
            '-fflags', '+genpts',
            '-max_muxing_queue_size', '9999'
          ]);
      }
      
      ffmpegCommand
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`🚀 FFmpeg started with WebM optimization`);
          console.log(`   Expected duration: ${totalExpectedDuration.toFixed(2)}s`);
          console.log(`   Timestamp fixes: ${hasTimestampIssues ? 'enabled' : 'disabled'}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⏳ Progress: ${Math.round(progress.percent)}% (${progress.timemark || 'N/A'})`);
          }
        })
        .on('end', async () => {
          const endTime = Date.now();
          const processingTime = ((endTime - startTime) / 1000).toFixed(2);
          
          try {
            const stats = await fs.stat(outputPath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            
            // Verify actual duration
            let actualDuration = 0;
            try {
              const ffprobe = require('fluent-ffmpeg').ffprobe;
              const metadata = await new Promise((resolve, reject) => {
                ffprobe(outputPath, (err, data) => {
                  if (err) reject(err);
                  else resolve(data);
                });
              });
              actualDuration = parseFloat(metadata.format.duration) || 0;
            } catch (probeError) {
              console.warn(`⚠️  Could not verify final duration: ${probeError.message}`);
            }
            
            console.log(`✅ WebM merge completed in ${processingTime}s`);
            console.log(`📊 Final video: ${sizeMB}MB`);
            console.log(`⏱️  Expected: ${totalExpectedDuration.toFixed(2)}s, Actual: ${actualDuration.toFixed(2)}s`);
            
            const durationDiff = Math.abs(actualDuration - totalExpectedDuration);
            if (durationDiff > 2) {
              console.log(`⚠️  Duration difference: ${durationDiff.toFixed(2)}s (may indicate missing chunks)`);
            } else {
              console.log(`✅ Duration accuracy: ${durationDiff.toFixed(2)}s difference`);
            }
            
            resolve({
              success: true,
              outputPath,
              sizeMB: parseFloat(sizeMB),
              duration: parseFloat(processingTime),
              chunksProcessed: chunkFiles.length,
              expectedDuration: totalExpectedDuration,
              actualDuration: actualDuration,
              timestampFixed: hasTimestampIssues,
              durationAccuracy: durationDiff < 2 ? 'good' : 'poor'
            });
            
          } catch (statError) {
            reject(new Error(`Failed to verify output: ${statError.message}`));
          }
        })
        .on('error', (error) => {
          console.error(`❌ FFmpeg error: ${error.message}`);
          console.error(`📊 Context: ${chunkFiles.length} WebM chunks, expected ${totalExpectedDuration.toFixed(2)}s`);
          reject(new Error(`WebM merge failed: ${error.message}`));
        })
        .run();
    });
    
  } catch (error) {
    console.error(`❌ Error in mergeVideoChunksWithWebMFix: ${error.message}`);
    throw error;
  }
}

async function mergeVideoChunks(sessionId, sessionData) {
  try {
    const sessionsDir = global.MEDIA_FALLBACK_DIR || SESSIONS_DIR;
    const sessionDir = path.join(sessionsDir, sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    const outputPath = path.join(sessionDir, `${sessionId}_final.mp4`);
    
    console.log(`🎬 Starting video merge for session: ${sessionId}`);
    console.log(`📁 Chunks directory: ${chunksDir}`);
    console.log(`📤 Output file: ${outputPath}`);
    
    // Validate chunk files exist and get their info
    const chunkFiles = [];
    let totalExpectedDuration = 0;
    
    for (const chunk of sessionData.chunks) {
      const chunkPath = path.join(chunksDir, chunk.filename);
      
      try {
        await fs.access(chunkPath);
        const stats = await fs.stat(chunkPath);
        
        if (stats.size < 100) {
          console.warn(`⚠️  Chunk ${chunk.chunkIndex} too small: ${stats.size} bytes`);
          continue;
        }
        
        console.log(`📋 Validating chunk ${chunk.chunkIndex}: ${chunk.filename}`);
        const validationResult = await validateChunkFile(chunkPath);
        
        if (validationResult.isValid) {
          const duration = validationResult.duration || 0;
          totalExpectedDuration += duration;
          
          chunkFiles.push({
            index: chunk.chunkIndex,
            path: chunkPath,
            filename: chunk.filename,
            size: stats.size,
            duration: duration,
            format: validationResult.format,
            codec: validationResult.codec,
            resolution: validationResult.resolution
          });
          
          console.log(`✅ Chunk ${chunk.chunkIndex}: ${validationResult.format} ${validationResult.resolution} (${duration.toFixed(2)}s, ${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
        } else {
          console.warn(`❌ Chunk ${chunk.chunkIndex} validation failed: ${validationResult.error}`);
        }
        
      } catch (error) {
        console.warn(`⚠️  Error accessing chunk ${chunk.chunkIndex}: ${error.message}`);
      }
    }
    
    if (chunkFiles.length === 0) {
      throw new Error('No valid chunk files found');
    }
    
    // Sort by index
    chunkFiles.sort((a, b) => a.index - b.index);
    
    console.log(`📊 Processing ${chunkFiles.length}/${sessionData.chunks.length} valid chunks`);
    console.log(`⏱️  Expected total duration: ${totalExpectedDuration.toFixed(2)}s`);
    console.log(`📦 Total size: ${(chunkFiles.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(2)}MB`);
    
    // Use filter_complex for proper concatenation with accurate duration
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const ffmpegCommand = ffmpeg();
      
      // Add all inputs
      chunkFiles.forEach((chunk) => {
        ffmpegCommand.input(chunk.path);
      });
      
      // Create concat filter with proper options for duration accuracy
      ffmpegCommand
        .complexFilter([
          {
            filter: 'concat',
            options: {
              n: chunkFiles.length,
              v: 1,
              a: 0,
              unsafe: 1  // Allow different formats/timestamps
            },
            inputs: chunkFiles.map((_, index) => `${index}:v`),
            outputs: 'concatenated'
          }
        ])
        .outputOptions([
          '-map', '[concatenated]',
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-movflags', 'faststart',
          '-vsync', 'cfr',              // Constant frame rate for duration accuracy
          '-avoid_negative_ts', 'make_zero',
          '-fflags', '+genpts',         // Generate presentation timestamps
          '-max_muxing_queue_size', '9999'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`🚀 FFmpeg started with filter_complex`);
          console.log(`   Expected duration: ${totalExpectedDuration.toFixed(2)}s`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⏳ Progress: ${Math.round(progress.percent)}% (${progress.timemark || 'N/A'})`);
          }
        })
        .on('end', async () => {
          const endTime = Date.now();
          const processingTime = ((endTime - startTime) / 1000).toFixed(2);
          
          try {
            const stats = await fs.stat(outputPath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            
            // Verify actual duration
            let actualDuration = 0;
            try {
              const ffprobe = require('fluent-ffmpeg').ffprobe;
              const metadata = await new Promise((resolve, reject) => {
                ffprobe(outputPath, (err, data) => {
                  if (err) reject(err);
                  else resolve(data);
                });
              });
              actualDuration = parseFloat(metadata.format.duration) || 0;
            } catch (probeError) {
              console.warn(`⚠️  Could not verify final duration: ${probeError.message}`);
            }
            
            console.log(`✅ Video merge completed in ${processingTime}s`);
            console.log(`📊 Final video: ${sizeMB}MB`);
            console.log(`⏱️  Expected: ${totalExpectedDuration.toFixed(2)}s, Actual: ${actualDuration.toFixed(2)}s`);
            
            const durationDiff = Math.abs(actualDuration - totalExpectedDuration);
            if (durationDiff > 2) {
              console.log(`⚠️  Significant duration difference: ${durationDiff.toFixed(2)}s`);
              console.log(`   This might indicate timing issues with some chunks`);
            } else {
              console.log(`✅ Duration verification passed (diff: ${durationDiff.toFixed(2)}s)`);
            }
            
            resolve({
              success: true,
              outputPath,
              sizeMB: parseFloat(sizeMB),
              duration: parseFloat(processingTime),
              chunksProcessed: chunkFiles.length,
              expectedDuration: totalExpectedDuration,
              actualDuration: actualDuration
            });
            
          } catch (statError) {
            reject(new Error(`Failed to verify output: ${statError.message}`));
          }
        })
        .on('error', (error) => {
          console.error(`❌ FFmpeg error: ${error.message}`);
          console.error(`📊 Context: ${chunkFiles.length} chunks, expected ${totalExpectedDuration.toFixed(2)}s`);
          reject(new Error(`Video merge failed: ${error.message}`));
        })
        .run();
    });
    
  } catch (error) {
    console.error(`❌ Error in mergeVideoChunks: ${error.message}`);
    throw error;
  }
}

/**
 * Clean up chunk files after successful merge
 */
async function cleanupChunkFiles(sessionId, sessionData) {
  try {
    const sessionsDir = global.MEDIA_FALLBACK_DIR || SESSIONS_DIR;
    const sessionDir = path.join(sessionsDir, sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    
    console.log(`🧹 Starting cleanup for session: ${sessionId}`);
    
    let deletedFiles = 0;
    let totalSizeFreed = 0;
    
    for (const chunk of sessionData.chunks) {
      const chunkPath = path.join(chunksDir, chunk.filename);
      
      try {
        const stats = await fs.stat(chunkPath);
        totalSizeFreed += stats.size;
        
        await fs.unlink(chunkPath);
        deletedFiles++;
        
        console.log(`🗑️  Deleted chunk: ${chunk.filename} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
        
      } catch (error) {
        console.warn(`⚠️  Could not delete chunk ${chunk.filename}: ${error.message}`);
      }
    }
    
    // Try to remove chunks directory if empty
    try {
      await fs.rmdir(chunksDir);
      console.log(`🗑️  Removed empty chunks directory`);
    } catch (error) {
      // Ignore - directory might not be empty or might not exist
    }
    
    console.log(`✅ Cleanup completed: ${deletedFiles} files deleted, ${(totalSizeFreed / 1024 / 1024).toFixed(2)}MB freed`);
    
    return {
      deletedFiles,
      totalSizeFreed,
      success: true
    };
    
  } catch (error) {
    console.error(`❌ Cleanup error: ${error.message}`);
    return {
      deletedFiles: 0,
      totalSizeFreed: 0,
      success: false,
      error: error.message
    };
  }
}

// Routes will be added here (placeholder - need to add the actual routes from the original file)
// This is just the essential functions for the duration fix

// Initialize on first request
router.use(async (req, res, next) => {
  try {
    await initializeOnce();
    next();
  } catch (error) {
    console.error(`❌ Failed to initialize media recording directories: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize media recording system',
      details: error.message
    });
  }
});

/**
 * Finalize recording session and merge video chunks
 * POST /recording/finalize
 */
router.post('/recording/finalize', async (req, res) => {
  console.log('🎯 Processing video finalization...');
  try {
    const { sessionId, totalChunks, totalSize, chunks: clientChunks, maxWaitSeconds = 30 } = req.body;
    
    // Validate required fields
    if (!sessionId || totalChunks === undefined) {
      return res.status(400).json({
        success: false,
        error: 'sessionId and totalChunks are required'
      });
    }
    
    console.log(`🎬 Starting finalization for session: ${sessionId}`);
    console.log(`📊 Expected: ${totalChunks} chunks, ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
    
    const sessionsDir = global.MEDIA_FALLBACK_DIR || SESSIONS_DIR;
    const sessionDir = path.join(sessionsDir, sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    
    // Wait for chunks to arrive with retry mechanism
    const waitResult = await waitForChunks(sessionId, totalChunks, maxWaitSeconds);
    
    if (!waitResult.success) {
      console.warn(`⚠️  Chunk waiting failed: ${waitResult.message}`);
      console.log(`📊 Found ${waitResult.actualChunks}/${totalChunks} chunks`);
      
      // Option 1: Proceed with available chunks (partial merge)
      if (waitResult.actualChunks > 0) {
        console.log(`🔄 Proceeding with partial merge (${waitResult.actualChunks} chunks)`);
      } else {
        return res.status(400).json({
          success: false,
          error: 'No chunks available for merging',
          details: waitResult.message,
          sessionId
        });
      }
    } else {
      console.log(`✅ All chunks ready: ${waitResult.actualChunks}/${totalChunks}`);
    }
    
    // Load session data with actual chunks found
    let sessionData = activeSessions.get(sessionId) || {};
    
    try {
      await fs.access(sessionDir);
      console.log(`📁 Found session directory: ${sessionDir}`);
      
      // Get actual chunk files from directory with enhanced sorting
      const chunkFiles = await fs.readdir(chunksDir);
      const actualChunks = chunkFiles
        .filter(file => file.endsWith('.webm'))
        .map((filename) => {
          // Extract chunk number from filename
          const chunkMatch = filename.match(/chunk-(\d+)/) || filename.match(/(\d+)/);
          const chunkIndex = chunkMatch ? parseInt(chunkMatch[1]) : 999999;
          
          return {
            chunkIndex: chunkIndex,
            filename: filename,
            timestamp: Date.now()
          };
        })
        .sort((a, b) => a.chunkIndex - b.chunkIndex); // Sort by actual chunk number
      
      sessionData = {
        ...sessionData,
        sessionId: sessionId,
        status: 'finalizing',
        chunks: actualChunks,
        totalChunks: actualChunks.length,
        expectedChunks: totalChunks,
        directories: { sessionDir, chunksDir }
      };
      
      console.log(`✅ Found ${actualChunks.length} chunk files (expected ${totalChunks})`);
      
      // Log chunk sequence for debugging
      if (actualChunks.length < totalChunks) {
        const foundIndices = actualChunks.map(c => c.chunkIndex).sort((a, b) => a - b);
        const missingIndices = [];
        for (let i = 0; i < totalChunks; i++) {
          if (!foundIndices.includes(i)) {
            missingIndices.push(i);
          }
        }
        console.log(`⚠️  Missing chunk indices: [${missingIndices.join(', ')}]`);
      }
      
    } catch (dirError) {
      console.error(`❌ Session directory not found: ${sessionDir}`);
      return res.status(404).json({
        success: false,
        error: 'Session directory not found',
        sessionId
      });
    }
    
    if (!sessionData.chunks || sessionData.chunks.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No chunks found to merge',
        sessionId
      });
    }
    
    console.log(`🔀 Starting video merge for ${sessionData.chunks.length} chunks...`);
    
    try {
      // Use enhanced merge function that handles WebM duration issues
      const mergeResult = await mergeVideoChunksWithWebMFix(sessionId, sessionData);
      
      console.log(`✅ Video merge completed successfully!`);
      console.log(`📊 Final video: ${mergeResult.sizeMB}MB, ${mergeResult.actualDuration.toFixed(2)}s`);
      console.log(`⏱️  Expected vs Actual duration: ${mergeResult.expectedDuration.toFixed(2)}s vs ${mergeResult.actualDuration.toFixed(2)}s`);
      
      // Update session data
      sessionData.status = 'completed';
      sessionData.finalizedAt = new Date().toISOString();
      sessionData.mergeResult = mergeResult;
      activeSessions.set(sessionId, sessionData);
      
      // Optionally cleanup chunks after successful merge
      const cleanup = await cleanupChunkFiles(sessionId, sessionData);
      
      res.json({
        success: true,
        sessionId: sessionId,
        message: 'Video finalized and merged successfully',
        warnings: sessionData.chunks.length < totalChunks ? [`Only ${sessionData.chunks.length}/${totalChunks} chunks were available`] : [],
        video: {
          filename: `${sessionId}_final.mp4`,
          sizeMB: mergeResult.sizeMB,
          expectedDuration: mergeResult.expectedDuration,
          actualDuration: mergeResult.actualDuration,
          durationAccuracy: Math.abs(mergeResult.actualDuration - mergeResult.expectedDuration) < 2 ? 'good' : 'poor',
          chunksProcessed: mergeResult.chunksProcessed
        },
        cleanup: cleanup
      });
      
    } catch (mergeError) {
      console.error(`❌ Video merge failed: ${mergeError.message}`);
      
      res.status(500).json({
        success: false,
        error: 'Video merge failed',
        details: mergeError.message,
        sessionId
      });
    }
    
  } catch (error) {
    console.error(`❌ Finalization error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Finalization failed',
      details: error.message
    });
  }
});

/**
 * Get session video file
 * GET /session/:sessionId/video
 */
router.get('/session/:sessionId/video', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionsDir = global.MEDIA_FALLBACK_DIR || SESSIONS_DIR;
    const videoPath = path.join(sessionsDir, sessionId, `${sessionId}_final.mp4`);
    
    // Check if video file exists
    try {
      await fs.access(videoPath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: 'Video file not found',
        sessionId
      });
    }
    
    // Get file stats for headers
    const stats = await fs.stat(videoPath);
    
    // Set appropriate headers
    res.set({
      'Content-Type': 'video/mp4',
      'Content-Length': stats.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400' // Cache for 1 day
    });
    
    // Stream the video file
    const videoStream = require('fs').createReadStream(videoPath);
    videoStream.pipe(res);
    
  } catch (error) {
    console.error(`❌ Error serving video: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to serve video file',
      details: error.message
    });
  }
});

/**
 * Check chunks status for a session (useful for debugging race conditions)
 * GET /session/:sessionId/chunks/status
 */
router.get('/session/:sessionId/chunks/status', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { expectedChunks } = req.query;
    
    const sessionsDir = global.MEDIA_FALLBACK_DIR || SESSIONS_DIR;
    const chunksDir = path.join(sessionsDir, sessionId, 'chunks');
    
    try {
      // Get current chunks
      const files = await fs.readdir(chunksDir);
      const webmFiles = files.filter(file => file.endsWith('.webm'));
      
      // Analyze chunk details
      const chunkDetails = [];
      for (const filename of webmFiles) {
        const filePath = path.join(chunksDir, filename);
        const stats = await fs.stat(filePath);
        
        // Extract chunk number
        const chunkMatch = filename.match(/chunk-(\d+)/) || filename.match(/(\d+)/);
        const chunkIndex = chunkMatch ? parseInt(chunkMatch[1]) : -1;
        
        chunkDetails.push({
          filename,
          chunkIndex,
          sizeMB: (stats.size / 1024 / 1024).toFixed(2),
          modifiedAt: stats.mtime.toISOString()
        });
      }
      
      // Sort by chunk index
      chunkDetails.sort((a, b) => a.chunkIndex - b.chunkIndex);
      
      // Find missing chunks if expected count is provided
      let missingChunks = [];
      if (expectedChunks) {
        const expectedCount = parseInt(expectedChunks);
        const foundIndices = chunkDetails.map(c => c.chunkIndex).filter(i => i >= 0);
        
        for (let i = 0; i < expectedCount; i++) {
          if (!foundIndices.includes(i)) {
            missingChunks.push(i);
          }
        }
      }
      
      const status = {
        sessionId,
        chunksFound: webmFiles.length,
        expectedChunks: expectedChunks ? parseInt(expectedChunks) : null,
        isComplete: expectedChunks ? webmFiles.length >= parseInt(expectedChunks) : null,
        missingChunks,
        totalSizeMB: chunkDetails.reduce((sum, c) => sum + parseFloat(c.sizeMB), 0).toFixed(2),
        chunks: chunkDetails,
        lastModified: chunkDetails.length > 0 ? 
          Math.max(...chunkDetails.map(c => new Date(c.modifiedAt).getTime())) : null
      };
      
      res.json(status);
      
    } catch (dirError) {
      res.status(404).json({
        success: false,
        error: 'Session chunks directory not found',
        sessionId
      });
    }
    
  } catch (error) {
    console.error(`❌ Error checking chunks status: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to check chunks status',
      details: error.message
    });
  }
});

/**
 * Health check endpoint
 * GET /status
 */
/**
 * Asynchronous finalize endpoint - starts processing immediately, returns job ID
 * POST /recording/finalize-async
 */
router.post('/recording/finalize-async', async (req, res) => {
  const { sessionId, totalChunks, totalSize, chunks: clientChunks } = req.body;
  
  // Validate required fields
  if (!sessionId || totalChunks === undefined) {
    return res.status(400).json({
      success: false,
      error: 'sessionId and totalChunks are required'
    });
  }
  
  const jobId = `${sessionId}_${Date.now()}`;
  
  console.log(`🚀 Starting async finalization job: ${jobId}`);
  
  // Return immediately with job ID
  res.json({
    success: true,
    jobId,
    sessionId,
    status: 'processing',
    message: 'Finalization job started, check status with /recording/job/:jobId'
  });
  
  // Process in background
  (async () => {
    try {
      console.log(`🎬 Background processing for job: ${jobId}`);
      
      // Wait for chunks with extended timeout for async processing
      const waitResult = await waitForChunks(sessionId, totalChunks, 60); // 60 second timeout
      
      if (!waitResult.success && waitResult.actualChunks === 0) {
        console.error(`❌ Job ${jobId} failed: No chunks found`);
        // Store job result in memory (in production, use database)
        global.finalizationJobs = global.finalizationJobs || new Map();
        global.finalizationJobs.set(jobId, {
          status: 'failed',
          error: 'No chunks found',
          completedAt: new Date().toISOString()
        });
        return;
      }
      
      // Load session data
      const sessionsDir = global.MEDIA_FALLBACK_DIR || SESSIONS_DIR;
      const sessionDir = path.join(sessionsDir, sessionId);
      const chunksDir = path.join(sessionDir, 'chunks');
      
      const chunkFiles = await fs.readdir(chunksDir);
      const actualChunks = chunkFiles
        .filter(file => file.endsWith('.webm'))
        .map((filename) => {
          const chunkMatch = filename.match(/chunk-(\d+)/) || filename.match(/(\d+)/);
          const chunkIndex = chunkMatch ? parseInt(chunkMatch[1]) : 999999;
          return {
            chunkIndex: chunkIndex,
            filename: filename,
            timestamp: Date.now()
          };
        })
        .sort((a, b) => a.chunkIndex - b.chunkIndex);
      
      const sessionData = {
        sessionId: sessionId,
        status: 'finalizing',
        chunks: actualChunks,
        totalChunks: actualChunks.length,
        expectedChunks: totalChunks,
        directories: { sessionDir, chunksDir }
      };
      
      // Merge video
      const mergeResult = await mergeVideoChunksWithWebMFix(sessionId, sessionData);
      
      console.log(`✅ Job ${jobId} completed successfully`);
      
      // Store success result
      global.finalizationJobs = global.finalizationJobs || new Map();
      global.finalizationJobs.set(jobId, {
        status: 'completed',
        sessionId,
        result: mergeResult,
        completedAt: new Date().toISOString()
      });
      
    } catch (error) {
      console.error(`❌ Job ${jobId} failed: ${error.message}`);
      
      // Store error result
      global.finalizationJobs = global.finalizationJobs || new Map();
      global.finalizationJobs.set(jobId, {
        status: 'failed',
        sessionId,
        error: error.message,
        completedAt: new Date().toISOString()
      });
    }
  })();
});

/**
 * Check finalization job status
 * GET /recording/job/:jobId
 */
router.get('/recording/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    global.finalizationJobs = global.finalizationJobs || new Map();
    const jobResult = global.finalizationJobs.get(jobId);
    
    if (!jobResult) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
        jobId
      });
    }
    
    res.json({
      success: true,
      jobId,
      ...jobResult
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get job status',
      details: error.message
    });
  }
});

router.get('/status', async (req, res) => {
  try {
    const stats = {
      status: 'healthy',
      activeSessions: activeSessions.size,
      directories: {
        base: MEDIA_BASE_DIR,
        sessions: SESSIONS_DIR
      },
      timestamp: new Date().toISOString()
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

console.log('🎬 Enhanced Media Recording routes loaded:');
console.log('  - POST /recording/finalize (synchronous with chunk waiting)');
console.log('  - POST /recording/finalize-async (asynchronous background processing)');
console.log('  - GET  /recording/job/:jobId (check async job status)');
console.log('  - GET  /session/:sessionId/chunks/status (check chunks availability)');
console.log('  - GET  /session/:sessionId/video (download final video)');
console.log('  - GET  /status (health check)');
console.log('');
console.log('🔧 WebM Duration Fix Features:');
console.log('  ✅ Chunk waiting system (prevents race conditions)');
console.log('  ✅ WebM timestamp fixing (handles negative/discontinuous timestamps)');
console.log('  ✅ Enhanced duration verification');
console.log('  ✅ Async processing option (non-blocking finalization)');
console.log('  ✅ Missing chunk detection and reporting');

module.exports = router;