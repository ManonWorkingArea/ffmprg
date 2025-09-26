# Cloudflare Stream Integration

เอกสารการใช้งาน Cloudflare Stream endpoint สำหรับอัปโหลดวิดีโอไปยัง Cloudflare Stream

## 🚀 การติดตั้งและตั้งค่า

### 1. Dependencies ที่จำเป็น
```bash
npm install form-data
```

### 2. การตั้งค่า Cloudflare
- **API Token**: `xTBA4Ynm-AGnY5UtGPMMQtLvmEpvFmgK1XHaQmMl`
- **Account ID**: `92d5cc09d52b3239a9bfccf8dbd1bddb`

## 📡 API Endpoints

### POST /stream-upload
อัปโหลดวิดีโอไปยัง Cloudflare Stream

#### Request Body:
```json
{
  "url": "https://example.com/video.mp4",
  "title": "ชื่อวิดีโอ",
  "description": "คำอธิบายวิดีโอ",
  "site": "example.com"
}
```

#### Response:
```json
{
  "success": true,





































































































  
  "taskId": "uuid-string",
  "type": "stream",
  "site": { /* hostname data */ },
  "space": { /* space data */ },
  "queuePosition": 1,
  "message": "Video upload to Cloudflare Stream has been queued"
}
```

### GET /status/:taskId
ตรวจสอบสถานะการอัปโหลด

#### Response (Completed):
```json
{
  "success": true,
  "task": {
    "taskId": "uuid-string",
    "type": "stream",
    "status": "completed",
    "percent": 100,
    "cloudflareStreamId": "stream-id",
    "cloudflarePlaybackUrl": "https://customer-xxx.cloudflarestream.com/xxx/manifest/video.m3u8",
    "cloudflareStreamStatus": "ready"
  }
}
```

## 🔄 Flow การทำงาน

1. **รับคำขอ** → Validate URL และ site
2. **เข้าคิว** → เพิ่มใน MongoDB queue (type: 'stream')
3. **ดาวน์โหลด** → ดาวน์โหลดวิดีโอจาก URL
4. **อัปโหลด** → อัปโหลดไปยัง Cloudflare Stream API
5. **เสร็จสิ้น** → อัปเดตสถานะและ playback URL

## 🧪 การทดสอบ

รันไฟล์ทดสอบ:
```bash
node cloudflare-stream-test.js
```

## 🎬 Frontend Integration

ใน dashboard จะแสดง:
- ประเภทงาน: "อัปโหลด Cloudflare Stream" 
- Stream ID และสถานะ Cloudflare
- ปุ่ม "เล่นวิดีโอ" เมื่อเสร็จสิ้น
- ปุ่ม "Copy ID" สำหรับคัดลอก Stream ID
