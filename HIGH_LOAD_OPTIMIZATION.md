# การปรับปรุงระบบสำหรับ High-Load Scenario

## 🚨 ปัญหาที่พบ
- **CPU Usage ที่ 99%** เมื่อมี 3 jobs ทำงานพร้อมกัน
- ระบบอาจล่มหรือตอบสนองช้าเมื่อโหลดหนัก
- การใช้ resource ไม่มีประสิทธิภาพ

## ⚡ การแก้ไขที่ทำ

### 1. **ลดจำนวน Concurrent Jobs**
```javascript
// เปลี่ยนจาก 3 เป็น 1 งาน
const MAX_CONCURRENT_JOBS = 1;
```
**เหตุผล**: ป้องกัน CPU overload และให้ระบบมีเสถียรภาพมากขึ้น

### 2. **ปรับ FFmpeg Settings สำหรับประหยัด CPU**
```javascript
.outputOptions([
  '-preset', 'slower',        // เปลี่ยนจาก veryfast เป็น slower
  '-crf', '25',               // เพิ่มจาก 22 เป็น 25 (ลดคุณภาพเล็กน้อย แต่ลด load)
  '-threads', '2',            // จำกัดจำนวน threads
  '-movflags', '+faststart'   // optimize สำหรับ streaming
])
```

### 3. **เพิ่ม System Load Monitoring**
```javascript
async function checkSystemLoad() {
  const cpuUsage = await cpu.usage();
  const memInfo = await mem.info();
  
  // หยุดรับงานใหม่เมื่อ CPU > 80% หรือ Memory > 85%
  const cpuOverload = cpuUsage > 80;
  const memoryOverload = (memInfo.usedMemMb / memInfo.totalMemMb) * 100 > 85;
  
  return {
    canProcess: !cpuOverload && !memoryOverload,
    cpuUsage,
    memoryUsage: (memInfo.usedMemMb / memInfo.totalMemMb) * 100
  };
}
```

### 4. **Smart Queue Management**
- ตรวจสอบ system load ก่อนเริ่มงานใหม่
- หน่วงเวลาเมื่อระบบโหลดหนัก
- แสดงสถานะ load ใน dashboard

### 5. **Process Priority Management**
```javascript
.on('start', (commandLine) => {
  // ตั้งค่า nice priority เพื่อให้ process อื่นๆ ได้รับ CPU
  spawn('renice', ['10', '-p', process.pid]);
})
```

## 📊 ผลลัพธ์ที่คาดหวัง

### Before (3 Jobs):
- CPU: 99% 🔴
- Memory: High usage
- System: Unstable
- Response: Slow

### After (1 Job + Optimizations):
- CPU: 30-50% 🟢
- Memory: Controlled usage
- System: Stable
- Response: Responsive

## 🎛️ การตั้งค่าใหม่

### Concurrent Jobs
```
Max Jobs: 1 (ลดจาก 3)
Queue Limit: 50 งาน
```

### Timeouts
```
Download: 30 นาที
FFmpeg: 3 ชั่วโมง (เพิ่มขึ้น)
```

### FFmpeg Preset
```
Preset: slower (ประหยัด CPU)
CRF: 25 (ลดขนาดไฟล์)
Threads: 2 (จำกัด CPU cores)
```

### Load Thresholds
```
CPU Limit: 80%
Memory Limit: 85%
Delay when overload: 30-60 วินาที
```

## 🔧 การตรวจสอบประสิทธิภาพ

### 1. **System Metrics**
```bash
# ดู CPU และ Memory usage
htop

# ดู load average
uptime

# ดู disk I/O
iostat
```

### 2. **Application Metrics**
```bash
# ดู active jobs
curl /system-status

# ดู system load from app
curl /system-metrics
```

### 3. **Dashboard Monitoring**
- ดู CPU/Memory usage charts
- ตรวจสอบ System Load indicator
- Monitor concurrent jobs ratio

## ⚠️ Trade-offs

### เวลาประมวลผล
- **เพิ่มขึ้น**: เนื่องจากทำ 1 งานต่อครั้ง
- **แต่เสถียร**: ไม่มีปัญหาระบบล่ม

### คุณภาพวิดีโอ
- **ลดเล็กน้อย**: CRF 25 แทน 22
- **แต่ประหยัด**: ลด file size และ processing time

### Throughput
- **ลดในระยะสั้น**: เนื่องจากทำครั้งละงาน
- **เพิ่มในระยะยาว**: เนื่องจากไม่มี system crash

## 🚀 การ Deploy

### 1. **Backup ข้อมูลเก่า**
```bash
# Backup database
mongodump --db API

# Backup files
tar -czf backup.tar.gz uploads/ outputs/
```

### 2. **Deploy ระบบใหม่**
```bash
# Pull latest code
git pull origin main

# Restart service
pm2 restart app
```

### 3. **Monitor หลัง Deploy**
```bash
# ดู logs
pm2 logs app

# ดู system metrics
watch -n 5 'curl -s localhost:3000/system-status | jq'
```

## 📈 การ Scale ในอนาคต

### เมื่อต้องการประสิทธิภาพสูงขึ้น:

1. **Upgrade Hardware**
   - เพิ่ม CPU cores
   - เพิ่ม RAM
   - ใช้ SSD storage

2. **Horizontal Scaling**
   - ใช้ multiple servers
   - Load balancer
   - Distributed queue system

3. **Optimization**
   - GPU encoding (NVENC/QuickSync)
   - Container-based isolation
   - CDN สำหรับ file delivery

## 🎯 KPIs ที่ต้องติดตาม

### System Health
- CPU usage < 80%
- Memory usage < 85%
- Disk space > 20% free
- Load average < number of cores

### Application Performance
- Queue processing time
- Error rate < 5%
- Success rate > 95%
- Average completion time

### User Experience
- API response time < 2s
- Queue wait time
- Download success rate
