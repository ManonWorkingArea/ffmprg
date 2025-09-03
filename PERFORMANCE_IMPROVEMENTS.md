# การปรับปรุงประสิทธิภาพระบบ FFmpeg Video Transcoding

## 🚀 การปรับปรุงที่ทำไป

### 1. **การจำกัดจำนวนงานพร้อมกัน (Concurrent Job Limiting)**
- จำกัดงานที่ทำพร้อมกันสูงสุด 3 งาน (`MAX_CONCURRENT_JOBS = 3`)
- ป้องกันระบบโหลดหนักเกินไปจากการประมวลผลหลายไฟล์พร้อมกัน
- ระบบจะทำงานแบบ queue อย่างเป็นระเบียบ

### 2. **Timeout Management**
- **Download Timeout**: 30 นาที สำหรับการดาวน์โหลดไฟล์
- **FFmpeg Timeout**: 2 ชั่วโมง สำหรับการประมวลผลวิดีโอ
- ป้องกัน process ค้างและใช้ resource มากเกินไป

### 3. **File Size Limits**
- จำกัดขนาดไฟล์สูงสุด 5GB
- ตรวจสอบประเภทไฟล์ (เฉพาะ video และ audio)
- ป้องกันการอัปโหลดไฟล์ที่ไม่เหมาะสม

### 4. **Queue Management**
- จำกัดคิวสูงสุด 50 งาน
- ระบบ FIFO (First In, First Out)
- แสดงตำแหน่งในคิวให้ผู้ใช้ทราบ

### 5. **Error Handling & Recovery**
- ระบบ retry อัตโนมัติสำหรับงานที่ล้มเหลว
- Cleanup ไฟล์ชั่วคราวเมื่อเกิดข้อผิดพลาด
- Graceful shutdown เมื่อปิดเซิร์ฟเวอร์

### 6. **Memory Management**
- ปรับปรุงการจัดการ stream สำหรับไฟล์ใหญ่
- ลบไฟล์ชั่วคราวทันทีหลังการประมวลผล
- ป้องกัน memory leak

### 7. **Monitoring & Management**
- Dashboard แสดงสถานะระบบแบบเรียลไทม์
- ปุ่ม retry งานที่ล้มเหลว
- ปุ่ม cleanup งานเก่า
- แสดงจำนวน concurrent jobs และ queue

## 🛠️ Endpoints ใหม่

### System Status
```http
GET /system-status
```
ดูสถานะระบบโดยรวม รวมถึงจำนวนงานที่กำลังทำ, คิว, และ error

### Retry Failed Tasks
```http
POST /retry-failed
```
เริ่มงานที่ล้มเหลวใหม่

### Cleanup Old Tasks
```http
DELETE /cleanup-old-tasks
```
ลบงานเก่าที่เก็บไว้เกิน 1 สัปดาห์

## ⚙️ การตั้งค่าที่เปลี่ยนแปลง

```javascript
// Constants ใหม่
const MAX_CONCURRENT_JOBS = 3;           // จำนวนงานพร้อมกัน
const DOWNLOAD_TIMEOUT = 30 * 60 * 1000; // 30 นาที
const FFMPEG_TIMEOUT = 2 * 60 * 60 * 1000; // 2 ชั่วโมง

// File limits
fileSize: 5 * 1024 * 1024 * 1024 // 5GB
queueLimit: 50 // 50 งาน
```

## 📈 ผลลัพธ์ที่คาดหวัง

1. **ป้องกัน Server Crash** จากการประมวลผลหลายไฟล์ใหญ่พร้อมกัน
2. **ระบบเสถียรขึ้น** ด้วยการจำกัด resource usage
3. **การจัดการ Error ดีขึ้น** พร้อม retry mechanism
4. **Monitoring ที่ดีขึ้น** สามารถติดตามสถานะระบบได้แบบเรียลไทม์
5. **ทำความสะอาดอัตโนมัติ** ป้องกัน storage เต็ม

## 🔧 การ Deploy

1. สำรองข้อมูลเก่า
2. Deploy โค้ดใหม่
3. Restart service
4. ตรวจสอบ dashboard ที่ `/`
5. ทดสอบอัปโหลดไฟล์ใหญ่

## 📝 การใช้งาน

### สำหรับ Admin
- เข้า Dashboard เพื่อดูสถานะระบบ
- ใช้ปุ่ม "Retry Failed Tasks" เมื่อมีงานล้มเหลว
- ใช้ "Cleanup Old Tasks" เพื่อลบงานเก่า

### สำหรับ Developer
- ตรวจสอบ logs สำหรับ concurrent job management
- Monitor memory usage ผ่าน system metrics
- ใช้ `/system-status` endpoint สำหรับ health check

## ⚠️ ข้อควรระวัง

1. **ไฟล์ใหญ่มาก (>5GB)** จะถูกปฏิเสธ
2. **คิวเต็ม (>50 งาน)** จะได้รับ HTTP 429
3. **Timeout เกิดขึ้น** งานจะถูกหยุดและ retry ได้ภายหลัง
4. **Server restart** งานที่กำลังทำอยู่จะถูกหยุดและตั้งเป็น 'stopped'
