# 🚀 Advanced Video Trimming API Documentation

## 📋 Overview

Enhanced `/trim` endpoint รองรับการตัดต่อวิดีโอขั้นสูง พร้อม multi-segment, overlays, และ advanced features

---

## 🔗 **API Endpoint**

- **URL**: `POST /trim`
- **Content-Type**: `application/json` หรือ `multipart/form-data`
- **Modes**: Basic Trim หรือ Advanced Multi-Segment Trim

---

## 🎯 **Supported Features**

### ✅ **Core Features**
- Single segment trim (ตัดช่วงเดียว)
- Multi-segment trim (ตัดหลายช่วงรวมกัน)
- Text overlays ด้วยฟอนต์ไทย
- Image overlays ด้วยการรักษาสัดส่วน
- Volume control
- Quality selection

### ✅ **Advanced Features**  
- URL input (ไม่ต้องอัปโหลดไฟล์)
- Multiple segments concatenation
- Time-based overlays
- Percentage-based positioning
- Hardware acceleration
- Custom threading

---

## 📝 **Request Format**

### **Advanced JSON Payload** (แนะนำ)

```json
{
  "input_url": "https://example.com/video.mp4",
  "trim_mode": "multi",
  "segments": [
    {
      "id": "seg_1",
      "start": 0,
      "end": 108.58,
      "duration": 108.58
    },
    {
      "id": "seg_2", 
      "start": 119.9,
      "end": 182.51,
      "duration": 62.6
    }
  ],
  "overlays": [
    {
      "type": "image",
      "id": "logo_overlay",
      "content": "https://example.com/logo.png",
      "start_time": 0,
      "end_time": 299.93,
      "position": {
        "x": 60,
        "y": 10,
        "width": 25,
        "height": 25
      },
      "style": {
        "opacity": 1,
        "rotation": 0,
        "shadow": true,
        "z_index": 15
      }
    },
    {
      "type": "text",
      "id": "title_text",
      "content": "ทดสอบ",
      "start_time": 0,
      "end_time": 299.93,
      "position": {
        "x": 10,
        "y": 10,
        "width": 30,
        "height": 15
      },
      "style": {
        "font_size": 24,
        "font_family": "sans-serif",
        "font_weight": "bold",
        "font_style": "normal",
        "color": "#FFFFFF",
        "background_color": null,
        "text_align": "center",
        "text_shadow": "0 2px 4px rgba(0,0,0,0.6)",
        "opacity": 1,
        "rotation": 0,
        "z_index": 20
      }
    }
  ],
  "video_metadata": {
    "width": 1280,
    "height": 720,
    "duration": 299.932967,
    "fps": 30
  },
  "audio_volume": 1,
  "output_format": "mp4",
  "quality": "720p",
  "processing_mode": "fast",
  "filename": "output_trimmed.mp4",
  "copy_streams": false,
  "audio_filter": null,
  "preserve_quality": false,
  "hardware_acceleration": true,
  "threads": "auto",
  "site": "example.com",
  "storage": "storage_id_here",
  "client_info": {
    "platform": "web",
    "user_agent": "Mozilla/5.0...",
    "timestamp": "2025-09-05T03:53:21.017Z",
    "session_id": "session_123"
  }
}
```

### **Basic Form Data** (สำหรับไฟล์อัปโหลด)

```bash
curl -X POST https://media.cloudrestfulapi.com/trim \
  -F "video=@input.mp4" \
  -F "startTime=00:01:30" \
  -F "endTime=00:03:45" \
  -F "quality=720p"
```

---

## 📊 **Request Parameters**

### **Core Parameters**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input_url` | string | Yes* | URL ของวิดีโอ (หรือใช้ file upload) |
| `trim_mode` | string | No | `"single"` หรือ `"multi"` (default: single) |
| `quality` | string | No | `"240p"`, `"420p"`, `"720p"`, `"1080p"` (default: 720p) |

### **Segments** (สำหรับ multi-trim)
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `segments[].id` | string | Yes | ID ของ segment |
| `segments[].start` | number | Yes | เวลาเริ่มต้น (วินาที) |
| `segments[].end` | number | Yes | เวลาสิ้นสุด (วินาที) |
| `segments[].duration` | number | No | ระยะเวลา (คำนวณอัตโนมัติ) |

### **Overlays**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `overlays[].type` | string | Yes | `"text"` หรือ `"image"` |
| `overlays[].content` | string | Yes | ข้อความหรือ URL ของรูปภาพ |
| `overlays[].start_time` | number | No | เวลาเริ่มแสดง (วินาที) |
| `overlays[].end_time` | number | No | เวลาสิ้นสุดการแสดง (วินาที) |
| `overlays[].position.x` | number | Yes | ตำแหน่ง X (เปอร์เซ็นต์ 0-100) |
| `overlays[].position.y` | number | Yes | ตำแหน่ง Y (เปอร์เซ็นต์ 0-100) |

### **Advanced Options**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `processing_mode` | string | `"fast"` | `"fast"`, `"medium"`, `"slow"` |
| `hardware_acceleration` | boolean | `true` | ใช้ hardware acceleration |
| `threads` | string | `"auto"` | จำนวน threads (`"auto"` หรือตัวเลข) |
| `audio_volume` | number | `1` | ระดับเสียง (0.0 - 2.0) |
| `preserve_quality` | boolean | `false` | รักษาคุณภาพสูงสุด |

---

## ✅ **Success Response**

```json
{
  "success": true,
  "taskId": "abc123-def456-789",
  "message": "Video multi trim task queued successfully",
  "trimMode": "multi",
  "segments": 3,
  "overlays": 2,
  "quality": "720p",
  "processingMode": "fast"
}
```

---

## 📋 **Real-World Examples**

### **1. Multi-Segment Highlight Reel**
```javascript
// สร้างไฮไลท์รีลจากช่วงต่างๆ ของเกม
{
  "input_url": "https://example.com/football-match.mp4",
  "trim_mode": "multi",
  "segments": [
    {"start": 300, "end": 330},    // ประตูแรก
    {"start": 1800, "end": 1850},  // ประตูที่สอง  
    {"start": 2700, "end": 2730}   // ประตูชัย
  ],
  "overlays": [
    {
      "type": "text",
      "content": "⚽ GOAL HIGHLIGHTS",
      "position": {"x": 50, "y": 10},
      "style": {"font_size": 36, "color": "#FFD700"}
    }
  ]
}
```

### **2. Tutorial with Logo**
```javascript
// วิดีโอสอนการใช้งานพร้อมโลโก้
{
  "input_url": "https://example.com/tutorial.mp4", 
  "trim_mode": "single",
  "segments": [{"start": 30, "end": 600}], // ข้าม intro
  "overlays": [
    {
      "type": "image",
      "content": "https://example.com/watermark.png",
      "position": {"x": 85, "y": 85, "width": 10, "height": 10},
      "style": {"opacity": 0.7}
    }
  ]
}
```

### **3. Social Media Clip**
```javascript
// คลิปสั้นสำหรับ Instagram
{
  "input_url": "https://example.com/long-video.mp4",
  "trim_mode": "single", 
  "segments": [{"start": 120, "end": 135}], // 15 วินาที
  "quality": "720p",
  "overlays": [
    {
      "type": "text",
      "content": "@username",
      "position": {"x": 10, "y": 90},
      "style": {"font_size": 20, "color": "#FFFFFF"}
    }
  ]
}
```

---

## 🔧 **Technical Implementation**

### **Multi-Segment Processing**
- ใช้ FFmpeg `trim` filter สำหรับแต่ละ segment
- `concat` filter เพื่อรวม segments เข้าด้วยกัน
- รักษา sync ระหว่าง video และ audio

### **Overlay Processing**
- Text overlays ใช้ `drawtext` filter ด้วยฟอนต์ไทย
- Image overlays ใช้ `overlay` filter ด้วยการรักษาสัดส่วน
- รองรับ time-based overlays ด้วย `enable` parameter

### **Performance Optimizations**
- Hardware acceleration (NVENC/VAAPI)
- Multi-threading support
- Stream copying เมื่อเป็นไปได้
- Smart preset selection

---

## ⚡ **Performance Notes**

### **Speed Comparison**
- **Single trim**: 2-5x เร็วกว่า full conversion
- **Multi-segment**: ขึ้นกับจำนวน segments
- **With overlays**: เพิ่มเวลา 20-40%

### **Resource Usage**
- **CPU**: ขึ้นกับ threads และ preset
- **Memory**: ~500MB per concurrent job
- **Disk**: temp files สำหรับ intermediate processing

---

## 🚨 **Limitations & Notes**

### **File Limits**
- **Max file size**: 5GB
- **Max segments**: 20 segments per job
- **Max overlays**: 10 overlays per job

### **Format Support**
- **Input**: MP4, AVI, MOV, MKV, WebM
- **Output**: MP4 (H.264 + AAC)
- **Images**: PNG, JPG, GIF

### **Important Notes**
- Segments จะถูกรวมตามลำดับใน array
- Overlays มี z-index support
- Time-based overlays จะคำนวณจากวิดีโอ output
- URL inputs จะถูก download ก่อนประมวลผล

---

**Status**: ✅ Production Ready  
**API Version**: 2.0  
**Last Updated**: September 5, 2025
