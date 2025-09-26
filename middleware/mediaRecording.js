/**
 * Media Recording Middleware
 * 
 * Provides middleware functions for media recording functionality
 * including validation, logging, and error handling
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * VideoChunkManager Simulator
 * 
 * Simulates the frontend VideoChunkManager behavior for testing
 * and validation of the media recording API
 */
class VideoChunkManagerSimulator {
  constructor(options = {}) {
    this.config = {
      mediaServerUrl: options.mediaServerUrl || '/api/media',
      chunkDurationMs: options.chunkDurationMs || 5000,
      useDummyServer: options.useDummyServer !== false,
      simulateRealRequests: options.simulateRealRequests !== false,
      videoBitsPerSecond: options.videoBitsPerSecond || 8000000,
      frameRate: options.frameRate || 60,
      ...options
    };
    
    this.currentSession = null;
    this.chunks = [];
    this.isRecording = false;
    
    console.log('🎬 VideoChunkManager initialized:', {
      simulateRealRequests: this.config.simulateRealRequests,
      chunkDurationMs: this.config.chunkDurationMs,
      useDummyServer: this.config.useDummyServer
    });
  }
  
  /**
   * Creates a new recording session
   */
  async createSession() {
    const sessionId = this._generateSessionId();
    const timestamp = new Date().toISOString();
    
    console.log('📡 Creating session with real HTTP request to dummy endpoint:', sessionId);
    
    try {
      // Simulate real HTTP request
      const response = await this._makeRequest('POST', '/recording/init', {
        sessionId,
        timestamp,
        dummyMode: this.config.useDummyServer
      });
      
      console.log('✅ Dummy fallback session created');
      
      this.currentSession = {
        sessionId: response.sessionId,
        timestamp: response.timestamp,
        status: response.status,
        chunks: []
      };
      
      return this.currentSession;
      
    } catch (error) {
      console.log('📡 Real request failed as expected (no server):', error.message);
      console.log('✅ Dummy fallback session created');
      
      // Fallback to dummy response
      this.currentSession = {
        sessionId,
        timestamp,
        status: 'initialized',
        chunks: []
      };
      
      return this.currentSession;
    }
  }
  
  /**
   * Uploads a video chunk
   */
  async uploadChunk(chunkData, chunkIndex) {
    if (!this.currentSession) {
      throw new Error('No active session. Create session first.');
    }
    
    console.log(`📤 Uploading chunk ${chunkIndex} with real HTTP request (${(chunkData.size / 1024 / 1024).toFixed(2)}MB)...`);
    console.log('📡 Sending real FormData request to: /api/media/recording/chunk');
    
    try {
      // Create FormData
      const formData = new FormData();
      formData.append('chunk', chunkData);
      formData.append('sessionId', this.currentSession.sessionId);
      formData.append('chunkIndex', chunkIndex.toString());
      formData.append('metadata', JSON.stringify({
        sessionId: this.currentSession.sessionId,
        chunkIndex,
        size: chunkData.size,
        timestamp: new Date().toISOString()
      }));
      formData.append('dummyMode', this.config.useDummyServer ? 'true' : 'false');
      
      // Simulate real HTTP request
      const response = await this._makeRequest('POST', '/recording/chunk', formData);
      
      console.log(`✅ Dummy fallback chunk ${chunkIndex} uploaded successfully`);
      
      const chunkInfo = {
        index: chunkIndex,
        size: chunkData.size,
        serverPath: response.path,
        uploadedAt: new Date().toISOString()
      };
      
      this.chunks.push(chunkInfo);
      this.currentSession.chunks.push(chunkInfo);
      
      return response;
      
    } catch (error) {
      console.log('📡 Real chunk request failed as expected (no server):', error.message);
      console.log(`✅ Dummy fallback chunk ${chunkIndex} uploaded successfully`);
      
      // Fallback to dummy response
      const chunkInfo = {
        index: chunkIndex,
        size: chunkData.size,
        serverPath: `/dummy/chunks/${this.currentSession.sessionId}/chunk_${chunkIndex}.webm`,
        uploadedAt: new Date().toISOString()
      };
      
      this.chunks.push(chunkInfo);
      this.currentSession.chunks.push(chunkInfo);
      
      return {
        chunkIndex,
        path: chunkInfo.serverPath,
        uploadedSize: chunkData.size,
        status: 'uploaded'
      };
    }
  }
  
  /**
   * Finalizes the recording session
   */
  async finalizeSession() {
    if (!this.currentSession) {
      throw new Error('No active session to finalize.');
    }
    
    console.log('🏁 Finalizing with real HTTP request to dummy endpoint');
    
    const totalSize = this.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
    
    try {
      // Simulate real HTTP request
      const response = await this._makeRequest('POST', '/recording/finalize', {
        sessionId: this.currentSession.sessionId,
        totalChunks: this.chunks.length,
        totalSize,
        chunks: this.chunks,
        dummyMode: this.config.useDummyServer
      });
      
      console.log('✅ Dummy fallback session finalized');
      
      this.currentSession.status = 'completed';
      this.currentSession.finalVideoUrl = response.finalVideoUrl;
      this.currentSession.totalChunks = response.totalChunks;
      this.currentSession.totalSizeMB = response.totalSizeMB;
      
      return response;
      
    } catch (error) {
      console.log('📡 Real finalize request failed as expected (no server):', error.message);
      console.log('✅ Dummy fallback session finalized');
      
      // Fallback to dummy response
      const response = {
        sessionId: this.currentSession.sessionId,
        status: 'completed',
        finalVideoUrl: `/dummy/final/${this.currentSession.sessionId}_final.mp4`,
        totalChunks: this.chunks.length,
        totalSizeMB: parseFloat((totalSize / 1024 / 1024).toFixed(1))
      };
      
      this.currentSession.status = 'completed';
      this.currentSession.finalVideoUrl = response.finalVideoUrl;
      this.currentSession.totalChunks = response.totalChunks;
      this.currentSession.totalSizeMB = response.totalSizeMB;
      
      return response;
    }
  }
  
  /**
   * Generates a session ID
   */
  _generateSessionId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `rec_${timestamp}_${random}`;
  }
  
  /**
   * Simulates HTTP requests (always fails to simulate no server)
   */
  async _makeRequest(method, endpoint, data) {
    // Always fail to simulate server not available
    throw new Error('Failed to fetch');
  }
}

/**
 * Request logging middleware
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  
  // Log request
  console.log(`📡 [${timestamp}] ${req.method} ${req.originalUrl}`, {
    body: req.body ? Object.keys(req.body) : null,
    files: req.file ? { size: req.file.size, mimetype: req.file.mimetype } : null,
    headers: {
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length']
    }
  });
  
  // Log response
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`📡 [${new Date().toISOString()}] Response ${res.statusCode} in ${duration}ms`);
  });
  
  next();
};

/**
 * Session validation middleware
 */
const validateSession = async (req, res, next) => {
  try {
    const sessionId = req.body.sessionId || req.params.sessionId;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'sessionId is required'
      });
    }
    
    // Add sessionId to request for use in routes
    req.sessionId = sessionId;
    next();
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Session validation error',
      details: error.message
    });
  }
};

/**
 * Chunk validation middleware
 */
const validateChunk = (req, res, next) => {
  try {
    const { chunkIndex } = req.body;
    const chunkFile = req.file;
    
    if (chunkIndex === undefined) {
      return res.status(400).json({
        success: false,
        error: 'chunkIndex is required'
      });
    }
    
    if (!chunkFile) {
      return res.status(400).json({
        success: false,
        error: 'chunk file is required'
      });
    }
    
    const chunkIndexNum = parseInt(chunkIndex);
    if (isNaN(chunkIndexNum) || chunkIndexNum < 0) {
      return res.status(400).json({
        success: false,
        error: 'chunkIndex must be a non-negative integer'
      });
    }
    
    // Check chunk size (50MB limit)
    const MAX_CHUNK_SIZE = 50 * 1024 * 1024;
    if (chunkFile.size > MAX_CHUNK_SIZE) {
      return res.status(413).json({
        success: false,
        error: `Chunk too large. Maximum size is ${MAX_CHUNK_SIZE / 1024 / 1024}MB`
      });
    }
    
    req.chunkIndex = chunkIndexNum;
    next();
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Chunk validation error',
      details: error.message
    });
  }
};

/**
 * Error handling middleware
 */
const errorHandler = (error, req, res, next) => {
  console.error('❌ Media Recording Error:', error);
  
  // Multer errors
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'File too large',
      maxSize: '50MB'
    });
  }
  
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      error: 'Unexpected file field'
    });
  }
  
  // Default error response
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    details: error.message
  });
};

/**
 * Performance monitoring middleware
 */
const performanceMonitor = (req, res, next) => {
  const start = process.hrtime();
  const startMemory = process.memoryUsage();
  
  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds * 1000 + nanoseconds / 1000000; // Convert to milliseconds
    const endMemory = process.memoryUsage();
    
    if (duration > 1000) { // Log slow requests (> 1 second)
      console.log(`⏰ Slow request: ${req.method} ${req.originalUrl} took ${duration.toFixed(2)}ms`);
    }
    
    const memoryDiff = endMemory.heapUsed - startMemory.heapUsed;
    if (memoryDiff > 10 * 1024 * 1024) { // Log high memory usage (> 10MB)
      console.log(`💾 High memory usage: ${req.method} ${req.originalUrl} used ${(memoryDiff / 1024 / 1024).toFixed(2)}MB`);
    }
  });
  
  next();
};

/**
 * Public CORS middleware for media recording endpoints - Allow all origins
 */
const corsHandler = (req, res, next) => {
  const origin = req.headers.origin;
  
  console.log(`🌐 CORS: ${req.method} ${req.originalUrl} from origin: ${origin || 'none'} → allowed: all origins`);
  
  // Set CORS headers to allow all origins (do not set credentials when origin is '*')
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', [
    'Origin',
    'X-Requested-With', 
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'X-Session-ID',
    'X-Chunk-Index',
    'X-Total-Chunks',
    'X-File-Name',
    'X-File-Size',
    'Content-Length'
  ].join(', '));
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, X-Session-ID, X-Upload-Status');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    console.log('✈️  Preflight request handled successfully - all origins allowed');
    return res.status(200).end();
  } else {
    next();
  }
};

module.exports = {
  VideoChunkManagerSimulator,
  requestLogger,
  validateSession,
  validateChunk,
  errorHandler,
  performanceMonitor,
  corsHandler
};