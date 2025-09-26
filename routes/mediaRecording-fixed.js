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

module.exports = router;