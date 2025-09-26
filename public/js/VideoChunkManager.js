/**
 * Production VideoChunkManager
 * 
 * Real implementation for use with https://media.cloudrestfulapi.com/
 * Handles 5-second video chunks with 4K@60fps quality
 */
class VideoChunkManager {
  constructor(options = {}) {
    this.config = {
      mediaServerUrl: options.mediaServerUrl || 'https://media.cloudrestfulapi.com/api/media',
      chunkDurationMs: options.chunkDurationMs || 5000,           // 5 seconds
      useDummyServer: options.useDummyServer || false,            // Production mode
      simulateRealRequests: true,                                 // Always send real requests
      videoBitsPerSecond: options.videoBitsPerSecond || 8000000,  // 8 Mbps high quality
      frameRate: options.frameRate || 60,                         // 60 FPS
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      ...options
    };
    
    this.currentSession = null;
    this.chunks = [];
    this.isRecording = false;
    this.uploadQueue = [];
    this.isUploading = false;
    
    console.log('🎬 Production VideoChunkManager initialized:', {
      serverUrl: this.config.mediaServerUrl,
      chunkDurationMs: this.config.chunkDurationMs,
      videoBitsPerSecond: this.config.videoBitsPerSecond,
      frameRate: this.config.frameRate
    });
  }
  
  /**
   * Creates a new recording session with production server
   */
  async createSession(customSessionId = null) {
    console.log('📡 Creating session with production server...');
    
    try {
      const response = await fetch(`${this.config.mediaServerUrl}/recording/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: customSessionId,
          timestamp: new Date().toISOString(),
          dummyMode: false  // Production mode
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Session creation failed: ${errorData.error || response.statusText}`);
      }
      
      const data = await response.json();
      
      this.currentSession = {
        sessionId: data.sessionId,
        timestamp: data.timestamp,
        status: data.status,
        chunks: [],
        createdAt: new Date().toISOString(),
        sessionDir: data.sessionDir
      };
      
      console.log('✅ Production session created successfully');
      console.log(`📋 Session ID: ${data.sessionId}`);
      console.log(`📁 Session Directory: ${data.sessionDir || 'Server managed'}`);
      
      return this.currentSession;
      
    } catch (error) {
      console.error('❌ Production session creation failed:', error);
      throw error;
    }
  }
  
  /**
   * Uploads a video chunk to production server
   */
  async uploadChunk(chunkData, chunkIndex, metadata = {}) {
    if (!this.currentSession) {
      throw new Error('No active session. Create session first.');
    }
    
    const chunkSize = chunkData.size || chunkData.length || 0;
    console.log(`📤 Uploading chunk ${chunkIndex} to production server (${(chunkSize / 1024 / 1024).toFixed(2)}MB)...`);
    
    let retries = 0;
    while (retries < this.config.maxRetries) {
      try {
        // Create FormData with chunk and metadata
        const formData = new FormData();
        formData.append('chunk', chunkData, `chunk_${chunkIndex.toString().padStart(4, '0')}.webm`);
        formData.append('sessionId', this.currentSession.sessionId);
        formData.append('chunkIndex', chunkIndex.toString());
        formData.append('metadata', JSON.stringify({
          sessionId: this.currentSession.sessionId,
          chunkIndex,
          size: chunkSize,
          timestamp: new Date().toISOString(),
          ...metadata
        }));
        formData.append('dummyMode', 'false');
        
        const response = await fetch(`${this.config.mediaServerUrl}/recording/chunk`, {
          method: 'POST',
          body: formData
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`Chunk upload failed: ${errorData.error || response.statusText}`);
        }
        
        const data = await response.json();
        
        console.log(`✅ Production chunk ${chunkIndex} uploaded successfully`);
        console.log(`📁 Server path: ${data.path}`);
        console.log(`📄 Filename: ${data.filename}`);
        
        const chunkInfo = {
          index: chunkIndex,
          size: chunkSize,
          serverPath: data.path,
          filename: data.filename,
          uploadedAt: new Date().toISOString(),
          status: 'uploaded'
        };
        
        this.chunks.push(chunkInfo);
        this.currentSession.chunks.push(chunkInfo);
        
        return data;
        
      } catch (error) {
        retries++;
        console.warn(`⚠️ Chunk ${chunkIndex} upload attempt ${retries} failed:`, error.message);
        
        if (retries >= this.config.maxRetries) {
          console.error(`❌ Chunk ${chunkIndex} upload failed after ${this.config.maxRetries} retries`);
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * retries));
      }
    }
  }
  
  /**
   * Uploads chunks in queue (for batch processing)
   */
  async processUploadQueue() {
    if (this.isUploading || this.uploadQueue.length === 0) {
      return;
    }
    
    this.isUploading = true;
    console.log(`🔄 Processing upload queue: ${this.uploadQueue.length} chunks`);
    
    try {
      while (this.uploadQueue.length > 0) {
        const { chunkData, chunkIndex, metadata } = this.uploadQueue.shift();
        await this.uploadChunk(chunkData, chunkIndex, metadata);
      }
      
      console.log('✅ Upload queue processed successfully');
    } catch (error) {
      console.error('❌ Upload queue processing failed:', error);
      throw error;
    } finally {
      this.isUploading = false;
    }
  }
  
  /**
   * Adds chunk to upload queue
   */
  queueChunk(chunkData, chunkIndex, metadata = {}) {
    this.uploadQueue.push({ chunkData, chunkIndex, metadata });
    console.log(`📋 Chunk ${chunkIndex} added to queue (queue size: ${this.uploadQueue.length})`);
    
    // Auto-process queue if not already processing
    if (!this.isUploading) {
      setTimeout(() => this.processUploadQueue(), 100);
    }
  }
  
  /**
   * Finalizes the recording session with production server
   */
  async finalizeSession(additionalData = {}) {
    if (!this.currentSession) {
      throw new Error('No active session to finalize.');
    }
    
    console.log('🏁 Finalizing session with production server...');
    
    const totalSize = this.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
    
    try {
      const response = await fetch(`${this.config.mediaServerUrl}/recording/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.currentSession.sessionId,
          totalChunks: this.chunks.length,
          totalSize,
          chunks: this.chunks,
          dummyMode: false,
          ...additionalData
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Session finalization failed: ${errorData.error || response.statusText}`);
      }
      
      const data = await response.json();
      
      console.log('✅ Production session finalized successfully');
      console.log(`🎥 Final video URL: ${data.finalVideoUrl || 'Processing...'}`);
      console.log(`📁 Chunks path: ${data.actualChunksPath}`);
      console.log(`📊 Total chunks: ${data.totalChunks}, Total size: ${data.totalSizeMB}MB`);
      console.log(`⏱️ Processing time: ${data.processingTime}`);
      
      this.currentSession.status = 'completed';
      this.currentSession.finalVideoUrl = data.finalVideoUrl;
      this.currentSession.totalChunks = data.totalChunks;
      this.currentSession.totalSizeMB = data.totalSizeMB;
      this.currentSession.finalizedAt = new Date().toISOString();
      
      return data;
      
    } catch (error) {
      console.error('❌ Production session finalization failed:', error);
      throw error;
    }
  }
  
  /**
   * Gets session status from production server
   */
  async getSessionStatus(sessionId = null) {
    const targetSessionId = sessionId || this.currentSession?.sessionId;
    if (!targetSessionId) {
      throw new Error('No session ID provided');
    }
    
    try {
      const response = await fetch(`${this.config.mediaServerUrl}/recording/session/${targetSessionId}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Session status failed: ${errorData.error || response.statusText}`);
      }
      
      const data = await response.json();
      console.log(`📊 Session ${targetSessionId} status:`, data.session.status);
      
      return data.session;
      
    } catch (error) {
      console.error('❌ Get session status failed:', error);
      throw error;
    }
  }
  
  /**
   * Gets system status from production server
   */
  async getSystemStatus() {
    try {
      const response = await fetch(`${this.config.mediaServerUrl}/recording/status`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`System status failed: ${errorData.error || response.statusText}`);
      }
      
      const data = await response.json();
      console.log('📊 Production system status:', data);
      
      return data;
      
    } catch (error) {
      console.error('❌ Get system status failed:', error);
      throw error;
    }
  }
  
  /**
   * Deletes a session from production server
   */
  async deleteSession(sessionId = null) {
    const targetSessionId = sessionId || this.currentSession?.sessionId;
    if (!targetSessionId) {
      throw new Error('No session ID provided');
    }
    
    try {
      const response = await fetch(`${this.config.mediaServerUrl}/recording/session/${targetSessionId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Session deletion failed: ${errorData.error || response.statusText}`);
      }
      
      const data = await response.json();
      console.log(`🗑️ Session ${targetSessionId} deleted successfully`);
      
      // Clear current session if it was deleted
      if (this.currentSession?.sessionId === targetSessionId) {
        this.currentSession = null;
        this.chunks = [];
        this.uploadQueue = [];
      }
      
      return data;
      
    } catch (error) {
      console.error('❌ Session deletion failed:', error);
      throw error;
    }
  }
  
  /**
   * Downloads a chunk file from production server
   */
  async downloadChunk(sessionId, chunkFilename) {
    try {
      const response = await fetch(`${this.config.mediaServerUrl}/recording/session/${sessionId}/chunks/${chunkFilename}`);
      
      if (!response.ok) {
        throw new Error(`Chunk download failed: ${response.statusText}`);
      }
      
      const blob = await response.blob();
      console.log(`📥 Downloaded chunk: ${chunkFilename} (${(blob.size / 1024 / 1024).toFixed(2)}MB)`);
      
      return blob;
      
    } catch (error) {
      console.error('❌ Chunk download failed:', error);
      throw error;
    }
  }
  
  /**
   * Complete recording workflow
   */
  async completeRecording(chunksData, customSessionId = null) {
    console.log('🎬 Starting complete recording workflow...');
    
    try {
      // Step 1: Create session
      await this.createSession(customSessionId);
      
      // Step 2: Upload all chunks
      console.log(`📤 Uploading ${chunksData.length} chunks...`);
      for (let i = 0; i < chunksData.length; i++) {
        await this.uploadChunk(chunksData[i], i);
        
        // Small delay between uploads to prevent overwhelming server
        if (i < chunksData.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Step 3: Finalize session
      const finalResult = await this.finalizeSession();
      
      console.log('🏁 Complete recording workflow finished successfully');
      return {
        session: this.currentSession,
        finalResult,
        totalChunks: chunksData.length,
        totalSizeMB: this.chunks.reduce((sum, chunk) => sum + chunk.size, 0) / 1024 / 1024
      };
      
    } catch (error) {
      console.error('❌ Complete recording workflow failed:', error);
      throw error;
    }
  }
  
  /**
   * Get current recording statistics
   */
  getStats() {
    return {
      hasActiveSession: !!this.currentSession,
      sessionId: this.currentSession?.sessionId,
      uploadedChunks: this.chunks.length,
      totalUploadedSize: this.chunks.reduce((sum, chunk) => sum + chunk.size, 0),
      queuedChunks: this.uploadQueue.length,
      isUploading: this.isUploading,
      sessionStatus: this.currentSession?.status,
      configuration: { ...this.config }
    };
  }
}

// Export for use in different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoChunkManager;
}

if (typeof window !== 'undefined') {
  window.VideoChunkManager = VideoChunkManager;
}

// Example usage:
/*
const chunkManager = new VideoChunkManager({
  mediaServerUrl: 'https://media.cloudrestfulapi.com/api/media',
  chunkDurationMs: 5000,
  videoBitsPerSecond: 8000000,
  frameRate: 60
});

// Complete workflow
const chunks = [blob1, blob2, blob3]; // Your video chunks
const result = await chunkManager.completeRecording(chunks);

// Or step by step
await chunkManager.createSession();
for (let i = 0; i < chunks.length; i++) {
  await chunkManager.uploadChunk(chunks[i], i);
}
await chunkManager.finalizeSession();
*/