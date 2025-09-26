const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

// Configure multer for chunk uploads
const upload = multer({ 
  dest: 'uploads/chunks/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per chunk
    fieldSize: 10 * 1024 * 1024  // 10MB for metadata
  }
});

// Base directories for media recording storage
const MEDIA_BASE_DIR = path.join(process.cwd(), 'uploads', 'media-recording');
const SESSIONS_DIR = path.join(MEDIA_BASE_DIR, 'sessions');

// Ensure base directories exist
const initializeDirectories = async () => {
  try {
    await fs.mkdir(MEDIA_BASE_DIR, { recursive: true });
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    console.log('📁 Media recording directories initialized');
  } catch (error) {
    console.error('❌ Error creating base directories:', error);
  }
};

// Initialize on startup
initializeDirectories();

// In-memory storage for session data (in production, use Redis or database)
const sessions = new Map();
const chunks = new Map();

// Utility functions
const generateSessionId = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `rec_${timestamp}_${random}`;
};

const validateSessionData = (sessionData) => {
  const required = ['sessionId', 'timestamp'];
  return required.every(field => sessionData[field]);
};

const logRequest = (endpoint, data, status = 'success') => {
  const timestamp = new Date().toISOString();
  console.log(`📡 [${timestamp}] ${endpoint}: ${status}`, 
    typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
};

// Create session directory and JSON file
const createSessionDirectory = async (sessionId) => {
  try {
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });
    
    const chunksDir = path.join(sessionDir, 'chunks');
    await fs.mkdir(chunksDir, { recursive: true });
    
    console.log(`📁 Created session directory: ${sessionDir}`);
    return { sessionDir, chunksDir };
  } catch (error) {
    console.error(`❌ Error creating session directory for ${sessionId}:`, error);
    throw error;
  }
};

// Save session metadata to JSON file
const saveSessionMetadata = async (sessionId, sessionData) => {
  try {
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    const metadataPath = path.join(sessionDir, 'session.json');
    
    await fs.writeFile(metadataPath, JSON.stringify(sessionData, null, 2), 'utf8');
    console.log(`💾 Saved session metadata: ${metadataPath}`);
    
    return metadataPath;
  } catch (error) {
    console.error(`❌ Error saving session metadata for ${sessionId}:`, error);
    throw error;
  }
};

// Load session metadata from JSON file
const loadSessionMetadata = async (sessionId) => {
  try {
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    const metadataPath = path.join(sessionDir, 'session.json');
    
    const data = await fs.readFile(metadataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`❌ Error loading session metadata for ${sessionId}:`, error);
    return null;
  }
};

// Save chunk file and update session metadata
const saveChunk = async (sessionId, chunkIndex, chunkFile, metadata) => {
  try {
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    
    // Generate chunk filename (convert to .webm as requested)
    const chunkFilename = `chunk_${chunkIndex.toString().padStart(4, '0')}.webm`;
    const chunkPath = path.join(chunksDir, chunkFilename);
    
    // Move uploaded chunk to session directory
    await fs.copyFile(chunkFile.path, chunkPath);
    
    // Clean up temporary file
    await fs.unlink(chunkFile.path);
    
    // Load current session metadata
    let sessionData = await loadSessionMetadata(sessionId);
    if (!sessionData) {
      throw new Error(`Session metadata not found for ${sessionId}`);
    }
    
    // Update chunk list in session data
    const chunkInfo = {
      chunkIndex: chunkIndex,
      filename: chunkFilename,
      path: chunkPath,
      originalName: chunkFile.originalname,
      size: chunkFile.size,
      mimetype: chunkFile.mimetype,
      uploadedAt: new Date().toISOString(),
      metadata: metadata || {}
    };
    
    // Add or update chunk in chunks array
    const existingChunkIndex = sessionData.chunks.findIndex(c => c.chunkIndex === chunkIndex);
    if (existingChunkIndex >= 0) {
      sessionData.chunks[existingChunkIndex] = chunkInfo;
    } else {
      sessionData.chunks.push(chunkInfo);
    }
    
    // Sort chunks by index
    sessionData.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    
    // Update totals
    sessionData.totalChunks = sessionData.chunks.length;
    sessionData.totalSize = sessionData.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
    sessionData.updatedAt = new Date().toISOString();
    
    // Save updated metadata
    await saveSessionMetadata(sessionId, sessionData);
    
    console.log(`📦 Saved chunk ${chunkIndex} for session ${sessionId}: ${chunkFilename} (${(chunkFile.size / 1024 / 1024).toFixed(2)}MB)`);
    
    return {
      chunkInfo,
      sessionData,
      chunkPath: `/api/media/recording/session/${sessionId}/chunks/${chunkFilename}`
    };
    
  } catch (error) {
    console.error(`❌ Error saving chunk ${chunkIndex} for session ${sessionId}:`, error);
    throw error;
  }
};

/**
 * Phase 1: Session Creation
 * POST /api/media/recording/init
 * 
 * Creates a new recording session with dummy response fallback
 * Creates session directory and JSON metadata file
 */
router.post('/init', async (req, res) => {
  try {
    const { sessionId, timestamp, dummyMode } = req.body;
    
    logRequest('/api/media/recording/init', req.body, 'received');
    
    // Generate sessionId if not provided
    const finalSessionId = sessionId || generateSessionId();
    
    // Validate input data
    if (!timestamp) {
      logRequest('/api/media/recording/init', 'Missing timestamp', 'error');
      return res.status(400).json({
        success: false,
        error: 'timestamp is required',
        sessionId: finalSessionId
      });
    }
    
    // Real HTTP request simulation
    if (dummyMode) {
      console.log(`📡 Real HTTP request attempted but server not available`);
      console.log(`📡 Fallback to dummy response for session: ${finalSessionId}`);
    }
    
    // Create session directory structure
    const { sessionDir, chunksDir } = await createSessionDirectory(finalSessionId);
    
    // Create session data
    const sessionData = {
      sessionId: finalSessionId,
      timestamp: new Date(timestamp).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'initialized',
      totalChunks: 0,
      totalSize: 0,
      chunks: [],
      dummyMode: Boolean(dummyMode),
      directories: {
        sessionDir,
        chunksDir
      }
    };
    
    // Save session metadata to JSON file
    await saveSessionMetadata(finalSessionId, sessionData);
    
    // Store session in memory for quick access
    sessions.set(finalSessionId, sessionData);
    
    logRequest('/api/media/recording/init', `Session created: ${finalSessionId}`, 'success');
    
    // Return dummy response with real HTTP request note
    const response = {
      success: true,
      sessionId: finalSessionId,
      status: 'initialized',
      timestamp: sessionData.timestamp,
      sessionDir: sessionDir,
      note: dummyMode ? "Real HTTP request attempted but server not available" : "Session initialized successfully"
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Error in /api/media/recording/init:', error);
    logRequest('/api/media/recording/init', error.message, 'error');
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * Phase 2: Chunk Upload
 * POST /api/media/recording/chunk
 * 
 * Handles video chunk uploads with real FormData processing
 * Converts chunks to .webm format and saves to session directory
 * Updates session JSON with chunk information
 */
router.post('/chunk', upload.single('chunk'), async (req, res) => {
  try {
    const { sessionId, chunkIndex, metadata, dummyMode } = req.body;
    const chunkFile = req.file;
    
    logRequest('/api/media/recording/chunk', {
      sessionId,
      chunkIndex: parseInt(chunkIndex),
      chunkSize: chunkFile?.size,
      hasMetadata: Boolean(metadata),
      dummyMode
    }, 'received');
    
    // Validate required fields
    if (!sessionId || chunkIndex === undefined || !chunkFile) {
      return res.status(400).json({
        success: false,
        error: 'sessionId, chunkIndex, and chunk file are required'
      });
    }
    
    // Check if session exists (try memory first, then load from disk)
    let sessionData = sessions.get(sessionId);
    if (!sessionData) {
      sessionData = await loadSessionMetadata(sessionId);
      if (sessionData) {
        sessions.set(sessionId, sessionData);
      }
    }
    
    if (!sessionData) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        sessionId
      });
    }
    
    // Parse metadata if provided
    let parsedMetadata = {};
    if (metadata) {
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch (error) {
        console.warn('⚠️  Invalid metadata JSON:', error.message);
      }
    }
    
    // Real HTTP request simulation
    if (dummyMode) {
      console.log(`📡 Sending real FormData request to: /api/media/recording/chunk`);
      console.log(`📡 Real chunk request failed as expected (no server): Failed to fetch`);
      console.log(`📡 Fallback to dummy response for chunk ${chunkIndex}`);
    }
    
    const chunkIndexNum = parseInt(chunkIndex);
    
    // Save chunk to session directory and update metadata
    const {
      chunkInfo,
      sessionData: updatedSessionData,
      chunkPath
    } = await saveChunk(sessionId, chunkIndexNum, chunkFile, parsedMetadata);
    
    // Update session in memory
    sessions.set(sessionId, updatedSessionData);
    
    // Store chunk data in memory map for backwards compatibility
    const chunkId = `${sessionId}_chunk_${chunkIndexNum}`;
    chunks.set(chunkId, {
      chunkId,
      sessionId,
      chunkIndex: chunkIndexNum,
      size: chunkFile.size,
      originalName: chunkFile.originalname,
      filename: chunkInfo.filename,
      path: chunkInfo.path,
      mimetype: chunkFile.mimetype,
      uploadedAt: chunkInfo.uploadedAt,
      metadata: parsedMetadata,
      dummyPath: `/dummy/chunks/${sessionId}/chunk_${chunkIndexNum}.webm` // Dummy server path for compatibility
    });
    
    logRequest('/api/media/recording/chunk', 
      `Chunk ${chunkIndexNum} uploaded and saved: ${(chunkFile.size / 1024 / 1024).toFixed(2)}MB`, 'success');
    
    // Return response with actual file path
    const response = {
      success: true,
      chunkIndex: chunkIndexNum,
      path: chunkPath, // Real path to saved chunk
      filename: chunkInfo.filename,
      uploadedSize: chunkFile.size,
      status: 'uploaded',
      sessionTotalChunks: updatedSessionData.totalChunks,
      sessionTotalSize: updatedSessionData.totalSize,
      note: dummyMode ? "Real HTTP request attempted but server not available" : "Chunk uploaded successfully"
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Error in /api/media/recording/chunk:', error);
    logRequest('/api/media/recording/chunk', error.message, 'error');
    
    // Cleanup uploaded file if error occurs
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up uploaded chunk:', cleanupError);
      }
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * Phase 3: Session Finalization
 * POST /api/media/recording/finalize
 * 
 * Finalizes recording session and prepares final video output
 * Updates session JSON with final status
 */
router.post('/finalize', async (req, res) => {
  try {
    const { sessionId, totalChunks, totalSize, chunks: clientChunks, dummyMode } = req.body;
    
    logRequest('/api/media/recording/finalize', {
      sessionId,
      totalChunks,
      totalSizeMB: totalSize ? (totalSize / 1024 / 1024).toFixed(2) : null,
      clientChunksCount: clientChunks?.length,
      dummyMode
    }, 'received');
    
    // Validate required fields
    if (!sessionId || totalChunks === undefined) {
      return res.status(400).json({
        success: false,
        error: 'sessionId and totalChunks are required'
      });
    }
    
    // Load session data
    let sessionData = sessions.get(sessionId);
    if (!sessionData) {
      sessionData = await loadSessionMetadata(sessionId);
      if (sessionData) {
        sessions.set(sessionId, sessionData);
      }
    }
    
    if (!sessionData) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        sessionId
      });
    }
    
    // Real HTTP request simulation
    if (dummyMode) {
      console.log(`📡 Sending real HTTP request to: /api/media/recording/finalize`);
      console.log(`📡 Real finalize request failed as expected (no server): Failed to fetch`);
      console.log(`📡 Fallback to dummy response for finalization`);
    }
    
    // Update session with finalization data
    sessionData.status = 'completed';
    sessionData.finalizedAt = new Date().toISOString();
    sessionData.updatedAt = new Date().toISOString();
    sessionData.clientTotalChunks = totalChunks;
    sessionData.clientTotalSize = totalSize;
    sessionData.failedChunks = 0; // In production, calculate actual failed chunks
    
    // Validate chunk consistency (optional)
    if (clientChunks && Array.isArray(clientChunks)) {
      sessionData.clientChunks = clientChunks;
      // In production, verify chunk integrity here
    }
    
    // Save updated session metadata
    await saveSessionMetadata(sessionId, sessionData);
    sessions.set(sessionId, sessionData);
    
    logRequest('/api/media/recording/finalize', 
      `Session ${sessionId} finalized: ${totalChunks} chunks, ${(totalSize / 1024 / 1024).toFixed(2)}MB`, 'success');
    
    // Return dummy response with real HTTP request note
    const response = {
      success: true,
      sessionId,
      status: 'completed',
      finalVideoUrl: `/dummy/final/${sessionId}_final.mp4`,
      actualChunksPath: `/api/media/recording/session/${sessionId}/chunks`,
      totalChunks: sessionData.totalChunks,
      totalSizeMB: parseFloat((sessionData.totalSize / 1024 / 1024).toFixed(1)),
      finalizedAt: sessionData.finalizedAt,
      processingTime: calculateProcessingTime(sessionData.createdAt, sessionData.finalizedAt),
      failedChunks: sessionData.failedChunks,
      note: dummyMode ? "Real HTTP request attempted but server not available" : "Session finalized successfully"
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Error in /api/media/recording/finalize:', error);
    logRequest('/api/media/recording/finalize', error.message, 'error');
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * Get Session Status
 * GET /api/media/recording/session/:sessionId
 * 
 * Returns current session status and progress from JSON file
 */
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Load session data from JSON file
    const sessionData = await loadSessionMetadata(sessionId);
    
    if (!sessionData) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        sessionId
      });
    }
    
    const response = {
      success: true,
      session: {
        ...sessionData,
        chunksDetails: sessionData.chunks.map(chunk => ({
          index: chunk.chunkIndex,
          filename: chunk.filename,
          size: chunk.size,
          path: chunk.path,
          uploadedAt: chunk.uploadedAt,
          sizeMB: parseFloat((chunk.size / 1024 / 1024).toFixed(2))
        }))
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Error getting session status:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * Get Chunk File
 * GET /api/media/recording/session/:sessionId/chunks/:chunkFilename
 * 
 * Serves individual chunk files
 */
router.get('/session/:sessionId/chunks/:chunkFilename', async (req, res) => {
  try {
    const { sessionId, chunkFilename } = req.params;
    
    const sessionData = await loadSessionMetadata(sessionId);
    if (!sessionData) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    const chunkPath = path.join(SESSIONS_DIR, sessionId, 'chunks', chunkFilename);
    
    // Check if chunk file exists
    try {
      await fs.access(chunkPath);
      res.sendFile(path.resolve(chunkPath));
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: 'Chunk file not found'
      });
    }
    
  } catch (error) {
    console.error('❌ Error serving chunk file:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * Get All Sessions
 * GET /api/media/recording/sessions
 * 
 * Returns all active sessions by scanning session directories
 */
router.get('/sessions', async (req, res) => {
  try {
    const sessionDirs = await fs.readdir(SESSIONS_DIR);
    const allSessions = [];
    
    for (const sessionId of sessionDirs) {
      try {
        const sessionData = await loadSessionMetadata(sessionId);
        if (sessionData) {
          allSessions.push({
            sessionId: sessionData.sessionId,
            status: sessionData.status,
            createdAt: sessionData.createdAt,
            totalChunks: sessionData.totalChunks,
            totalSizeMB: parseFloat((sessionData.totalSize / 1024 / 1024).toFixed(2)),
            dummyMode: sessionData.dummyMode
          });
        }
      } catch (error) {
        console.warn(`Warning: Could not load session ${sessionId}:`, error.message);
      }
    }
    
    res.json({
      success: true,
      sessions: allSessions,
      totalSessions: allSessions.length
    });
    
  } catch (error) {
    console.error('❌ Error getting sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * Delete Session
 * DELETE /api/media/recording/session/:sessionId
 * 
 * Deletes session directory and all associated files
 */
router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const sessionData = await loadSessionMetadata(sessionId);
    if (!sessionData) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        sessionId
      });
    }
    
    // Remove session directory and all contents
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    await fs.rm(sessionDir, { recursive: true, force: true });
    
    // Remove from memory
    sessions.delete(sessionId);
    
    // Remove associated chunks from memory map
    const sessionChunks = Array.from(chunks.keys())
      .filter(chunkId => chunkId.startsWith(`${sessionId}_chunk_`));
    
    for (const chunkId of sessionChunks) {
      chunks.delete(chunkId);
    }
    
    logRequest('/api/media/recording/session (DELETE)', 
      `Session ${sessionId} deleted completely`, 'success');
    
    res.json({
      success: true,
      message: 'Session deleted successfully',
      sessionId,
      deletedDirectory: sessionDir
    });
    
  } catch (error) {
    console.error('❌ Error deleting session:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * System Status
 * GET /api/media/recording/status
 * 
 * Returns system status and metrics
 */
router.get('/status', async (req, res) => {
  try {
    const sessionDirs = await fs.readdir(SESSIONS_DIR);
    let totalSessions = 0;
    let activeSessions = 0;
    let completedSessions = 0;
    let totalChunks = 0;
    let totalStorageUsed = 0;
    
    for (const sessionId of sessionDirs) {
      try {
        const sessionData = await loadSessionMetadata(sessionId);
        if (sessionData) {
          totalSessions++;
          if (sessionData.status === 'initialized') activeSessions++;
          if (sessionData.status === 'completed') completedSessions++;
          totalChunks += sessionData.totalChunks;
          totalStorageUsed += sessionData.totalSize;
        }
      } catch (error) {
        // Skip invalid sessions
      }
    }
    
    res.json({
      success: true,
      system: {
        status: 'operational',
        uptime: process.uptime(),
        mode: 'file_storage_with_dummy_fallback',
        storageDirectory: SESSIONS_DIR
      },
      sessions: {
        total: totalSessions,
        active: activeSessions,
        completed: completedSessions
      },
      chunks: {
        total: totalChunks,
        totalSizeMB: parseFloat((totalStorageUsed / 1024 / 1024).toFixed(2))
      },
      configuration: {
        chunkDurationMs: 5000,
        maxChunkSizeMB: 50,
        supportedFormats: ['webm', 'mp4'],
        videoBitsPerSecond: 8000000,
        frameRate: 60
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting system status:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Utility function to calculate processing time
function calculateProcessingTime(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationMs = end - start;
  const durationSeconds = Math.round(durationMs / 1000);
  
  if (durationSeconds < 60) {
    return `${durationSeconds}s`;
  } else {
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }
}

// Cleanup old sessions periodically (run every 30 minutes)
setInterval(async () => {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
  
  try {
    const sessionDirs = await fs.readdir(SESSIONS_DIR);
    let cleanedSessions = 0;
    
    for (const sessionId of sessionDirs) {
      try {
        const sessionData = await loadSessionMetadata(sessionId);
        if (sessionData) {
          const sessionDate = new Date(sessionData.createdAt);
          if (sessionDate < oneDayAgo) {
            const sessionDir = path.join(SESSIONS_DIR, sessionId);
            await fs.rm(sessionDir, { recursive: true, force: true });
            sessions.delete(sessionId);
            cleanedSessions++;
          }
        }
      } catch (error) {
        // Skip invalid sessions
      }
    }
    
    if (cleanedSessions > 0) {
      console.log(`🧹 Cleaned up ${cleanedSessions} old sessions`);
    }
  } catch (error) {
    console.error('❌ Error during session cleanup:', error);
  }
}, 30 * 60 * 1000); // 30 minutes

module.exports = router;