/**
 * Fixed mergeVideoChunks function with proper duration handling
 * Using filter_complex for accurate concatenation
 */

const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');

async function mergeVideoChunksFixed(sessionId, sessionData, sessionsDir, outputPath) {
  try {
    const sessionDir = path.join(sessionsDir, sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    
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
        
        // Get duration with ffprobe
        const ffprobe = require('fluent-ffmpeg').ffprobe;
        const metadata = await new Promise((resolve, reject) => {
          ffprobe(chunkPath, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        
        const duration = parseFloat(metadata.format.duration) || 0;
        totalExpectedDuration += duration;
        
        chunkFiles.push({
          index: chunk.chunkIndex,
          path: chunkPath,
          filename: chunk.filename,
          size: stats.size,
          duration: duration
        });
        
        console.log(`✅ Chunk ${chunk.chunkIndex}: ${chunk.filename} (${duration.toFixed(2)}s, ${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
        
      } catch (error) {
        console.warn(`⚠️  Chunk ${chunk.chunkIndex} error: ${error.message}`);
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
    
    // Use filter_complex for proper concatenation
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const ffmpegCommand = ffmpeg();
      
      // Add all inputs
      chunkFiles.forEach((chunk) => {
        ffmpegCommand.input(chunk.path);
      });
      
      // Create concat filter
      ffmpegCommand
        .complexFilter([
          {
            filter: 'concat',
            options: {
              n: chunkFiles.length,
              v: 1,
              a: 0
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
          '-vsync', 'cfr',
          '-avoid_negative_ts', 'make_zero',
          '-max_muxing_queue_size', '9999'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`🚀 FFmpeg started`);
          console.log(`   Command: ${commandLine.substring(0, 200)}...`);
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

module.exports = { mergeVideoChunksFixed };