const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');
const { createClient } = require('redis');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const fs = require('fs'); 
const mongoose = require('mongoose');
const { S3 } = require('@aws-sdk/client-s3');
const osu = require('node-os-utils')
const cpu = osu.cpu
const mem = osu.mem
const drive = osu.drive

const { getHostnameData, getSpaceData } = require('./middleware/hostname'); // Import the function

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // เพิ่ม limit สำหรับ JSON
app.use(express.urlencoded({ limit: '50mb', extended: true })); // เพิ่ม limit สำหรับ URL encoded
app.use(express.static('public'));
app.use(express.static('outputs'));

// ปรับปรุงการตั้งค่า multer สำหรับไฟล์ใหญ่
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit
    fieldSize: 10 * 1024 * 1024 // 10MB limit for other fields
  },
  fileFilter: (req, file, cb) => {
    // ตรวจสอบประเภทไฟล์
    if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video and audio files are allowed'), false);
    }
  }
});

// เชื่อมต่อกับ MongoDB
mongoose.connect('mongodb+srv://vue:Qazwsx1234!!@cloudmongodb.wpc62e9.mongodb.net/API', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDB :: Connected.');
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
});

// สร้าง Schema และ Model สำหรับคิว
const taskSchema = new mongoose.Schema({
  taskId: String,
  status: String,
  quality: String,
  createdAt: Date,
  inputPath: String,
  outputFile: String,
  percent: Number,
  url: String,
  site: Object,
  space: Object,
  storage: String
});

const Task = mongoose.model('Queue', taskSchema);

// สร้าง Schema สำหรับ Storage
const storageSchema = new mongoose.Schema({
  owner: { type: String, required: true }, // เจ้าของ
  original: { type: String, required: true }, // ชื่อไฟล์ต้นฉบับ
  path: { type: String, required: true }, // URL ของไฟล์
  parent: { type: String, default: '' }, // ID ของ parent
  name: { type: String, required: true }, // ชื่อไฟล์
  size: { type: Number, required: true }, // ขนาดไฟล์
  type: { type: String, required: true }, // ประเภทไฟล์
  mimetype: { type: String, required: true }, // MIME type
  spaceId: { type: String, required: true }, // ID ของพื้นที่
  createdAt: { type: Date, default: Date.now }, // วันที่สร้าง
  updatedAt: { type: Date, default: Date.now }, // วันที่อัปเดต
  duration: { type: Number, default: 0 }, // ระยะเวลา (สำหรับไฟล์มีเดีย)
  thumbnail: { type: String, default: '' }, // URL ของ thumbnail
  transcode: { type: Object, default: {} } // เพิ่มฟิลด์ transcode
});

// สร้างโมเดล Storage
const Storage = mongoose.model('storage', storageSchema, 'storage'); // Specify collection name as 'hostname'

let ffmpegProcesses = {}; // เก็บข้อมูลเกี่ยวกับกระบวนการ ffmpeg
let isProcessing = false; // ตัวแปรเพื่อบอกสถานะการประมวลผล
let concurrentJobs = 0; // ตัวนับงานที่กำลังทำพร้อมกัน
// Configuration constants
const MAX_CONCURRENT_JOBS = 2; // Sweet spot: Balance performance & stability // ทำงานทีละงานเพื่อประสิทธิภาพสูงสุด
const DOWNLOAD_TIMEOUT = 30 * 60 * 1000; // 30 นาที สำหรับดาวน์โหลด
const FFMPEG_TIMEOUT = 3 * 60 * 60 * 1000; // 3 ชั่วโมง สำหรับไฟล์ใหญ่

const baseUrl = `http://159.65.131.165:${port}`; // อัปเดต base URL

// Endpoint: Get video metadata from URL
app.post('/metadata', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL is required' });
  }

  console.log('Getting metadata for URL:', url);

  try {
    // ใช้ ffprobe เพื่อดึง metadata โดยไม่ต้องดาวน์โหลดไฟล์
    ffmpeg.ffprobe(url, (err, metadata) => {
      if (err) {
        console.error('Error getting metadata:', err);
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to get video metadata',
          details: err.message 
        });
      }

      // ดึงข้อมูลสำคัญจาก metadata
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
      
      const videoInfo = {
        success: true,
        metadata: {
          format: {
            filename: metadata.format.filename,
            format_name: metadata.format.format_name,
            format_long_name: metadata.format.format_long_name,
            duration: parseFloat(metadata.format.duration),
            size: parseInt(metadata.format.size) || 0,
            bit_rate: parseInt(metadata.format.bit_rate) || 0,
            nb_streams: metadata.format.nb_streams,
            tags: metadata.format.tags || {}
          },
          video: videoStream ? {
            codec_name: videoStream.codec_name,
            codec_long_name: videoStream.codec_long_name,
            width: videoStream.width,
            height: videoStream.height,
            aspect_ratio: videoStream.display_aspect_ratio || `${videoStream.width}:${videoStream.height}`,
            pixel_format: videoStream.pix_fmt,
            frame_rate: videoStream.r_frame_rate,
            avg_frame_rate: videoStream.avg_frame_rate,
            bit_rate: parseInt(videoStream.bit_rate) || 0,
            duration: parseFloat(videoStream.duration) || 0,
            tags: videoStream.tags || {}
          } : null,
          audio: audioStream ? {
            codec_name: audioStream.codec_name,
            codec_long_name: audioStream.codec_long_name,
            sample_rate: parseInt(audioStream.sample_rate) || 0,
            channels: audioStream.channels,
            channel_layout: audioStream.channel_layout,
            bit_rate: parseInt(audioStream.bit_rate) || 0,
            duration: parseFloat(audioStream.duration) || 0,
            tags: audioStream.tags || {}
          } : null,
          streams: metadata.streams.map(stream => ({
            index: stream.index,
            codec_name: stream.codec_name,
            codec_type: stream.codec_type,
            duration: parseFloat(stream.duration) || 0,
            bit_rate: parseInt(stream.bit_rate) || 0
          }))
        }
      };

      console.log('Metadata extracted successfully');
      res.json(videoInfo);
    });

  } catch (error) {
    console.error('Error processing metadata request:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process metadata request',
      details: error.message 
    });
  }
});

// Grouped Endpoints

// Endpoint: Add conversion task to queue
app.post('/convert', upload.single('video'), async (req, res) => {
  console.log('Received conversion request');
  const quality = req.body.quality || '720p';
  const site = req.body.site;
  let taskId;

  // Validate if site is provided
  if (!site) {
    console.log('Site is required');
    return res.status(400).json({ success: false, error: 'Site is required' });
  }

  // ตรวจสอบคิวที่รอ
  const queuedCount = await Task.countDocuments({ status: 'queued' });
  const processingCount = await Task.countDocuments({ status: 'processing' });
  
  // ตรวจสอบ system load
  const systemLoad = await checkSystemLoad();
  
  if (queuedCount > 50) { // จำกัดคิวไม่เกิน 50 งาน
    return res.status(429).json({ 
      success: false, 
      error: 'Queue is full. Please try again later.',
      queueStatus: { queued: queuedCount, processing: processingCount }
    });
  }

  // หากระบบโหลดหนัก แจ้งเตือนแต่ยังรับงาน
  if (!systemLoad.canProcess) {
    console.log(`Accepting job despite high load (CPU: ${systemLoad.cpuUsage}%, Memory: ${systemLoad.memoryUsage}%)`);
  }

  // Fetch hostname data
  let hostnameData;
  let spaceData;
  try {
    hostnameData = await getHostnameData(site);
    console.log('Fetched hostname data:', hostnameData);
    if (!hostnameData) {
      console.log('Hostname not found');
      return res.status(404).json({ success: false, error: 'Hostname not found' });
    }
  } catch (error) {
    console.error('Failed to fetch hostname data:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch hostname data' });
  }

  try {
    spaceData = await getSpaceData(hostnameData.spaceId);
    console.log('Fetched space data:', spaceData);
    if (!spaceData) {
      console.log('Space not found');
      return res.status(404).json({ success: false, error: 'Space not found' });
    }
  } catch (error) {
    console.error('Failed to fetch space data:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch space data' });
  }

  try {
    if (req.file) {
      console.log('File uploaded:', req.file.path);
      // ตรวจสอบขนาดไฟล์
      if (req.file.size > 5 * 1024 * 1024 * 1024) { // 5GB
        return res.status(400).json({ success: false, error: 'File size exceeds 5GB limit' });
      }
      
      const existingTask = await Task.findOne({ inputPath: req.file.path, quality: quality });
      if (existingTask) {
        console.log('Existing task found:', existingTask.taskId);
        return res.json({ success: true, taskId: existingTask.taskId });
      }
      taskId = uuidv4();
    } else if (req.body.url) {
      console.log('URL provided:', req.body.url);
      const existingTask = await Task.findOne({ url: req.body.url, quality: quality });
      if (existingTask) {
        console.log('Existing task found:', existingTask.taskId);
        return res.json({ success: true, taskId: existingTask.taskId });
      }
      taskId = uuidv4();
    } else {
      console.log('No video file or URL provided');
      return res.status(400).json({ success: false, error: 'Video file or URL required' });
    }

    // Construct task data with hostname reference
    const taskData = {
      taskId,
      status: 'queued',
      quality,
      createdAt: Date.now(),
      outputFile: null,
      inputPath: req.file ? req.file.path : undefined,
      inputFileSize: req.file ? req.file.size : null, // เพิ่มขนาดไฟล์ต้นฉบับ
      outputFileSize: null, // จะอัปเดตหลังจากแปลงเสร็จ
      url: req.body.url,
      site: hostnameData,
      space: spaceData,
      storage: req.body.storage,
      retryCount: 0 // เพิ่มตัวนับการ retry
    };

    console.log('Task data created:', taskData);
    await Task.create(taskData);

    // อัปเดตข้อมูลในคอลเลกชัน storage
    if (taskData.storage) {
      await Storage.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(taskData.storage) },
        { $set: { [`transcode.${taskData.quality}`]: 'queue...' } },
        { new: true }
      ).exec();
    }

    console.log('Process queue started for task:', taskId);
    // เริ่มประมวลผลทันทีหากมีช่องว่าง
    if (concurrentJobs < MAX_CONCURRENT_JOBS) {
      processQueue(taskId, taskData);
    }

    res.json({ 
      success: true, 
      taskId, 
      downloadLink: `${baseUrl}/outputs/${taskId}-output.mp4`,
      site: hostnameData,
      space: spaceData,
      queuePosition: queuedCount + 1
    });

  } catch (error) {
    console.error('Error in convert endpoint:', error);
    
    // ทำความสะอาดไฟล์ที่อัปโหลดหากเกิดข้อผิดพลาด
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up uploaded file:', cleanupError);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Endpoint: Check status and get result
app.get('/status/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  const task = await Task.findOne({ taskId }); // ค้นหาข้อมูลใน MongoDB

  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }
  
  const response = {
    success: true,
    task,
    percent: task.status === 'processing' ? calculatePercent(task) : 100, // คำนวณเปอร์เซ็นต์ถ้ากำลังประมวลผล
    downloadLink: task.status === 'completed' ? `${baseUrl}/outputs/${taskId}-output.mp4` : null // ส่งลิงก์ดาวน์โหลดถ้าสถานะเป็น 'completed'
  };

  res.json(response);
});

// Endpoint: Get all tasks in the queue
app.get('/tasks', async (req, res) => {
  try {
    const tasks = await Task.find(); // ดึงข้อมูลทั้งหมดจาก MongoDB
    
    // เพิ่มข้อมูลขนาดไฟล์ที่อ่านง่าย
    const enhancedTasks = tasks.map(task => {
      const taskObj = task.toObject();
      return {
        ...taskObj,
        inputFileSizeFormatted: formatFileSize(taskObj.inputFileSize),
        outputFileSizeFormatted: formatFileSize(taskObj.outputFileSize),
        compressionRatio: getCompressionRatio(taskObj.inputFileSize, taskObj.outputFileSize)
      };
    });
    
    res.json({ success: true, tasks: enhancedTasks }); // คืนค่าข้อมูลทั้งหมด
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tasks' });
  }
});

// Endpoint: Start task by ID
app.post('/start/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  const task = await Task.findOne({ taskId }); // ค้นหางานใน MongoDB

  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  // อนุญาตให้เริ่มงานใหม่ได้หากสถานะเป็น 'error'
  if (task.status !== 'queued' && task.status !== 'error') {
    return res.status(400).json({ success: false, error: 'Task is not in a queued or error state' });
  }

  // เริ่มกระบวนการ ffmpeg
  processQueue(taskId, task);

  res.json({ success: true, message: `Task ${taskId} started.` });
});

// Endpoint: Stop ffmpeg process
app.post('/stop/:taskId', async (req, res) => {
  const taskId = req.params.taskId;

  if (ffmpegProcesses[taskId]) {
    ffmpegProcesses[taskId].kill('SIGINT'); // ส่งสัญญาณให้หยุดกระบวนการ
    delete ffmpegProcesses[taskId]; // ลบกระบวนการจากรายการ
    await Task.updateOne({ taskId }, { status: 'stopped' }); // อัปเดตสถานะใน MongoDB
    concurrentJobs--; // ลดตัวนับงาน
    processNextQueue(); // ลองประมวลผลงานถัดไป
    return res.json({ success: true, message: `Process for task ${taskId} stopped.` });
  } else {
    return res.status(404).json({ success: false, error: 'Task not found or already completed.' });
  }
});

// เพิ่ม endpoint สำหรับดูสถานะระบบโดยรวม
app.get('/system-status', async (req, res) => {
  try {
    const totalTasks = await Task.countDocuments();
    const queuedTasks = await Task.countDocuments({ status: 'queued' });
    const processingTasks = await Task.countDocuments({ status: 'processing' });
    const completedTasks = await Task.countDocuments({ status: 'completed' });
    const errorTasks = await Task.countDocuments({ status: 'error' });

    // ดึงข้อมูล system load
    const systemLoad = await checkSystemLoad();

    res.json({
      success: true,
      system: {
        concurrentJobs,
        maxConcurrentJobs: MAX_CONCURRENT_JOBS,
        activeProcesses: Object.keys(ffmpegProcesses).length,
        downloadTimeout: DOWNLOAD_TIMEOUT / 1000, // in seconds
        ffmpegTimeout: FFMPEG_TIMEOUT / 1000, // in seconds
        systemLoad: {
          cpuUsage: systemLoad.cpuUsage,
          memoryUsage: systemLoad.memoryUsage,
          canProcess: systemLoad.canProcess,
          thresholds: systemLoad.thresholds,
          serverSpecs: {
            cores: 4,
            ramGB: 8,
            diskGB: 120
          }
        }
      },
      tasks: {
        total: totalTasks,
        queued: queuedTasks,
        processing: processingTasks,
        completed: completedTasks,
        error: errorTasks
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get system status' });
  }
});

// เพิ่ม endpoint สำหรับ retry งานที่ error
app.post('/retry-failed', async (req, res) => {
  try {
    const result = await Task.updateMany(
      { status: 'error' },
      { $set: { status: 'queued' }, $unset: { error: 1 } }
    );
    
    // เริ่มประมวลผลงานใหม่
    processNextQueue();
    
    res.json({ 
      success: true, 
      message: `${result.modifiedCount} failed tasks have been queued for retry` 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to retry failed tasks' });
  }
});

// เพิ่ม endpoint สำหรับ cleanup งานเก่า
app.delete('/cleanup-old-tasks', async (req, res) => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await Task.deleteMany({
      createdAt: { $lt: oneWeekAgo },
      status: { $in: ['completed', 'error', 'stopped'] }
    });
    
    res.json({ 
      success: true, 
      message: `${result.deletedCount} old tasks have been cleaned up` 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to cleanup old tasks' });
  }
});

// Serve 'outputs' folder publicly
app.use('/outputs', express.static(path.join(__dirname, 'outputs')));

// เพิ่ม route สำหรับหน้าแรก
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 5GB.'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        error: 'Unexpected file field.'
      });
    }
  }
  
  if (error.message === 'Only video and audio files are allowed') {
    return res.status(400).json({
      success: false,
      error: 'Only video and audio files are allowed.'
    });
  }

  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// เพิ่ม endpoint ใหม่
app.get('/system-metrics', async (req, res) => {
  try {
    const [cpuUsage, memInfo, diskInfo] = await Promise.all([
      cpu.usage(), // CPU usage percentage
      mem.info(), // Memory information
      drive.info() // Disk information
    ])

    // แปลงค่าให้เป็นจำนวนเต็ม
    const usedMemoryMB = Math.round(memInfo.usedMemMb);
    const totalMemoryMB = Math.round(memInfo.totalMemMb);
    const usedDiskGB = Math.round(diskInfo.usedGb);
    const totalDiskGB = Math.round(diskInfo.totalGb);
    
    // คำนวณเปอร์เซ็นต์การใช้งานจากค่าจริง
    const memoryPercent = Math.round((usedMemoryMB / totalMemoryMB) * 100);
    const diskPercent = Math.round((usedDiskGB / totalDiskGB) * 100);
    
    res.json({
      cpu: {
        cores: 4, // ตาม server จริง
        usage: Math.round(cpuUsage), // ปัดเศษให้เป็นจำนวนเต็ม
        type: 'Regular Intel'
      },
      memory: {
        total: totalMemoryMB, // ใช้ค่าจริงจากระบบ
        used: usedMemoryMB,
        free: totalMemoryMB - usedMemoryMB,
        usagePercent: memoryPercent
      },
      disk: {
        total: totalDiskGB, // ใช้ค่าจริงจากระบบ
        used: usedDiskGB,
        free: totalDiskGB - usedDiskGB,
        usagePercent: diskPercent,
        bandwidth: {
          total: 5120, // 5TB
          unit: 'GB'
        }
      },
      server: {
        type: 'DigitalOcean Basic',
        specs: '4 CPU cores, 8GB RAM, 120GB SSD',
        price: {
          monthly: 48,
          hourly: 0.071
        }
      }
    })
  } catch (error) {
    console.error('Error getting system metrics:', error);
    res.status(500).json({ error: 'Failed to get system metrics' })
  }
})

// เพิ่ม endpoint สำหรับดึงข้อมูลระบบ
app.get('/server-info', (req, res) => {
  res.json({
    server: {
      framework: 'Express.js',
      port: process.env.PORT || 3000,
      baseUrl: `http://159.65.131.165:${port}`,
      storage: {
        database: 'MongoDB',
        fileStorage: 'DigitalOcean Spaces'
      },
      middleware: ['CORS', 'JSON Parser', 'Static File Server']
    },
    ffmpeg: {
      library: 'fluent-ffmpeg',
      version: ffmpeg.version || 'N/A',
      videoCodec: 'libx264',
      preset: 'veryfast',
      crfValue: 22,
      supportedResolutions: ['240p', '420p', '720p', '1080p', '1920p']
    }
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Max concurrent jobs: ${MAX_CONCURRENT_JOBS}`);
  console.log(`Download timeout: ${DOWNLOAD_TIMEOUT / 1000}s`);
  console.log(`FFmpeg timeout: ${FFMPEG_TIMEOUT / 1000}s`);
  
  // เริ่มประมวลผลงานที่ค้างอยู่เมื่อ server เริ่มทำงาน
  processNextQueue();
});

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
  console.log(`Received ${signal}. Starting graceful shutdown...`);
  
  // หยุดรับงานใหม่
  console.log('Stopping new job acceptance...');
  
  // รอให้งานที่กำลังทำอยู่เสร็จสิ้น (รอสูงสุด 30 วินาที)
  const shutdownTimeout = 30000;
  const startTime = Date.now();
  
  while (concurrentJobs > 0 && (Date.now() - startTime) < shutdownTimeout) {
    console.log(`Waiting for ${concurrentJobs} jobs to complete...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // หยุด ffmpeg processes ที่ยังค้างอยู่
  for (const taskId in ffmpegProcesses) {
    console.log(`Killing ffmpeg process for task: ${taskId}`);
    ffmpegProcesses[taskId].kill('SIGTERM');
    await Task.updateOne({ taskId }, { status: 'stopped' });
  }
  
  // ปิดการเชื่อมต่อฐานข้อมูล
  await mongoose.connection.close();
  console.log('Database connection closed.');
  
  console.log('Graceful shutdown completed.');
  process.exit(0);
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// ฟังก์ชันสำหรับ cleanup ไฟล์ชั่วคราว
async function cleanupTempFiles(inputPath, outputPath) {
  try {
    if (inputPath && fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath);
      console.log('Cleaned up input file:', inputPath);
    }
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
      console.log('Cleaned up output file:', outputPath);
    }
  } catch (error) {
    console.error('Error cleaning up files:', error);
  }
}

// ฟังก์ชันสำหรับดาวน์โหลดไฟล์พร้อม timeout
async function downloadWithTimeout(url, outputPath, timeout = DOWNLOAD_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Download timeout'));
    }, timeout);

    axios.get(url, { 
      responseType: 'stream',
      timeout: timeout,
      maxContentLength: 5 * 1024 * 1024 * 1024, // 5GB limit
      maxBodyLength: 5 * 1024 * 1024 * 1024
    })
    .then(response => {
      const writer = fs.createWriteStream(outputPath);
      
      writer.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      
      writer.on('finish', () => {
        clearTimeout(timer);
        resolve();
      });
      
      response.data.on('error', (err) => {
        clearTimeout(timer);
        writer.destroy();
        reject(err);
      });
      
      response.data.pipe(writer);
    })
    .catch(error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// ฟังก์ชันตรวจสอบ system load
async function checkSystemLoad() {
  try {
    const cpuUsage = await cpu.usage();
    const memInfo = await mem.info();
    
    // ปรับเกณฑ์สำหรับ 2 concurrent jobs (optimal balance)
    // CPU: หยุดเมื่อ > 85% (ลดจาก 90% เพื่อเสถียรภาพดีขึ้น)
    // Memory: หยุดเมื่อ > 75% (ลดจาก 85% เพื่อ safety margin)
    const cpuOverload = cpuUsage > 85;
    const memoryUsagePercent = (memInfo.usedMemMb / memInfo.totalMemMb) * 100;
    const memoryOverload = memoryUsagePercent > 75;
    
    return {
      canProcess: !cpuOverload && !memoryOverload,
      cpuUsage,
      memoryUsage: memoryUsagePercent,
      thresholds: {
        cpu: 85,    // Optimized for 2 concurrent jobs
        memory: 75  // Better safety margin
      }
    };
  } catch (error) {
    console.error('Error checking system load:', error);
    return { 
      canProcess: true, 
      cpuUsage: 0, 
      memoryUsage: 0,
      thresholds: { cpu: 90, memory: 85 }
    }; // Default to allow processing
  }
}

// Processing function
async function processQueue(taskId, taskData) {
  // ตรวจสอบ system load ก่อนเริ่มงาน
  const systemLoad = await checkSystemLoad();
  if (!systemLoad.canProcess) {
    console.log(`System overloaded (CPU: ${systemLoad.cpuUsage}%, Memory: ${systemLoad.memoryUsage}%). Task ${taskId} delayed.`);
    // รอ 30 วินาทีแล้วลองใหม่
    setTimeout(() => processQueue(taskId, taskData), 30000);
    return;
  }

  // ตรวจสอบจำนวนงานที่กำลังทำพร้อมกัน
  if (concurrentJobs >= MAX_CONCURRENT_JOBS) {
    console.log(`Max concurrent jobs reached (${MAX_CONCURRENT_JOBS}). Task ${taskId} remains queued.`);
    return;
  }

  concurrentJobs++; // เพิ่มตัวนับงาน
  console.log(`Processing queue for task: ${taskId} (Active jobs: ${concurrentJobs}/${MAX_CONCURRENT_JOBS})`);
  
  const outputFileName = `${taskId}-output.mp4`;
  const outputPath = path.join(__dirname, 'outputs', outputFileName);
  let inputPath = null;

  try {
    let videoSize;
    switch (taskData.quality) {
      case '240p': videoSize = '426x240'; break;
      case '420p': videoSize = '640x360'; break;
      case '720p': videoSize = '1280x720'; break;
      case '1080p': videoSize = '1920x1080'; break;
      case '1920p': videoSize = '1920x1080'; break;
      default: videoSize = '1280x720';
    }

    inputPath = taskData.inputPath || path.join('uploads', `${taskId}-input.mp4`);

    // If URL provided, download the video
    if (taskData.url) {
      console.log('Downloading video from URL:', taskData.url);
      await Task.updateOne({ taskId }, { status: 'downloading' });
      
      await Storage.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(taskData.storage) },
        { $set: { [`transcode.${taskData.quality}`]: 'downloading...' } },
        { new: true }
      ).exec();

      try {
        await downloadWithTimeout(taskData.url, inputPath);
        console.log('Video downloaded to:', inputPath);
      } catch (downloadError) {
        console.error('Download failed for task:', taskId, downloadError);
        throw new Error(`Download failed: ${downloadError.message}`);
      }
    }

    await Task.updateOne({ taskId }, { status: 'processing' });
    console.log('Task status updated to processing for task:', taskId);

    const spaceData = JSON.parse(JSON.stringify(await getSpaceData(taskData.site.spaceId)));
    taskData.space = spaceData;

    const s3DataConfig = taskData.space;

    // ตั้งค่า S3 โดยใช้ข้อมูลจาก taskData
    const s3Client = new S3({
      endpoint: `${taskData.space.s3EndpointDefault}`,
      region: `${taskData.space.s3Region}`,
      ResponseContentEncoding: "utf-8",
      credentials: {
        accessKeyId: s3DataConfig.s3Key,
        secretAccessKey: s3DataConfig.s3Secret
      },
      forcePathStyle: false
    });

    // เริ่มกระบวนการ ffmpeg พร้อม timeout
    console.log('Starting ffmpeg process for task:', taskId);
    
    const ffmpegProcess = ffmpeg(inputPath)
      .size(videoSize)
      .videoCodec('libx264')
      .outputOptions([
        '-preset', 'fast',        // เปลี่ยนจาก medium เป็น fast เพื่อความเร็ว
        '-crf', '23',             // ปรับจาก 24 เป็น 23 (คุณภาพดีขึ้นเล็กน้อย)
        '-threads', '2',          // ใช้ 2 threads ต่องาน (2 งาน = 4 threads รวม)
        '-movflags', '+faststart',// optimized for streaming
        '-maxrate', '3M',         // เพิ่ม bitrate จาก 2M เป็น 3M
        '-bufsize', '6M'          // เพิ่ม buffer จาก 4M เป็น 6M
      ])
      .on('start', (commandLine) => {
        console.log('Spawned FFmpeg with command: ' + commandLine);
        // ตั้งค่า nice priority ให้สูงขึ้น (ลด nice value)
        if (process.platform !== 'win32') {
          try {
            const { spawn } = require('child_process');
            spawn('renice', ['0', '-p', process.pid], { stdio: 'ignore' }); // ปรับเป็น 0 (normal priority)
          } catch (error) {
            console.log('Could not set process priority:', error.message);
          }
        }
      })
      .on('progress', async (progress) => {
        const percent = Math.round(progress.percent) || 0;
        console.log(`Processing progress for task ${taskId}: ${percent}%`);
        await Task.updateOne({ taskId }, { status: 'processing', percent });

        await Storage.findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(taskData.storage) },
          { $set: { [`transcode.${taskData.quality}`]: percent } },
          { new: true }
        ).exec();
      })
      .on('end', async () => {
        try {
          console.log('ffmpeg process completed for task:', taskId);
          delete ffmpegProcesses[taskId];
          
          // คำนวณขนาดไฟล์หลังแปลง
          const outputFileSize = fs.statSync(outputPath).size;
          console.log(`Output file size: ${(outputFileSize / 1024 / 1024).toFixed(2)} MB`);
          
          await Task.updateOne({ 
            taskId 
          }, { 
            status: 'completed', 
            outputFile: `/${outputFileName}`,
            outputFileSize: outputFileSize // บันทึกขนาดไฟล์หลังแปลง
          });
          
          // อัปโหลดไปยัง S3
          const fileContent = fs.readFileSync(outputPath);
          const params = {
            Bucket: `${taskData.space.s3Bucket}`,
            Key: `outputs/${outputFileName}`,
            Body: fileContent,
            ACL: 'public-read'
          };

          const uploadResult = await s3Client.putObject(params);
          const remoteUrl = `${taskData.space.s3Endpoint}outputs/${outputFileName}`;

          await Storage.findOneAndUpdate(
            { _id: new mongoose.Types.ObjectId(taskData.storage) },
            { $set: { [`transcode.${taskData.quality}`]: remoteUrl } },
            { new: true }
          ).exec();

          console.log("Storage updated with remote URL:", remoteUrl);
          
          // ทำความสะอาดไฟล์ชั่วคราว
          if (taskData.url) {
            await cleanupTempFiles(inputPath, null);
          }
          await cleanupTempFiles(null, outputPath);
          
        } catch (uploadError) {
          console.error('Error in post-processing for task:', taskId, uploadError);
          await Task.updateOne({ taskId }, { status: 'error', error: uploadError.message });
        } finally {
          concurrentJobs--; // ลดตัวนับงาน
          console.log(`Task ${taskId} finished. Active jobs: ${concurrentJobs}/${MAX_CONCURRENT_JOBS}`);
          processNextQueue(); // ประมวลผลงานถัดไป
        }
      })
      .on('error', async (err) => {
        try {
          console.error('ffmpeg process error for task:', taskId, err);
          delete ffmpegProcesses[taskId];
          await Task.updateOne({ taskId }, { status: 'error', error: err.message });
          
          // ทำความสะอาดไฟล์ชั่วคราว
          await cleanupTempFiles(inputPath, outputPath);
          
        } catch (cleanupError) {
          console.error('Error during cleanup for task:', taskId, cleanupError);
        } finally {
          concurrentJobs--; // ลดตัวนับงาน
          console.log(`Task ${taskId} failed. Active jobs: ${concurrentJobs}/${MAX_CONCURRENT_JOBS}`);
          processNextQueue(); // ประมวลผลงานถัดไป
        }
      });

    // เก็บ reference ของ process และเพิ่ม timeout
    ffmpegProcesses[taskId] = ffmpegProcess;
    
    // ตั้ง timeout สำหรับ ffmpeg process
    const timeoutId = setTimeout(async () => {
      if (ffmpegProcesses[taskId]) {
        console.log(`FFmpeg timeout for task: ${taskId}`);
        ffmpegProcesses[taskId].kill('SIGTERM');
        delete ffmpegProcesses[taskId];
        await Task.updateOne({ taskId }, { status: 'error', error: 'Processing timeout' });
        await cleanupTempFiles(inputPath, outputPath);
        concurrentJobs--;
        processNextQueue();
      }
    }, FFMPEG_TIMEOUT);

    // เริ่มการประมวลผล
    ffmpegProcess.save(outputPath);

  } catch (error) {
    console.error('Error in processQueue for task:', taskId, error);
    await Task.updateOne({ taskId }, { status: 'error', error: error.message });
    
    await Storage.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(taskData.storage) },
      { $set: { [`transcode.${taskData.quality}`]: 'error' } },
      { new: true }
    ).exec();
    
    await cleanupTempFiles(inputPath, outputPath);
    concurrentJobs--;
    console.log(`Task ${taskId} error. Active jobs: ${concurrentJobs}/${MAX_CONCURRENT_JOBS}`);
    processNextQueue();
  }
}

// ฟังก์ชันคำนวณเปอร์เซ็นต์
function calculatePercent(taskData) {
  return taskData.percent || 0; // คืนค่าเปอร์เซ็นต์จากข้อมูลที่บันทึกไว้
}

// ฟังก์ชันใหม่สำหรับจัดการคิวถัดไป (ปรับปรุงแล้ว)
async function processNextQueue() {
  // ตรวจสอบว่าสามารถรับงานใหม่ได้หรือไม่
  if (concurrentJobs >= MAX_CONCURRENT_JOBS) {
    console.log(`Cannot process next queue: ${concurrentJobs}/${MAX_CONCURRENT_JOBS} jobs active`);
    return;
  }

  // ตรวจสอบ system load
  const systemLoad = await checkSystemLoad();
  if (!systemLoad.canProcess) {
    console.log(`System overloaded (CPU: ${systemLoad.cpuUsage}%, Memory: ${systemLoad.memoryUsage}%). Delaying queue processing.`);
    // รอ 1 นาทีแล้วลองใหม่
    setTimeout(processNextQueue, 60000);
    return;
  }

  try {
    const nextTask = await Task.findOneAndUpdate(
      { status: 'queued' },
      { $set: { status: 'processing' } },
      { new: true, sort: { createdAt: 1 } } // เรียงตามเวลาสร้าง (FIFO)
    );
    
    if (nextTask) {
      console.log(`Found next task: ${nextTask.taskId} (Type: ${nextTask.type || 'convert'}) (System: CPU ${systemLoad.cpuUsage}%, Memory ${systemLoad.memoryUsage}%)`);
      
      // เลือก processing function ตาม task type
      setTimeout(() => {
        if (nextTask.type === 'trim') {
          processTrimQueue(nextTask.taskId, nextTask);
        } else {
          processQueue(nextTask.taskId, nextTask);
        }
      }, 2000);
    } else {
      console.log('No queued tasks found');
    }
  } catch (error) {
    console.error('Error in processNextQueue:', error);
    // หากเกิดข้อผิดพลาด ลอง process อีกครั้งในอีก 30 วินาที
    setTimeout(processNextQueue, 30000);
  }
}

// ฟังก์ชันสำหรับแปลงขนาดไฟล์ให้อ่านง่าย
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return 'N/A';
  
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  
  if (i === 0) return `${bytes} ${sizes[i]}`;
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

// ฟังก์ชันคำนวณเปอร์เซ็นต์การบีบอัด
function getCompressionRatio(inputSize, outputSize) {
  if (!inputSize || !outputSize) return null;
  
  const ratio = ((inputSize - outputSize) / inputSize * 100);
  return ratio > 0 ? ratio.toFixed(1) : 0;
}

// เพิ่มฟังก์ชันสำหรับ retry งานที่ error
async function retryFailedTasks() {
  try {
    const failedTasks = await Task.find({ status: 'error' }).limit(5);
    for (const task of failedTasks) {
      // รอ 1 นาทีก่อน retry
      if (Date.now() - new Date(task.createdAt).getTime() > 60000) {
        await Task.updateOne({ taskId: task.taskId }, { status: 'queued', error: null });
        console.log(`Retrying failed task: ${task.taskId}`);
      }
    }
  } catch (error) {
    console.error('Error in retryFailedTasks:', error);
  }
}

// เรียกใช้ retry ทุก 5 นาที
setInterval(retryFailedTasks, 5 * 60 * 1000);

// Endpoint: Video trimming with overlays
app.post('/trim', async (req, res) => {
  console.log('Received trim request');
  const trimData = req.body;
  const site = trimData.site || req.body.site;
  let taskId;

  // Validate required fields
  if (!trimData.input_url) {
    return res.status(400).json({ success: false, error: 'input_url is required' });
  }

  if (!site) {
    return res.status(400).json({ success: false, error: 'Site is required' });
  }

  if (!trimData.segments || !Array.isArray(trimData.segments) || trimData.segments.length === 0) {
    return res.status(400).json({ success: false, error: 'segments array is required' });
  }

  // ตรวจสอบคิวที่รอ
  const queuedCount = await Task.countDocuments({ status: 'queued' });
  const processingCount = await Task.countDocuments({ status: 'processing' });
  
  // ตรวจสอบ system load
  const systemLoad = await checkSystemLoad();
  
  if (queuedCount > 50) {
    return res.status(429).json({ 
      success: false, 
      error: 'Queue is full. Please try again later.',
      queueStatus: { queued: queuedCount, processing: processingCount }
    });
  }

  // Fetch hostname data
  let hostnameData;
  let spaceData;
  try {
    hostnameData = await getHostnameData(site);
    console.log('Fetched hostname data:', hostnameData);
    if (!hostnameData) {
      return res.status(404).json({ success: false, error: 'Hostname not found' });
    }

    spaceData = await getSpaceData(hostnameData.spaceId);
    console.log('Fetched space data:', spaceData);
    if (!spaceData) {
      return res.status(404).json({ success: false, error: 'Space not found' });
    }
  } catch (error) {
    console.error('Failed to fetch hostname/space data:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch configuration data' });
  }

  try {
    // Check for existing task
    const existingTask = await Task.findOne({ 
      url: trimData.input_url, 
      type: 'trim',
      'trimData.segments': { $elemMatch: { $in: trimData.segments.map(s => s.id) } }
    });
    
    if (existingTask) {
      console.log('Existing trim task found:', existingTask.taskId);
      return res.json({ success: true, taskId: existingTask.taskId });
    }

    taskId = uuidv4();

    // Construct task data with trim information
    const taskData = {
      taskId,
      type: 'trim', // Add type to distinguish from regular convert tasks
      status: 'queued',
      quality: trimData.quality || '720p',
      createdAt: Date.now(),
      outputFile: null,
      url: trimData.input_url,
      trimData: trimData, // Store all trim data
      site: hostnameData,
      space: spaceData,
      storage: trimData.storage,
      retryCount: 0
    };

    console.log('Trim task data created:', { taskId, inputUrl: trimData.input_url, segments: trimData.segments.length });
    await Task.create(taskData);

    // อัปเดตข้อมูลในคอลเลกชัน storage
    if (taskData.storage) {
      await Storage.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(taskData.storage) },
        { $set: { [`transcode.trim_${taskData.quality}`]: 'queue...' } },
        { new: true }
      ).exec();
    }

    console.log('Process trim queue started for task:', taskId);
    // เริ่มประมวลผลทันทีหากมีช่องว่าง
    if (concurrentJobs < MAX_CONCURRENT_JOBS) {
      processTrimQueue(taskId, taskData);
    }

    res.json({ 
      success: true, 
      taskId, 
      downloadLink: `${baseUrl}/outputs/${taskId}-trimmed.mp4`,
      site: hostnameData,
      space: spaceData,
      queuePosition: queuedCount + 1,
      segments: trimData.segments.length,
      totalDuration: trimData.segments.reduce((sum, seg) => sum + seg.duration, 0)
    });

  } catch (error) {
    console.error('Error in trim endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Processing function for trim tasks
async function processTrimQueue(taskId, taskData) {
  // ตรวจสอบ system load ก่อนเริ่มงาน
  const systemLoad = await checkSystemLoad();
  if (!systemLoad.canProcess) {
    console.log(`System overloaded (CPU: ${systemLoad.cpuUsage}%, Memory: ${systemLoad.memoryUsage}%). Trim task ${taskId} delayed.`);
    setTimeout(() => processTrimQueue(taskId, taskData), 30000);
    return;
  }

  // ตรวจสอบจำนวนงานที่กำลังทำพร้อมกัน
  if (concurrentJobs >= MAX_CONCURRENT_JOBS) {
    console.log(`Max concurrent jobs reached (${MAX_CONCURRENT_JOBS}). Trim task ${taskId} remains queued.`);
    return;
  }

  concurrentJobs++;
  console.log(`Processing trim queue for task: ${taskId} (Active jobs: ${concurrentJobs}/${MAX_CONCURRENT_JOBS})`);
  
  const trimData = taskData.trimData;
  const outputFileName = trimData.filename || `${taskId}-trimmed.mp4`;
  const outputPath = path.join(__dirname, 'outputs', outputFileName);
  const inputPath = path.join('uploads', `${taskId}-input.mp4`);
  let additionalInputs = []; // For storing overlay image paths

  try {
    console.log('Downloading video from URL:', trimData.input_url);
    await Task.updateOne({ taskId }, { status: 'downloading' });
    
    if (taskData.storage) {
      await Storage.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(taskData.storage) },
        { $set: { [`transcode.trim_${taskData.quality}`]: 'downloading...' } },
        { new: true }
      ).exec();
    }

    try {
      await downloadWithTimeout(trimData.input_url, inputPath);
      console.log('Video downloaded to:', inputPath);
    } catch (downloadError) {
      console.error('Download failed for trim task:', taskId, downloadError);
      throw new Error(`Download failed: ${downloadError.message}`);
    }

    await Task.updateOne({ taskId }, { status: 'processing' });
    console.log('Trim task status updated to processing for task:', taskId);

    const spaceData = JSON.parse(JSON.stringify(await getSpaceData(taskData.site.spaceId)));
    taskData.space = spaceData;

    // ตั้งค่า S3
    const s3Client = new S3({
      endpoint: `${taskData.space.s3EndpointDefault}`,
      region: `${taskData.space.s3Region}`,
      ResponseContentEncoding: "utf-8",
      credentials: {
        accessKeyId: taskData.space.s3Key,
        secretAccessKey: taskData.space.s3Secret
      },
      forcePathStyle: false
    });

    // สร้าง FFmpeg command สำหรับ trimming
    console.log('Starting FFmpeg trim process for task:', taskId);
    console.log('Segments to process:', trimData.segments.length);
    
    let ffmpegCommand = ffmpeg(inputPath);

    // กำหนด video size ตาม quality
    let videoSize;
    switch (trimData.quality) {
      case '240p': videoSize = '426x240'; break;
      case '420p': videoSize = '640x360'; break;
      case '720p': videoSize = '1280x720'; break;
      case '1080p': videoSize = '1920x1080'; break;
      case '1920p': videoSize = '1920x1080'; break;
      default: videoSize = '1280x720';
    }

    // สร้าง filter complex สำหรับ trim และ overlays
    let filterComplex = [];
    let inputs = ['0:v', '0:a'];

    // ถ้ามี segments หลายส่วน ให้ทำการ trim แต่ละส่วนก่อน
    if (trimData.trim_mode === 'multi' && trimData.segments.length > 1) {
      // สร้าง trim filters สำหรับแต่ละ segment
      trimData.segments.forEach((segment, index) => {
        filterComplex.push(
          `[0:v]trim=start=${segment.start}:end=${segment.end}:duration=${segment.duration},setpts=PTS-STARTPTS[v${index}]`,
          `[0:a]atrim=start=${segment.start}:end=${segment.end}:duration=${segment.duration},asetpts=PTS-STARTPTS[a${index}]`
        );
      });

      // รวม segments ทั้งหมด
      const videoInputs = trimData.segments.map((_, i) => `[v${i}]`).join('');
      const audioInputs = trimData.segments.map((_, i) => `[a${i}]`).join('');
      
      filterComplex.push(
        `${videoInputs}concat=n=${trimData.segments.length}:v=1:a=0[trimmed_video]`,
        `${audioInputs}concat=n=${trimData.segments.length}:v=0:a=1[trimmed_audio]`
      );

      inputs = ['[trimmed_video]', '[trimmed_audio]'];
    } else if (trimData.segments.length === 1) {
      // Single segment trim
      const segment = trimData.segments[0];
      filterComplex.push(
        `[0:v]trim=start=${segment.start}:end=${segment.end}:duration=${segment.duration},setpts=PTS-STARTPTS[trimmed_video]`,
        `[0:a]atrim=start=${segment.start}:end=${segment.end}:duration=${segment.duration},asetpts=PTS-STARTPTS[trimmed_audio]`
      );
      inputs = ['[trimmed_video]', '[trimmed_audio]'];
    }

    // เพิ่ม overlays ถ้ามี
    let finalVideoInput = inputs[0];
    let additionalInputs = [];
    
    if (trimData.overlays && trimData.overlays.length > 0) {
      // Download image overlays ก่อน
      for (let i = 0; i < trimData.overlays.length; i++) {
        const overlay = trimData.overlays[i];
        if (overlay.type === 'image' && overlay.content) {
          const imageInputPath = path.join('uploads', `${taskId}-overlay-${i}.png`);
          try {
            console.log(`Downloading overlay image ${i}:`, overlay.content);
            await downloadWithTimeout(overlay.content, imageInputPath, 30000); // 30 second timeout for images
            additionalInputs.push(imageInputPath);
            ffmpegCommand = ffmpegCommand.input(imageInputPath);
          } catch (imageError) {
            console.warn(`Failed to download overlay image ${i}:`, imageError.message);
            // Continue without this overlay
          }
        }
      }

      // เพิ่ม overlay filters
      let overlayInputIndex = 1; // เริ่มจาก input index 1 (0 คือ video หลัก)
      trimData.overlays.forEach((overlay, index) => {
        if (overlay.type === 'image' && additionalInputs[overlayInputIndex - 1]) {
          // สำหรับ image overlay
          const x = overlay.position?.x || 0;
          const y = overlay.position?.y || 0;
          const width = overlay.position?.width ? `:w=${overlay.position.width}` : '';
          const height = overlay.position?.height ? `:h=${overlay.position.height}` : '';
          const opacity = overlay.style?.opacity || 1;
          
          filterComplex.push(
            `[${overlayInputIndex}:v]scale=${width}${height}[overlay_img${index}]`,
            `${finalVideoInput}[overlay_img${index}]overlay=${x}:${y}:enable='between(t,${overlay.start_time},${overlay.end_time})':alpha=${opacity}[overlay${index}]`
          );
          finalVideoInput = `[overlay${index}]`;
          overlayInputIndex++;
        } else if (overlay.type === 'text') {
          // สำหรับ text overlay
          const fontsize = overlay.style?.font_size || 24;
          const fontcolor = overlay.style?.color || 'white';
          const x = overlay.position?.x || 10;
          const y = overlay.position?.y || 10;
          const text = overlay.content.replace(/'/g, "\\\\'"); // Escape single quotes
          
          let drawTextFilter = `drawtext=text='${text}':fontsize=${fontsize}:fontcolor=${fontcolor}:x=${x}:y=${y}`;
          
          // เพิ่ม text styling options
          if (overlay.style?.font_family) {
            drawTextFilter += `:fontfile=${overlay.style.font_family}`;
          }
          if (overlay.style?.text_shadow) {
            drawTextFilter += `:shadowcolor=black:shadowx=2:shadowy=2`;
          }
          if (overlay.style?.opacity && overlay.style.opacity !== 1) {
            drawTextFilter += `:alpha=${overlay.style.opacity}`;
          }
          
          drawTextFilter += `:enable='between(t,${overlay.start_time},${overlay.end_time})'`;
          
          filterComplex.push(
            `${finalVideoInput}${drawTextFilter}[text${index}]`
          );
          finalVideoInput = `[text${index}]`;
        }
      });
    }

    // Scale video ถ้าจำเป็น
    if (videoSize !== `${trimData.video_metadata.width}x${trimData.video_metadata.height}`) {
      filterComplex.push(`${finalVideoInput}scale=${videoSize}[scaled]`);
      finalVideoInput = '[scaled]';
    }

    // Map final outputs
    let mapOptions = [];
    if (finalVideoInput.startsWith('[') && finalVideoInput.endsWith(']')) {
      mapOptions.push('-map', finalVideoInput);
    } else {
      mapOptions.push('-map', '0:v');
    }
    mapOptions.push('-map', inputs[1] || '0:a');

    // ตั้งค่า filter complex
    if (filterComplex.length > 0) {
      ffmpegCommand = ffmpegCommand.complexFilter(filterComplex);
    }

    // เพิ่ม options
    ffmpegCommand = ffmpegCommand
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset', 'fast',
        '-crf', '23',
        '-threads', '2',
        '-movflags', '+faststart',
        '-maxrate', '3M',
        '-bufsize', '6M',
        ...mapOptions
      ]);

    // ถ้ามี audio volume adjustment
    if (trimData.audio_volume && trimData.audio_volume !== 1) {
      ffmpegCommand = ffmpegCommand.audioFilters(`volume=${trimData.audio_volume}`);
    }

    // Event handlers
    ffmpegCommand
      .on('start', (commandLine) => {
        console.log('Spawned FFmpeg trim with command: ' + commandLine);
      })
      .on('progress', async (progress) => {
        const percent = Math.round(progress.percent) || 0;
        console.log(`Trim processing progress for task ${taskId}: ${percent}%`);
        await Task.updateOne({ taskId }, { status: 'processing', percent });

        if (taskData.storage) {
          await Storage.findOneAndUpdate(
            { _id: new mongoose.Types.ObjectId(taskData.storage) },
            { $set: { [`transcode.trim_${taskData.quality}`]: percent } },
            { new: true }
          ).exec();
        }
      })
      .on('end', async () => {
        try {
          console.log('FFmpeg trim process completed for task:', taskId);
          delete ffmpegProcesses[taskId];
          
          // คำนวณขนาดไฟล์หลังแปลง
          const outputFileSize = fs.statSync(outputPath).size;
          console.log(`Trim output file size: ${(outputFileSize / 1024 / 1024).toFixed(2)} MB`);
          
          await Task.updateOne({ 
            taskId 
          }, { 
            status: 'completed', 
            outputFile: `/${outputFileName}`,
            outputFileSize: outputFileSize
          });
          
          // อัปโหลดไปยัง S3
          const fileContent = fs.readFileSync(outputPath);
          const params = {
            Bucket: `${taskData.space.s3Bucket}`,
            Key: `outputs/${outputFileName}`,
            Body: fileContent,
            ACL: 'public-read'
          };

          const uploadResult = await s3Client.putObject(params);
          const remoteUrl = `${taskData.space.s3Endpoint}outputs/${outputFileName}`;

          if (taskData.storage) {
            await Storage.findOneAndUpdate(
              { _id: new mongoose.Types.ObjectId(taskData.storage) },
              { $set: { [`transcode.trim_${taskData.quality}`]: remoteUrl } },
              { new: true }
            ).exec();
          }

          console.log("Trim storage updated with remote URL:", remoteUrl);
          
          // ทำความสะอาดไฟล์ชั่วคราว (รวมถึง overlay images)
          await cleanupTempFiles(inputPath, outputPath);
          
          // ทำความสะอาด overlay image files
          for (let i = 0; i < additionalInputs.length; i++) {
            if (additionalInputs[i] && fs.existsSync(additionalInputs[i])) {
              try {
                fs.unlinkSync(additionalInputs[i]);
                console.log('Cleaned up overlay image:', additionalInputs[i]);
              } catch (cleanupError) {
                console.error('Error cleaning up overlay image:', cleanupError);
              }
            }
          }
          
        } catch (uploadError) {
          console.error('Error in trim post-processing for task:', taskId, uploadError);
          await Task.updateOne({ taskId }, { status: 'error', error: uploadError.message });
        } finally {
          concurrentJobs--;
          console.log(`Trim task ${taskId} finished. Active jobs: ${concurrentJobs}/${MAX_CONCURRENT_JOBS}`);
          processNextQueue();
        }
      })
      .on('error', async (err) => {
        try {
          console.error('FFmpeg trim process error for task:', taskId, err);
          delete ffmpegProcesses[taskId];
          await Task.updateOne({ taskId }, { status: 'error', error: err.message });
          
          if (taskData.storage) {
            await Storage.findOneAndUpdate(
              { _id: new mongoose.Types.ObjectId(taskData.storage) },
              { $set: { [`transcode.trim_${taskData.quality}`]: 'error' } },
              { new: true }
            ).exec();
          }
          
          await cleanupTempFiles(inputPath, outputPath);
          
          // ทำความสะอาด overlay image files
          for (let i = 0; i < (additionalInputs?.length || 0); i++) {
            if (additionalInputs[i] && fs.existsSync(additionalInputs[i])) {
              try {
                fs.unlinkSync(additionalInputs[i]);
                console.log('Cleaned up overlay image on error:', additionalInputs[i]);
              } catch (cleanupError) {
                console.error('Error cleaning up overlay image on error:', cleanupError);
              }
            }
          }
          
        } catch (cleanupError) {
          console.error('Error during trim cleanup for task:', taskId, cleanupError);
        } finally {
          concurrentJobs--;
          console.log(`Trim task ${taskId} failed. Active jobs: ${concurrentJobs}/${MAX_CONCURRENT_JOBS}`);
          processNextQueue();
        }
      });

    // เก็บ reference ของ process และเพิ่ม timeout
    ffmpegProcesses[taskId] = ffmpegCommand;
    
    // ตั้ง timeout สำหรับ ffmpeg process
    const timeoutId = setTimeout(async () => {
      if (ffmpegProcesses[taskId]) {
        console.log(`FFmpeg trim timeout for task: ${taskId}`);
        ffmpegProcesses[taskId].kill('SIGTERM');
        delete ffmpegProcesses[taskId];
        await Task.updateOne({ taskId }, { status: 'error', error: 'Processing timeout' });
        await cleanupTempFiles(inputPath, outputPath);
        concurrentJobs--;
        processNextQueue();
      }
    }, FFMPEG_TIMEOUT);

    // เริ่มการประมวลผล
    ffmpegCommand.save(outputPath);

  } catch (error) {
    console.error('Error in processTrimQueue for task:', taskId, error);
    await Task.updateOne({ taskId }, { status: 'error', error: error.message });
    
    if (taskData.storage) {
      await Storage.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(taskData.storage) },
        { $set: { [`transcode.trim_${taskData.quality}`]: 'error' } },
        { new: true }
      ).exec();
    }
    
    await cleanupTempFiles(inputPath, outputPath);
    concurrentJobs--;
    console.log(`Trim task ${taskId} error. Active jobs: ${concurrentJobs}/${MAX_CONCURRENT_JOBS}`);
    processNextQueue();
  }
}

// 404 handler - ต้องอยู่ท้ายสุดเสมอ
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

