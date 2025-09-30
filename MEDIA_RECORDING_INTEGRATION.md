# 🎬 Media Recording API with MongoDB & S3 Integration

## Overview
Media Recording API ที่อัปเดตแล้วสามารถทำงานร่วมกับ MongoDB และ S3 Object Storage เพื่อจัดเก็บและติดตามสถานะการประมวลผลไฟล์วิดีโอได้

## 📋 Required Parameters

เมื่อใช้งาน Media Recording API คุณจะต้องส่งข้อมูลเหล่านี้:

### **1. site** (Required for MongoDB/S3 integration)
- ชื่อ domain/hostname ที่ส่ง request
- ใช้สำหรับค้นหาการตั้งค่า S3 จาก database

### **2. storage** (Optional but recommended)
- ID ของไฟล์ใน `storage` collection ของ MongoDB
- ใช้สำหรับอัปเดตสถานะการประมวลผลใน database

## 🚀 API Endpoints

### **1. Initialize Recording Session**
```http
POST /api/media/recording/init
```

**Request Body:**
```json
{
  "sessionId": "optional-custom-id",
  "expectedChunks": 100,
  "expectedDuration": 300,
  "site": "yourdomain.com",
  "storage": "670123456789abcdef123456",
  "metadata": {
    "title": "Screen Recording",
    "description": "User screen recording session"
  },
  "videoSettings": {
    "format": "mp4",
    "quality": "high"
  }
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "abc123-def456-ghi789",
  "status": "initialized",
  "message": "Recording session initialized successfully",
  "session": {
    "sessionId": "abc123-def456-ghi789",
    "status": "initialized",
    "createdAt": "2025-09-30T10:00:00.000Z",
    "expectedChunks": 100,
    "expectedDuration": 300,
    "videoSettings": {
      "format": "mp4",
      "quality": "high"
    },
    "site": {
      "hostname": "yourdomain.com",
      "siteName": "Your Site",
      "spaceId": "670123456789abcdef123456"
    },
    "space": {
      "name": "Your Storage",
      "s3Bucket": "your-bucket",
      "s3Endpoint": "https://your-cdn.com/",
      "s3Region": "us-east-1"
    },
    "storage": "670123456789abcdef123456"
  },
  "endpoints": {
    "uploadChunk": "/api/media/recording/chunk",
    "finalize": "/api/media/recording/finalize",
    "finalizeAsync": "/api/media/recording/finalize-async",
    "checkStatus": "/api/media/session/abc123-def456-ghi789/chunks/status",
    "downloadVideo": "/api/media/session/abc123-def456-ghi789/video"
  }
}
```

### **2. Upload Video Chunk**
```http
POST /api/media/recording/chunk
Content-Type: multipart/form-data
```

**Form Data:**
- `chunk`: Video chunk file (MP4 recommended)
- `sessionId`: Session ID from initialization
- `chunkIndex`: Sequential chunk number (0, 1, 2, ...)
- `totalChunks`: Total expected chunks (optional)
- `timestamp`: Chunk timestamp (optional)

### **3. Finalize Recording (Synchronous)**
```http
POST /api/media/recording/finalize
```

**Request Body:**
```json
{
  "sessionId": "abc123-def456-ghi789",
  "totalChunks": 100,
  "totalSize": 52428800,
  "maxWaitSeconds": 30
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "abc123-def456-ghi789",
  "message": "Video finalized and merged successfully",
  "warnings": [],
  "video": {
    "filename": "abc123-def456-ghi789_final.mp4",
    "sizeMB": 50.2,
    "expectedDuration": 300,
    "actualDuration": 298.5,
    "durationAccuracy": "good",
    "chunksProcessed": 100,
    "localPath": "/path/to/local/file.mp4",
    "s3Url": "https://your-cdn.com/media-recordings/abc123-def456-ghi789_final.mp4",
    "uploaded": true
  },
  "storage": {
    "id": "670123456789abcdef123456",
    "updated": true
  },
  "cleanup": {
    "deletedFiles": 100,
    "totalSizeFreed": 52428800,
    "success": true
  }
}
```

## 🗄️ Database Integration

### **MongoDB Collections**

1. **hostname** collection:
```json
{
  "_id": "...",
  "hostname": "yourdomain.com",
  "siteName": "Your Site Name",
  "spaceId": "670123456789abcdef123456"
}
```

2. **space** collection:
```json
{
  "_id": "670123456789abcdef123456",
  "name": "Your Storage Space",
  "s3Bucket": "your-bucket-name",
  "s3Endpoint": "https://your-cdn.com/",
  "s3EndpointDefault": "https://s3.amazonaws.com",
  "s3Key": "YOUR_ACCESS_KEY",
  "s3Secret": "YOUR_SECRET_KEY",
  "s3Region": "us-east-1",
  "status": true
}
```

3. **storage** collection:
```json
{
  "_id": "670123456789abcdef123456",
  "owner": "user123",
  "original": "screen-recording.mp4",
  "path": "https://your-cdn.com/media-recordings/abc123-def456-ghi789_final.mp4",
  "name": "My Screen Recording",
  "size": 52684032,
  "type": "video",
  "mimetype": "video/mp4",
  "spaceId": "670123456789abcdef123456",
  "duration": 298.5,
  "transcode": {
    "media_recording": "https://your-cdn.com/media-recordings/abc123-def456-ghi789_final.mp4"
  },
  "createdAt": "2025-09-30T10:00:00.000Z",
  "updatedAt": "2025-09-30T10:05:30.000Z"
}
```

## 📊 Status Tracking

ระบบจะอัปเดตสถานะใน `storage.transcode.media_recording` ตลอดกระบวนการ:

1. **"processing..."** - เริ่มประมวลผล
2. **"upload_error"** - อัปโหลด S3 ผิดพลาด
3. **"merge_error"** - รวมไฟล์ผิดพลาด
4. **"job_error"** - งาน async ผิดพลาด
5. **"https://..."** - URL สุดท้ายเมื่อสำเร็จ

## 🔧 Client Implementation Example

```javascript
class MediaRecorder {
  constructor(site, storageId) {
    this.site = site;
    this.storageId = storageId;
    this.sessionId = null;
  }

  async initialize() {
    const response = await fetch('/api/media/recording/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site: this.site,
        storage: this.storageId,
        expectedChunks: 100,
        expectedDuration: 300
      })
    });

    const data = await response.json();
    this.sessionId = data.sessionId;
    return data;
  }

  async uploadChunk(chunkBlob, chunkIndex) {
    const formData = new FormData();
    formData.append('chunk', chunkBlob);
    formData.append('sessionId', this.sessionId);
    formData.append('chunkIndex', chunkIndex);

    const response = await fetch('/api/media/recording/chunk', {
      method: 'POST',
      body: formData
    });

    return response.json();
  }

  async finalize(totalChunks) {
    const response = await fetch('/api/media/recording/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        totalChunks: totalChunks
      })
    });

    return response.json();
  }
}

// Usage
const recorder = new MediaRecorder('yourdomain.com', 'your-storage-id');
await recorder.initialize();
// ... upload chunks ...
const result = await recorder.finalize(100);
console.log('Final video URL:', result.video.s3Url);
```

## ⚠️ Important Notes

1. **Site Parameter**: จำเป็นต้องมีการตั้งค่า hostname ใน database ก่อนใช้งาน
2. **Storage Parameter**: ถ้าไม่ส่งมา ระบบจะทำงานได้แต่จะไม่อัปเดต storage collection
3. **S3 Configuration**: ต้องมีการตั้งค่า S3 credentials ใน space collection
4. **File Format**: แนะนำใช้ MP4 chunks สำหรับความเสถียรและความเร็วสูงสุด
5. **Cleanup**: ระบบจะลบ chunk files หลังจาก merge เสร็จเพื่อประหยัดพื้นที่

## 🎯 Benefits

- ✅ **Integrated Storage**: เชื่อมต่อกับ MongoDB และ S3 โดยอัตโนมัติ
- ✅ **Status Tracking**: ติดตามสถานะการประมวลผลแบบ real-time
- ✅ **Error Recovery**: จัดการข้อผิดพลาดและอัปเดตสถานะอย่างเหมาะสม
- ✅ **Flexible Storage**: รองรับ multi-tenant กับ hostname/space แยกกัน
- ✅ **Performance**: รองรับ async processing สำหรับไฟล์ขนาดใหญ่