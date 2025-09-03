# การปรับปรุงตามสเปค Server จริง

## 📊 Server Specifications
- **CPU**: 4 Cores (Intel)
- **Memory**: 8,192 MB (8 GB)
- **Disk**: 120 GB SSD
- **Platform**: DigitalOcean Basic Droplet

## 🔍 Current Usage (จากรูป)
- **CPU**: 98% 🔴 (เกือบเต็ม)
- **Memory**: 20% 🟢 (1,666 MB / 8,192 MB)
- **Disk**: 11% 🟢 (13 GB / 120 GB)

## ⚡ การปรับปรุงตามสเปคจริง

### 1. **Load Thresholds ที่เหมาะสม**
```javascript
// สำหรับ 4-core server
const cpuThreshold = 85%;    // เพิ่มจาก 80% เนื่องจากมี 4 cores
const memoryThreshold = 80%; // ลดจาก 85% เนื่องจากมี Memory เหลือเยอะ
```

### 2. **FFmpeg Optimization สำหรับ 4 cores**
```javascript
.outputOptions([
  '-preset', 'medium',       // balance ระหว่าง speed กับ CPU usage
  '-crf', '24',              // คุณภาพดี แต่ไม่หนักเกินไป
  '-threads', '3',           // ใช้ 3 จาก 4 cores (เหลือ 1 core สำหรับระบบ)
  '-maxrate', '2M',          // จำกัด bitrate
  '-bufsize', '4M'           // buffer size
])
```

### 3. **Process Priority**
```javascript
spawn('renice', ['5', '-p', process.pid]); // ลด nice value เป็น 5 (จาก 10)
```

## 📈 การใช้งาน Resource ที่คาดหวัง

### Before Optimization:
```
CPU: 98% (เกือบล้ม)
Memory: 20% (ปกติ)
Disk: 11% (ปกติ)
Concurrent Jobs: 3 (มากเกินไป)
```

### After Optimization:
```
CPU: 60-75% (เสถียร)
Memory: 25-30% (เพิ่มขึ้นเล็กน้อย)
Disk: 11-15% (ปกติ)
Concurrent Jobs: 1 (เสถียร)
```

## 🎯 เกณฑ์การทำงานใหม่

### CPU Management
- **เกณฑ์หยุด**: > 85% (เนื่องจากมี 4 cores)
- **เกณฑ์เตือน**: > 75%
- **ใช้งานปกติ**: 50-70%

### Memory Management
- **เกณฑ์หยุด**: > 80% (6.5 GB)
- **เกณฑ์เตือน**: > 70% (5.7 GB)
- **ใช้งานปกติ**: 30-50% (2.5-4 GB)

### Concurrent Jobs
- **Maximum**: 1 job (ลดจาก 3)
- **Queue Limit**: 50 jobs
- **Processing Strategy**: FIFO with load checking

## 📊 Monitoring Dashboard

### System Load Indicators
```html
CPU: 65% (เกณฑ์: 85%)     ✅ ปกติ
Memory: 35% (เกณฑ์: 80%)  ✅ ปกติ
Jobs: 1/1                  ✅ เต็มกำลัง
```

### Load Status Colors
- 🟢 **Green**: ใต้ 70% (ปกติ)
- 🟡 **Yellow**: 70-threshold (เตือน)
- 🔴 **Red**: เกิน threshold (อันตราย)

## 🔧 FFmpeg Settings Comparison

| Setting | Before | After | Reason |
|---------|--------|-------|---------|
| Preset | veryfast | medium | Balance speed/CPU |
| CRF | 22 | 24 | Reduce file size |
| Threads | 2 | 3 | Use more cores efficiently |
| Nice | 10 | 5 | Higher priority |
| Maxrate | - | 2M | Control bitrate |

## 🚀 Performance Expectations

### Processing Time
- **Small files** (< 100MB): 2-5 minutes
- **Medium files** (100MB-1GB): 10-30 minutes
- **Large files** (1-5GB): 30-90 minutes

### System Stability
- **CPU spikes**: Controlled under 85%
- **Memory usage**: Stable around 30-40%
- **No system crashes**: Due to load monitoring

### Queue Processing
- **1 job at a time**: Ensures stability
- **Smart queuing**: Waits during high load
- **Automatic retry**: For failed jobs

## 📋 Monitoring Checklist

### Real-time Monitoring
- [ ] CPU usage < 85%
- [ ] Memory usage < 80%
- [ ] Active jobs ≤ 1
- [ ] Queue processing normally
- [ ] No error accumulation

### Daily Checks
- [ ] Review failed jobs
- [ ] Check disk space growth
- [ ] Monitor average processing times
- [ ] Verify system logs

### Weekly Maintenance
- [ ] Clean old completed jobs
- [ ] Review performance metrics
- [ ] Update thresholds if needed
- [ ] Check for resource leaks

## 🔄 Auto-scaling Strategy

### Current: Vertical Scaling
```
Current: 4 cores, 8GB RAM
Option 1: 6 cores, 12GB RAM → 2 concurrent jobs
Option 2: 8 cores, 16GB RAM → 3 concurrent jobs
```

### Future: Horizontal Scaling
```
Server 1: Primary processing
Server 2: Queue overflow
Server 3: Backup/failover
Load Balancer: Distribute load
```

## 🎛️ Emergency Procedures

### High CPU (> 90%)
1. Stop accepting new jobs
2. Wait for current job to complete
3. Check for stuck processes
4. Restart if necessary

### High Memory (> 90%)
1. Kill non-essential processes
2. Clear temporary files
3. Restart application
4. Monitor for memory leaks

### Disk Full (> 95%)
1. Stop all processing
2. Clean temporary files
3. Move old outputs to backup
4. Increase disk space

## 📞 Alert Configuration

### CPU Alerts
- **Warning**: > 75% for 5 minutes
- **Critical**: > 85% for 2 minutes

### Memory Alerts
- **Warning**: > 70% for 10 minutes
- **Critical**: > 80% for 5 minutes

### Queue Alerts
- **Warning**: > 30 jobs waiting
- **Critical**: > 45 jobs waiting
