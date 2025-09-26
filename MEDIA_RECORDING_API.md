# Media Recording API

## 📡 Overview

ระบบ Media Recording API ที่ส่ง **HTTP requests จริงๆ** ไปยัง media server endpoints แม้ว่าจะไม่มี server จริง เพื่อเตรียมพร้อมสำหรับการ deploy จริง

## 🚀 Quick Start

### 1. Start Server
```bash
npm start
```

### 2. Test Interface
เปิดเบราว์เซอร์และไปที่:
```
http://localhost:3000/media-test.html
```

### 3. API Endpoints
Base URL: `http://localhost:3000/api/media`

## 📋 API Endpoints

### Phase 1: Session Creation
```http
POST /api/media/recording/init
Content-Type: application/json

{
  "sessionId": null,
  "timestamp": "2024-01-01T12:00:00.000Z",
  "dummyMode": true
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "rec_1727270400000_abc123",
  "status": "initialized",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "note": "Real HTTP request attempted but server not available"
}
```

### Phase 2: Chunk Upload
```http
POST /api/media/recording/chunk
Content-Type: multipart/form-data

FormData {
  chunk: [Blob 12-15MB],
  sessionId: "rec_1727270400000_abc123",
  chunkIndex: "0",
  metadata: "{...}",
  dummyMode: "true"
}
```

**Response:**
```json
{
  "success": true,
  "chunkIndex": 0,
  "path": "/dummy/chunks/rec_1727270400000_abc123/chunk_0.webm",
  "uploadedSize": 12582912,
  "status": "uploaded",
  "note": "Real HTTP request attempted but server not available"
}
```

### Phase 3: Session Finalization
```http
POST /api/media/recording/finalize
Content-Type: application/json

{
  "sessionId": "rec_1727270400000_abc123",
  "totalChunks": 12,
  "totalSize": 301989888,
  "chunks": [...],
  "dummyMode": true
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "rec_1727270400000_abc123",
  "status": "completed",
  "finalVideoUrl": "/dummy/final/rec_1727270400000_abc123_final.mp4",
  "totalChunks": 12,
  "totalSizeMB": 288.2,
  "note": "Real HTTP request attempted but server not available"
}
```

## 🔄 Usage Examples

### JavaScript Frontend (VideoChunkManager)

```javascript
class VideoChunkManager {
  constructor(options = {}) {
    this.config = {
      mediaServerUrl: '/api/media',
      chunkDurationMs: 5000,           // 5 seconds
      useDummyServer: true,
      simulateRealRequests: true,      // ส่ง HTTP requests จริง
      videoBitsPerSecond: 8000000,     // 8 Mbps
      frameRate: 60
    };
  }
  
  async createSession() {
    const response = await fetch('/api/media/recording/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: null,
        timestamp: new Date().toISOString(),
        dummyMode: this.config.useDummyServer
      })
    });
    
    return response.json();
  }
  
  async uploadChunk(chunkData, chunkIndex) {
    const formData = new FormData();
    formData.append('chunk', chunkData);
    formData.append('sessionId', this.currentSession.sessionId);
    formData.append('chunkIndex', chunkIndex.toString());
    formData.append('dummyMode', 'true');
    
    const response = await fetch('/api/media/recording/chunk', {
      method: 'POST',
      body: formData
    });
    
    return response.json();
  }
  
  async finalizeSession() {
    const response = await fetch('/api/media/recording/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.currentSession.sessionId,
        totalChunks: this.chunks.length,
        totalSize: this.getTotalSize(),
        dummyMode: true
      })
    });
    
    return response.json();
  }
}
```

### Node.js Testing

```javascript
const MediaRecordingTester = require('./test-media-recording');

const tester = new MediaRecordingTester('http://localhost:3000');

// Run all tests
await tester.runAllTests();

// Run performance test
await tester.performanceTest();
```

## 🛠️ Development

### Project Structure
```
routes/
├── mediaRecording.js          # Main API routes
middleware/
├── mediaRecording.js          # Validation & logging middleware
public/
├── media-test.html           # Test interface
test-media-recording.js       # Test suite
```

### Configuration Options

#### Mode 1: Real Requests + Dummy Fallback (Current)
```javascript
const chunkManager = new VideoChunkManager({
  useDummyServer: true,
  simulateRealRequests: true  // ✅ ส่ง HTTP requests จริง
});
```

#### Mode 2: Pure Dummy (No Network)
```javascript
const chunkManager = new VideoChunkManager({
  useDummyServer: true,
  simulateRealRequests: false  // ไม่ส่ง HTTP requests
});
```

#### Mode 3: Real Server (Production)
```javascript
const chunkManager = new VideoChunkManager({
  useDummyServer: false,
  simulateRealRequests: false  // ส่งไปยัง real server
});
```

## 📊 Monitoring & Testing

### Browser Network Tab
เมื่อบันทึกวิดีโอ จะเห็น network requests ใน DevTools:
```
POST /api/media/recording/init          Status: 200
POST /api/media/recording/chunk         Status: 200
POST /api/media/recording/chunk         Status: 200
POST /api/media/recording/finalize      Status: 200
```

### Console Logs
```
🎬 VideoChunkManager initialized: { simulateRealRequests: true, chunkDurationMs: 5000 }
📡 Creating session with real HTTP request to dummy endpoint: rec_123
📡 Real request sent, response status: 200
✅ Session created successfully

📤 Uploading chunk 0 with real HTTP request (12MB)...
📡 Sending real FormData request to: /api/media/recording/chunk
📡 Chunk 0 uploaded successfully
✅ Dummy response received

🏁 Finalizing with real HTTP request to dummy endpoint
📡 Finalize request sent successfully
✅ Session finalized
```

### Performance Metrics
```javascript
// วัดเวลาที่ใช้ในการ request
console.time('chunk-upload-request');
await fetch('/api/media/recording/chunk', {...});
console.timeEnd('chunk-upload-request'); 
// chunk-upload-request: 15.234ms

// วัด payload size
console.log('FormData size:', formData.get('chunk').size); // 12582912 bytes
```

## 🔍 Additional Endpoints

### Get Session Status
```http
GET /api/media/recording/session/:sessionId
```

### Get All Sessions
```http
GET /api/media/recording/sessions
```

### Get System Status
```http
GET /api/media/recording/status
```

### Delete Session
```http
DELETE /api/media/recording/session/:sessionId
```

## 🚀 Production Deployment

เมื่อ media server พร้อมใช้งาน:

1. **Deploy Media Server** พร้อม endpoints:
   - `POST /api/media/recording/init`
   - `POST /api/media/recording/chunk`
   - `POST /api/media/recording/finalize`

2. **Change Configuration**:
```javascript
const chunkManager = new VideoChunkManager({
  useDummyServer: false,  // เปลี่ยนเป็น false
  mediaServerUrl: 'https://your-media-server.com/api/media'
});
```

3. **Deploy** - ระบบจะทำงานได้ทันทีเพราะ HTTP requests structure เหมือนกันทุกประการ

## ✅ Current Status

### การใช้งานจริงในระบบ:
- ✅ **Chunk Duration**: 5 วินาที
- ✅ **High Quality**: 4K@60fps recording support
- ✅ **Real HTTP Requests**: ส่ง requests จริงไปยัง endpoints
- ✅ **Binary Data**: ส่ง WebM chunks ผ่าน FormData
- ✅ **Fallback System**: Automatic dummy response เมื่อไม่มี server
- ✅ **File Sizes**: ~12-15MB per chunk (5-second 4K video)

### การตั้งค่าปัจจุบัน:
```javascript
const chunkManager = new VideoChunkManager({
  mediaServerUrl: '/api/media',
  chunkDurationMs: 5000,           // 5 seconds chunks
  useDummyServer: true,            // Dummy mode enabled
  simulateRealRequests: true,      // Send real HTTP requests
  videoBitsPerSecond: 8000000,     // 8 Mbps high quality
  frameRate: 60                    // 60 FPS
});
```

## 🧪 Testing

### Run Test Suite
```bash
node test-media-recording.js
```

### Manual Testing
1. เปิด `http://localhost:3000/media-test.html`
2. กดปุ่ม "Auto Demo" เพื่อทดสอบ workflow ทั้งหมด
3. กดปุ่ม "Performance Test" เพื่อทดสอบประสิทธิภาพ
4. ดู Network Activity และ Console Logs

### Expected Output
```
🧪 Media Recording Tester initialized
📡 API Base URL: http://localhost:3000/api/media

=== TEST RESULTS ===
✅ Passed: 7
❌ Failed: 0
📊 Success Rate: 100.0%

📋 Final Session Summary:
   Session ID: rec_1727270400000_abc123
   Total Chunks: 5
   Total Size: 60.00MB
```

## 💡 Benefits

### 1. **Production-Ready Code**
- HTTP requests ตัวจริงพร้อมใช้งาน
- FormData structure ถูกต้อง
- Error handling เหมือน production

### 2. **Network Testing**
- ทดสอบ network conditions
- วัด request/response times
- ตรวจสอบ payload sizes

### 3. **Easy Transition**
เมื่อมี server จริง แค่เปลี่ยน `useDummyServer: false`

### 4. **Real Development Experience**
- เห็น network activity ใน DevTools
- ทดสอบ CORS, headers, authentication
- Monitor performance metrics

## 📞 Support

หากมีคำถามหรือต้องการความช่วยเหลือ สามารถดูได้ที่:
- Test Interface: `http://localhost:3000/media-test.html`
- Main Interface: `http://localhost:3000`
- API Documentation: README files

---

**สรุป**: ตอนนี้ระบบส่ง HTTP requests จริงๆ ไปยัง endpoints ที่คาดหวัง แล้ว fallback ไปใช้ dummy responses เมื่อไม่มี server - เตรียมพร้อมสำหรับ production deployment แล้วครับ! 📡✨