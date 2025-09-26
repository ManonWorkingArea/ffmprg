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
    console.error('❌ CRITICAL ERROR: Cannot create media recording directories:', error);
    console.error(`📍 Current working directory: ${process.cwd()}`);
    console.error(`📍 Process user: ${process.getuid ? process.getuid() : 'N/A'}`);
    console.error('💡 Please ensure the Node.js process has write permissions to create directories');
    
    // Try alternative directory in /tmp as fallback
    try {
      console.log('🔄 Attempting fallback to temporary directory...');
      const fallbackDir = path.join('/tmp', 'ffmprg-media-recording', 'sessions');
      await fs.mkdir(fallbackDir, { recursive: true, mode: 0o755 });
      console.log(`⚠️  Using fallback directory: ${fallbackDir}`);
      console.log('⚠️  WARNING: Files will be stored in /tmp and may be lost on server restart');
      
      // Update the constants to use fallback
      // Note: This is a runtime change and won't persist
      Object.defineProperty(global, 'MEDIA_FALLBACK_DIR', { value: fallbackDir });
      
    } catch (fallbackError) {
      console.error('❌ Fallback directory creation also failed:', fallbackError);
      throw new Error(`Cannot create media recording directories. Original error: ${error.message}, Fallback error: ${fallbackError.message}`);
    }
  }
};

// Initialize on startup with retry mechanism
const initializeWithRetry = async (maxRetries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await initializeDirectories();
      return; // Success, exit retry loop
    } catch (error) {
      console.error(`❌ Directory initialization attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      if (attempt === maxRetries) {
        console.error('❌ All directory initialization attempts failed');
        console.error('💡 Media recording features may not work properly');
        console.error('💡 Please check server permissions and file system access');
        // Don't throw error to prevent server startup failure
        return;
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
};

// Initialize on startup
initializeWithRetry();

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

// Create session directory and JSON file with enhanced error handling
const createSessionDirectory = async (sessionId) => {
  try {
    // Check if we're using fallback directory
    const sessionsDir = global.MEDIA_FALLBACK_DIR || SESSIONS_DIR;
    const sessionDir = path.join(sessionsDir, sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    
    console.log(`📁 Creating session directory: ${sessionDir}`);
    
    // Create session directory with explicit permissions
    try {
      await fs.mkdir(sessionDir, { recursive: true, mode: 0o755 });
      console.log(`✅ Session directory created: ${sessionDir}`);
    } catch (sessionDirError) {
      console.error(`❌ Failed to create session directory: ${sessionDirError.message}`);
      
      // Try to check if directory already exists
      try {
        await fs.access(sessionDir, fs.constants.R_OK | fs.constants.W_OK);
        console.log(`📁 Session directory already exists and is accessible: ${sessionDir}`);
      } catch (accessError) {
        throw new Error(`Cannot create or access session directory: ${sessionDirError.message}`);
      }
    }
    
    console.log(`📁 Creating chunks directory: ${chunksDir}`);
    
    // Create chunks directory with explicit permissions
    try {
      await fs.mkdir(chunksDir, { recursive: true, mode: 0o755 });
      console.log(`✅ Chunks directory created: ${chunksDir}`);
    } catch (chunksDirError) {
      console.error(`❌ Failed to create chunks directory: ${chunksDirError.message}`);
      
      // Try to check if directory already exists
      try {
        await fs.access(chunksDir, fs.constants.R_OK | fs.constants.W_OK);
        console.log(`📁 Chunks directory already exists and is accessible: ${chunksDir}`);
      } catch (accessError) {
        throw new Error(`Cannot create or access chunks directory: ${chunksDirError.message}`);
      }
    }
    
    // Verify directories were created and are accessible
    try {
      await fs.access(sessionDir, fs.constants.R_OK | fs.constants.W_OK);
      await fs.access(chunksDir, fs.constants.R_OK | fs.constants.W_OK);
      console.log(`✅ Session directories created and verified: ${sessionDir}`);
    } catch (verifyError) {
      console.error(`❌ Failed to verify session directories:`, verifyError);
      throw new Error(`Session directories created but not accessible: ${verifyError.message}`);
    }
    
    return { sessionDir, chunksDir };
  } catch (error) {
    console.error(`❌ Error creating session directory for ${sessionId}:`, error);
    console.error(`📍 Current working directory: ${process.cwd()}`);
    console.error(`📍 Target sessions directory: ${global.MEDIA_FALLBACK_DIR || SESSIONS_DIR}`);
    throw error;
  }
};

// Save session metadata to JSON file with enhanced error handling and permission checks
const saveSessionMetadata = async (sessionId, sessionData) => {
  try {
    // Use fallback directory if available
    const sessionsDir = global.MEDIA_FALLBACK_DIR || SESSIONS_DIR;
    const sessionDir = path.join(sessionsDir, sessionId);
    const metadataPath = path.join(sessionDir, 'session.json');
    
    console.log(`💾 Saving session metadata to: ${metadataPath}`);
    
    // Ensure directory exists with proper permissions
    try {
      await fs.mkdir(sessionDir, { recursive: true, mode: 0o755 });
    } catch (mkdirError) {
      // Check if directory exists and is accessible
      try {
        await fs.access(sessionDir, fs.constants.R_OK | fs.constants.W_OK);
        console.log(`📁 Session directory already exists: ${sessionDir}`);
      } catch (accessError) {
        console.error(`❌ Cannot create or access session directory: ${mkdirError.message}`);
        throw new Error(`Directory creation failed: ${mkdirError.message}`);
      }
    }
    
    // Save the file with proper permissions
    try {
      await fs.writeFile(metadataPath, JSON.stringify(sessionData, null, 2), { 
        encoding: 'utf8',
        mode: 0o644 
      });
      console.log(`✅ Session metadata saved successfully: ${metadataPath}`);
    } catch (writeError) {
      console.error(`❌ Failed to write session metadata: ${writeError.message}`);
      
      // Check if we can write to the directory
      try {
        await fs.access(sessionDir, fs.constants.W_OK);
        console.error(`❌ Directory is writable, but file write failed`);
      } catch (dirAccessError) {
        console.error(`❌ Directory is not writable: ${dirAccessError.message}`);
      }
      
      throw new Error(`Cannot write session metadata: ${writeError.message}`);
    }
    
    // Verify the file was created and is readable
    try {
      await fs.access(metadataPath, fs.constants.R_OK);
      const stats = await fs.stat(metadataPath);
      console.log(`📊 Session file size: ${stats.size} bytes`);
    } catch (verifyError) {
      console.error(`❌ Failed to verify session file: ${metadataPath}`, verifyError);
      throw new Error(`Session file created but not accessible: ${verifyError.message}`);
    }
    
    return metadataPath;
  } catch (error) {
    console.error(`❌ Error saving session metadata for ${sessionId}:`, error);
    console.error(`📍 Current working directory: ${process.cwd()}`);
    console.error(`📍 Target directory: ${global.MEDIA_FALLBACK_DIR || SESSIONS_DIR}`);
    console.error(`📍 Process UID: ${process.getuid ? process.getuid() : 'N/A'}`);
    console.error(`📍 Process GID: ${process.getgid ? process.getgid() : 'N/A'}`);
    throw error;
  }
};

// Load session metadata from JSON file with enhanced error handling
const loadSessionMetadata = async (sessionId) => {
  try {
    // Use fallback directory if available
    const sessionsDir = global.MEDIA_FALLBACK_DIR || SESSIONS_DIR;
    const sessionDir = path.join(sessionsDir, sessionId);
    const metadataPath = path.join(sessionDir, 'session.json');
    
    // Check if file exists first
    try {
      await fs.access(metadataPath, fs.constants.R_OK);
    } catch (accessError) {
      console.error(`❌ Session metadata file not found: ${metadataPath}`);
      
      // Additional debugging information
      try {
        await fs.access(sessionDir, fs.constants.R_OK);
        console.log(`📁 Session directory exists but metadata file is missing: ${sessionDir}`);
        
        // List directory contents for debugging
        const files = await fs.readdir(sessionDir);
        console.log(`📂 Directory contents: ${files.join(', ')}`);
      } catch (dirAccessError) {
        console.error(`❌ Session directory not accessible: ${sessionDir}`);
      }
      
      return null;
    }
    
    try {
      const data = await fs.readFile(metadataPath, 'utf8');
      return JSON.parse(data);
    } catch (readError) {
      console.error(`❌ Error reading session metadata file: ${metadataPath}`, readError);
      return null;
    }
    
  } catch (error) {
    console.error(`❌ Error loading session metadata for ${sessionId}:`, error);
    return null;
  }
};

// Save chunk file and update session metadata with enhanced error handling
const saveChunk = async (sessionId, chunkIndex, chunkFile, metadata) => {
  try {
    // Use fallback directory if available
    const sessionsDir = global.MEDIA_FALLBACK_DIR || SESSIONS_DIR;
    const sessionDir = path.join(sessionsDir, sessionId);
    const chunksDir = path.join(sessionDir, 'chunks');
    
    // Generate chunk filename (convert to .webm as requested)
    const chunkFilename = `chunk_${chunkIndex.toString().padStart(4, '0')}.webm`;
    const chunkPath = path.join(chunksDir, chunkFilename);
    
    console.log(`💾 Saving chunk ${chunkIndex} to: ${chunkPath}`);
    
    // Ensure chunks directory exists
    try {
      await fs.mkdir(chunksDir, { recursive: true, mode: 0o755 });
    } catch (mkdirError) {
      try {
        await fs.access(chunksDir, fs.constants.W_OK);
        console.log(`📁 Chunks directory already exists: ${chunksDir}`);
      } catch (accessError) {
        console.error(`❌ Cannot create or access chunks directory: ${mkdirError.message}`);
        throw new Error(`Chunks directory creation failed: ${mkdirError.message}`);
      }
    }
    
    // Move uploaded chunk to session directory
    try {
      await fs.copyFile(chunkFile.path, chunkPath);
      console.log(`✅ Chunk copied successfully: ${chunkPath}`);
    } catch (copyError) {
      console.error(`❌ Failed to copy chunk file: ${copyError.message}`);
      throw new Error(`Cannot copy chunk file: ${copyError.message}`);
    }
    
    // Clean up temporary file
    try {
      await fs.unlink(chunkFile.path);
      console.log(`🗑️ Temporary chunk file cleaned up: ${chunkFile.path}`);
    } catch (unlinkError) {
      console.warn(`⚠️  Failed to clean up temporary file: ${unlinkError.message}`);
      // Don't throw error for cleanup failure
    }
    
    // Load current session metadata
    let sessionData = await loadSessionMetadata(sessionId);
    if (!sessionData) {
      console.error(`❌ Session metadata not found for chunk save: ${sessionId}`);
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
    
    // Log additional debugging information
    console.error(`📍 Working directory: ${process.cwd()}`);
    console.error(`📍 Sessions directory: ${global.MEDIA_FALLBACK_DIR || SESSIONS_DIR}`);
    console.error(`📍 Temporary chunk file: ${chunkFile.path}`);
    
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
router.post('/recording/init', async (req, res) => {
  console.log('🎯 Route /recording/init hit!');
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
    console.log(`📁 Session directories created: ${sessionDir}`);
    
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
    console.log(`💾 Session metadata saved for: ${finalSessionId}`);
    
    // Store session in memory for quick access
    sessions.set(finalSessionId, sessionData);
    console.log(`🧠 Session stored in memory: ${finalSessionId}`);
    
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
router.post('/recording/chunk', upload.single('chunk'), async (req, res) => {
  console.log('🎯 Route /recording/chunk hit!');
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
      console.error(`❌ Session not found: ${sessionId}`);
      
      // Attempt to create a basic session if directory structure exists
      const sessionDir = path.join(SESSIONS_DIR, sessionId);
      try {
        await fs.access(sessionDir);
        console.log(`📁 Session directory exists, creating basic session: ${sessionId}`);
        
        // Create basic session data
        const basicSessionData = {
          sessionId: sessionId,
          timestamp: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'initialized',
          totalChunks: 0,
          totalSize: 0,
          chunks: [],
          recovered: true,
          directories: {
            sessionDir,
            chunksDir: path.join(sessionDir, 'chunks')
          }
        };
        
        await saveSessionMetadata(sessionId, basicSessionData);
        sessions.set(sessionId, basicSessionData);
        sessionData = basicSessionData;
        
        console.log(`✅ Session recovered: ${sessionId}`);
        
      } catch (dirError) {
        console.error(`❌ Session directory not found: ${sessionDir}`);
        return res.status(404).json({
          success: false,
          error: 'Session not found and cannot be recovered',
          sessionId,
          details: 'Please initialize a new session first'
        });
      }
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
router.post('/recording/finalize', async (req, res) => {
  console.log('🎯 Route /recording/finalize hit!');
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
      console.error(`❌ Session not found for finalization: ${sessionId}`);
      
      // Attempt to create a basic session for finalization if directory exists
      const sessionDir = path.join(SESSIONS_DIR, sessionId);
      try {
        await fs.access(sessionDir);
        console.log(`📁 Session directory exists for finalization, creating basic session: ${sessionId}`);
        
        // Create basic session data with finalization info
        const basicSessionData = {
          sessionId: sessionId,
          timestamp: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'initialized',
          totalChunks: 0,
          totalSize: 0,
          chunks: [],
          recovered: true,
          directories: {
            sessionDir,
            chunksDir: path.join(sessionDir, 'chunks')
          }
        };
        
        await saveSessionMetadata(sessionId, basicSessionData);
        sessions.set(sessionId, basicSessionData);
        sessionData = basicSessionData;
        
        console.log(`✅ Session recovered for finalization: ${sessionId}`);
        
      } catch (dirError) {
        console.error(`❌ Session directory not found for finalization: ${sessionDir}`);
        return res.status(404).json({
          success: false,
          error: 'Session not found and cannot be recovered for finalization',
          sessionId,
          details: 'Session may have been deleted or never properly initialized'
        });
      }
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
    
    // Process video chunks with FFmpeg
    let mergeResult = null;
    let cleanupResult = null;
    let processingNote = dummyMode ? "Real HTTP request attempted but server not available" : "Session finalized successfully";
    
    try {
      if (sessionData.chunks && sessionData.chunks.length > 0) {
        console.log(`🎬 Starting video processing for ${sessionData.chunks.length} chunks`);
        
        // Merge video chunks using FFmpeg
        mergeResult = await mergeVideoChunks(sessionId, sessionData);
        console.log(`✅ Video merge successful:`, mergeResult);
        
        // Clean up chunk files after successful merge
        if (mergeResult.success) {
          cleanupResult = await cleanupChunkFiles(sessionId, sessionData);
          console.log(`✅ Cleanup successful:`, cleanupResult);
          
          // Update session with merge results
          sessionData.videoProcessing = {
            merged: true,
            mergedAt: new Date().toISOString(),
            finalVideoPath: mergeResult.outputPath,
            finalVideoSizeMB: mergeResult.sizeMB,
            mergeDurationSeconds: mergeResult.duration,
            chunksProcessed: mergeResult.chunksProcessed,
            cleanup: {
              deletedFiles: cleanupResult.deletedFiles,
              spacesFreedMB: cleanupResult.totalSizeFreedMB
            }
          };
          
          // Save updated session with video processing info
          await saveSessionMetadata(sessionId, sessionData);
          sessions.set(sessionId, sessionData);
          
          processingNote = `Video merged successfully: ${mergeResult.chunksProcessed} chunks → ${mergeResult.sizeMB}MB MP4, ${cleanupResult.deletedFiles} chunk files cleaned up`;
        }
        
      } else {
        console.warn(`⚠️  No chunks found for session ${sessionId}, skipping video processing`);
        processingNote += " (No chunks to process)";
      }
      
    } catch (videoError) {
      console.error(`❌ Video processing failed for session ${sessionId}:`, videoError);
      processingNote += ` (Video processing failed: ${videoError.message})`;
      
      // Update session with error info
      sessionData.videoProcessing = {
        merged: false,
        error: videoError.message,
        errorAt: new Date().toISOString()
      };
      
      await saveSessionMetadata(sessionId, sessionData);
      sessions.set(sessionId, sessionData);
    }
    
    // Return response with video processing results
    const response = {
      success: true,
      sessionId,
      status: 'completed',
      finalVideoUrl: mergeResult && mergeResult.success 
        ? `/api/media/recording/session/${sessionId}/video` 
        : `/dummy/final/${sessionId}_final.mp4`,
      actualChunksPath: `/api/media/recording/session/${sessionId}/chunks`,
      totalChunks: sessionData.totalChunks,
      totalSizeMB: parseFloat((sessionData.totalSize / 1024 / 1024).toFixed(1)),
      finalizedAt: sessionData.finalizedAt,
      processingTime: calculateProcessingTime(sessionData.createdAt, sessionData.finalizedAt),
      failedChunks: sessionData.failedChunks,
      videoProcessing: sessionData.videoProcessing || { merged: false, note: "No chunks to process" },
      note: processingNote
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

/**
 * Download Final Video
 * GET /api/media/recording/session/:sessionId/video
 * 
 * Serves the final merged MP4 video file
 */
router.get('/session/:sessionId/video', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    console.log(`📹 Video download request for session: ${sessionId}`);
    
    const sessionData = await loadSessionMetadata(sessionId);
    if (!sessionData) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        sessionId
      });
    }
    
    // Check if video processing was completed
    if (!sessionData.videoProcessing || !sessionData.videoProcessing.merged) {
      return res.status(404).json({
        success: false,
        error: 'Final video not available. Video processing may have failed or not been completed.',
        sessionId,
        videoProcessing: sessionData.videoProcessing || { status: 'not_processed' }
      });
    }
    
    const videoPath = sessionData.videoProcessing.finalVideoPath;
    
    // Check if video file exists
    try {
      await fs.access(videoPath);
      const stats = await fs.stat(videoPath);
      
      console.log(`📤 Serving video: ${videoPath} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
      
      // Set appropriate headers for video download
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Content-Disposition', `attachment; filename="${sessionId}_final.mp4"`);
      res.setHeader('Accept-Ranges', 'bytes');
      
      // Stream the file
      const readStream = require('fs').createReadStream(videoPath);
      
      readStream.on('error', (streamError) => {
        console.error(`❌ Stream error: ${streamError.message}`);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Error streaming video file',
            details: streamError.message
          });
        }
      });
      
      readStream.pipe(res);
      
    } catch (fileError) {
      console.error(`❌ Video file not accessible: ${videoPath}`, fileError);
      return res.status(404).json({
        success: false,
        error: 'Video file not found on disk',
        sessionId,
        expectedPath: videoPath,
        details: fileError.message
      });
    }
    
  } catch (error) {
    console.error('❌ Error serving video:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * Merge video chunks using FFmpeg
 * Combines WebM chunks into a single MP4 file
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
    
    // Check if chunks directory exists
    try {
      await fs.access(chunksDir);
    } catch (error) {
      throw new Error(`Chunks directory not found: ${chunksDir}`);
    }
    
    // Get all chunk files and sort them by index
    const chunkFiles = [];
    for (const chunk of sessionData.chunks) {
      const chunkPath = path.join(chunksDir, chunk.filename);
      try {
        await fs.access(chunkPath);
        chunkFiles.push({
          index: chunk.chunkIndex,
          path: chunkPath,
          filename: chunk.filename
        });
        console.log(`✅ Found chunk ${chunk.chunkIndex}: ${chunk.filename}`);
      } catch (error) {
        console.warn(`⚠️  Chunk file not found: ${chunkPath}`);
      }
    }
    
    if (chunkFiles.length === 0) {
      throw new Error('No chunk files found to merge');
    }
    
    // Sort chunks by index
    chunkFiles.sort((a, b) => a.index - b.index);
    console.log(`🔢 Merging ${chunkFiles.length} chunks in order`);
    
    // Use FFmpeg to merge chunks - Use filter_complex for proper WebM merging
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const ffmpegCommand = ffmpeg();
      
      // Add all chunk files as inputs
      chunkFiles.forEach(chunk => {
        ffmpegCommand.input(chunk.path);
      });
      
      // Use filter_complex to concatenate video streams properly
      const filterInputs = chunkFiles.map((_, index) => `[${index}:v]`).join('');
      const filterComplex = `${filterInputs}concat=n=${chunkFiles.length}:v=1:a=0[outv]`;
      
      console.log(`🔧 FFmpeg filter: ${filterComplex}`);
      
      ffmpegCommand
        .complexFilter([
          {
            filter: 'concat',
            options: {
              n: chunkFiles.length,
              v: 1, // video streams
              a: 0  // no audio streams (WebM chunks typically don't have audio)
            },
            inputs: chunkFiles.map((_, index) => `${index}:v`),
            outputs: 'outv'
          }
        ])
        .outputOptions([
          '-map', '[outv]',
          '-c:v', 'libx264',     // Re-encode to H.264 for MP4
          '-preset', 'medium',   // Balance between speed and compression
          '-crf', '23',          // Good quality setting
          '-pix_fmt', 'yuv420p', // Ensure compatibility
          '-movflags', 'faststart' // Enable fast start for web playback
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`🚀 FFmpeg started: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⏳ FFmpeg progress: ${Math.round(progress.percent)}% (${progress.timemark})`);
          }
        })
        .on('end', async () => {
          const endTime = Date.now();
          const duration = ((endTime - startTime) / 1000).toFixed(2);
          console.log(`✅ Video merge completed in ${duration}s`);
          
          try {
            // Check output file
            const stats = await fs.stat(outputPath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            console.log(`📊 Final video size: ${sizeMB}MB`);
            console.log(`✅ Successfully merged ${chunkFiles.length} WebM chunks into single MP4 file`);
            
            resolve({
              success: true,
              outputPath,
              sizeMB: parseFloat(sizeMB),
              duration: parseFloat(duration),
              chunksProcessed: chunkFiles.length
            });
            
          } catch (statError) {
            reject(new Error(`Failed to verify output file: ${statError.message}`));
          }
        })
        .on('error', (error) => {
          console.error(`❌ FFmpeg error: ${error.message}`);
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
        await fs.unlink(chunkPath);
        
        deletedFiles++;
        totalSizeFreed += stats.size;
        console.log(`🗑️  Deleted chunk: ${chunk.filename} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
        
      } catch (error) {
        if (error.code === 'ENOENT') {
          console.warn(`⚠️  Chunk file already deleted: ${chunkPath}`);
        } else {
          console.error(`❌ Failed to delete chunk: ${chunkPath} - ${error.message}`);
        }
      }
    }
    
    // Try to remove empty chunks directory
    try {
      const remainingFiles = await fs.readdir(chunksDir);
      if (remainingFiles.length === 0) {
        await fs.rmdir(chunksDir);
        console.log(`🗑️  Removed empty chunks directory: ${chunksDir}`);
      } else {
        console.log(`📁 Chunks directory not empty, keeping: ${remainingFiles.length} files remaining`);
      }
    } catch (error) {
      console.warn(`⚠️  Could not remove chunks directory: ${error.message}`);
    }
    
    const totalSizeFreedMB = (totalSizeFreed / 1024 / 1024).toFixed(2);
    console.log(`✅ Cleanup completed: ${deletedFiles} files deleted, ${totalSizeFreedMB}MB freed`);
    
    return {
      deletedFiles,
      totalSizeFreedMB: parseFloat(totalSizeFreedMB)
    };
    
  } catch (error) {
    console.error(`❌ Error in cleanupChunkFiles: ${error.message}`);
    throw error;
  }
}

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

console.log('📡 Media recording routes initialized:');
console.log('  - POST /recording/init');
console.log('  - POST /recording/chunk');
console.log('  - POST /recording/finalize');
console.log('  - GET  /recording/session/:sessionId');
console.log('  - GET  /recording/sessions');
console.log('  - DELETE /recording/session/:sessionId');

module.exports = router;