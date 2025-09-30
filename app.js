const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const { createClient } = require('redis');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const fs = require('fs'); 
const mongoose = require('mongoose');
const { S3 } = require('@aws-sdk/client-s3');
const osu = require('node-os-utils');
const FormData = require('form-data');
const cpu = osu.cpu;
const mem = osu.mem;
const drive = osu.drive;

// Load environment variables
require('dotenv').config();

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process, just log the error
});

const { getHostnameData, getSpaceData } = require('./middleware/hostname'); // Import the function

// Helper function to get file extension from URL
function getFileExtensionFromURL(url) {
  try {
    // Remove query parameters and get the pathname
    const pathname = new URL(url).pathname;
    const extension = path.extname(pathname).toLowerCase();
    
    // Return extension without the dot, default to mp4 if no extension
    return extension ? extension.slice(1) : 'mp4';
  } catch (error) {
    console.log('Error parsing URL for extension:', url, error.message);
    return 'mp4'; // Default fallback
  }
}

// Helper function to generate input file path with correct extension
function generateInputPath(taskId, url, prefix = 'input') {
  const extension = getFileExtensionFromURL(url);
  return path.join('uploads', `${taskId}-${prefix}.${extension}`);
}

// Helper function to convert FFmpeg timemark to seconds
function convertTimemarkToSeconds(timemark) {
  if (!timemark || typeof timemark !== 'string') {
    console.warn('Invalid timemark:', timemark);
    return 0;
  }
  
  // Format: HH:MM:SS.ss
  const parts = timemark.split(':');
  if (parts.length !== 3) {
    console.warn('Invalid timemark format:', timemark);
    return 0;
  }
  
  try {
    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    
    // ตรวจสอบผลลัพธ์
    if (isNaN(totalSeconds) || totalSeconds < 0) {
      console.warn('Invalid calculated seconds from timemark:', timemark, '→', totalSeconds);
      return 0;
    }
    
    return totalSeconds;
  } catch (error) {
    console.warn('Error parsing timemark:', timemark, error);
    return 0;
  }
}

// Cloudflare Stream Configuration
const CLOUDFLARE_API_TOKEN = 'xTBA4Ynm-AGnY5UtGPMMQtLvmEpvFmgK1XHaQmMl';
const CLOUDFLARE_ACCOUNT_ID = '92d5cc09d52b3239a9bfccf8dbd1bddb'; // Cloudflare Account ID
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

const app = express();
const port = process.env.PORT || 3000;

// Logging middleware for media recording endpoints
app.use('/api/media', (req, res, next) => {
  const origin = req.headers.origin;
  
  // Log request for debugging
  console.log(`🌐 Media API request: ${req.method} ${req.url} from origin: ${origin || 'none'}`);
  
  next();
});

// Increased limits for video chunk uploads (100MB for large video chunks)
app.use(express.json({ limit: '100mb' })); 
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static('public'));
app.use(express.static('outputs'));

// Media recording routes จะถูกโหลดหลังจาก Storage model ถูกสร้างแล้ว

// CORS test endpoint
app.get('/api/cors-test', (req, res) => {
  res.json({
    success: true,
    message: 'CORS test successful',
    origin: req.headers.origin || 'none',
    timestamp: new Date().toISOString(),
    headers: {
      'access-control-allow-origin': res.get('Access-Control-Allow-Origin'),
      'access-control-allow-credentials': res.get('Access-Control-Allow-Credentials')
    }
  });
});

// Media recording CORS test endpoint
app.options('/api/media/*', (req, res) => {
  console.log('🧪 CORS preflight test for:', req.originalUrl, 'from:', req.headers.origin);
  res.status(200).end();
});

app.get('/api/media/cors-test', (req, res) => {
  res.json({
    success: true,
    message: 'Media recording CORS test successful',
    origin: req.headers.origin || 'none',
    timestamp: new Date().toISOString(),
    endpoint: '/api/media/cors-test'
  });
});

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
  type: { type: String, default: 'convert' }, // Type of task: 'convert', 'trim', or 'stream'
  status: String,
  quality: String,
  createdAt: Date,
  inputPath: String,
  outputFile: String,
  percent: Number,
  url: String,
  site: Object,
  space: Object,
  storage: String,
  // Cloudflare Stream specific fields
  cloudflareStreamId: String,
  cloudflarePlaybackUrl: String,
  cloudflareStreamStatus: String,
  cloudflareStreamMeta: Object
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
  thumbnail: { type: String, default: '' }, // Base64 thumbnail data
  thumbnailUrl: { type: String, default: '' }, // URL ของ thumbnail ใน S3
  transcode: { type: Object, default: {} } // เพิ่มฟิลด์ transcode
});

// สร้างโมเดล Storage (ตรวจสอบก่อนสร้างเพื่อป้องกัน duplication)
let Storage;
if (mongoose.models.storage) {
  Storage = mongoose.models.storage;
  console.log('📦 Using existing Storage model (already created by routes)');
} else {
  Storage = mongoose.model('storage', storageSchema, 'storage');
  console.log('📦 Created new Storage model in app.js');
}

// ตอนนี้ Storage model ถูกสร้างแล้ว จึงสามารถโหลด media recording routes ได้
const mediaRecordingRoutes = require('./routes/mediaRecording');
const { requestLogger, performanceMonitor } = require('./middleware/mediaRecording');

// Apply media recording middleware and routes
console.log('📡 Registering media recording routes at /api/media');
app.use('/api/media', requestLogger);
app.use('/api/media', performanceMonitor);
app.use('/api/media', mediaRecordingRoutes);
console.log('✅ Media recording routes registered successfully');

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

// Endpoint: Upload video to Cloudflare Stream
app.post('/stream', async (req, res) => {
  console.log('Received Cloudflare Stream upload request');
  const { url, meta = {}, site } = req.body;
  let taskId;

  // Validate required fields
  if (!url) {
    console.log('Video URL is required');
    return res.status(400).json({ success: false, error: 'Video URL is required' });
  }

  if (!site) {
    console.log('Site is required');
    return res.status(400).json({ success: false, error: 'Site is required' });
  }

  // Validate Cloudflare Stream configuration
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.log('Cloudflare Stream configuration missing');
    return res.status(500).json({ 
      success: false, 
      error: 'Cloudflare Stream not configured. Please set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables.' 
    });
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
    // Check for existing task with same URL
    const existingTask = await Task.findOne({ url: url, type: 'stream' });
    if (existingTask) {
      console.log('Existing Cloudflare Stream task found:', existingTask.taskId);
      return res.json({ success: true, taskId: existingTask.taskId });
    }

    taskId = uuidv4();

    // Construct task data for Cloudflare Stream
    const taskData = {
      taskId,
      type: 'stream', // New type for Cloudflare Stream uploads
      status: 'queued',
      createdAt: Date.now(),
      url: url,
      streamMeta: meta, // Store Cloudflare Stream metadata
      site: hostnameData,
      space: spaceData,
      storage: req.body.storage,
      retryCount: 0
    };

    console.log('Cloudflare Stream task data created:', taskData);
    await Task.create(taskData);

    // อัปเดตข้อมูลในคอลเลกชัน storage
    if (taskData.storage) {
      await safeUpdateTranscode(taskData.storage, 'stream', 'queue...', false);
    }

    console.log('Process Cloudflare Stream queue started for task:', taskId);
    // เริ่มประมวลผลทันทีหากมีช่องว่าง
    if (concurrentJobs < MAX_CONCURRENT_JOBS) {
      processCloudflareStreamQueue(taskId, taskData);
    }

    res.json({ 
      success: true, 
      taskId, 
      message: 'Video queued for Cloudflare Stream upload',
      site: hostnameData,
      space: spaceData,
      queuePosition: queuedCount + 1
    });

  } catch (error) {
    console.error('Error in Cloudflare Stream endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

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
      type: 'convert', // Add type to distinguish from trim tasks
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
    await safeUpdateTranscode(taskData.storage, taskData.quality, 'queue...');

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

// Endpoint: Get Cloudflare Stream video details
app.get('/stream/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  
  try {
    const task = await Task.findOne({ taskId, type: 'stream' });
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Cloudflare Stream task not found' });
    }
    
    // If task is completed and has stream data, optionally fetch latest from Cloudflare
    if (task.status === 'completed' && task.streamData?.uid) {
      try {
        const cloudflareHeaders = {
          'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json'
        };
        
        const statusResponse = await axios.get(
          `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/${task.streamData.uid}`,
          { headers: cloudflareHeaders, timeout: 10000 }
        );
        
        if (statusResponse.data.success) {
          const latestStreamData = statusResponse.data.result;
          
          // Update task with latest data
          await Task.updateOne({ taskId }, { 
            streamData: {
              ...task.streamData,
              ...latestStreamData
            }
          });
          
          return res.json({
            success: true,
            task: {
              ...task.toObject(),
              streamData: latestStreamData
            }
          });
        }
      } catch (cloudflareError) {
        console.warn('Failed to fetch latest Cloudflare Stream data:', cloudflareError.message);
        // Continue with existing data
      }
    }
    
    res.json({
      success: true,
      task: task
    });
    
  } catch (error) {
    console.error('Error fetching Cloudflare Stream task:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch stream task',
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

// Endpoint: Stop ffmpeg process (Force stop)
app.post('/stop/:taskId', async (req, res) => {
  const taskId = req.params.taskId;

  try {
    // ตรวจสอบว่า task มีอยู่ใน database หรือไม่
    const task = await Task.findOne({ taskId });
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found in database.' });
    }

    let processKilled = false;
    let statusUpdated = false;

    // บังคับหยุด ffmpeg process ถ้ากำลังทำงานอยู่
    if (ffmpegProcesses[taskId]) {
      try {
        ffmpegProcesses[taskId].kill('SIGKILL'); // ใช้ SIGKILL แทน SIGINT เพื่อบังคับหยุด
        delete ffmpegProcesses[taskId]; // ลบกระบวนการจากรายการ
        concurrentJobs = Math.max(0, concurrentJobs - 1); // ลดตัวนับงาน (ป้องกันติดลบ)
        processKilled = true;
        console.log(`Force killed ffmpeg process for task: ${taskId}`);
      } catch (killError) {
        console.error(`Error killing process for task ${taskId}:`, killError);
      }
    }

    // บังคับอัปเดตสถานะใน database เป็น 'stopped' เสมอ
    try {
      await Task.updateOne({ taskId }, { 
        status: 'stopped',
        stoppedAt: new Date(),
        percent: task.percent || 0 // เก็บ progress ล่าสุดไว้
      });
      statusUpdated = true;
      console.log(`Updated task ${taskId} status to stopped in database`);
    } catch (dbError) {
      console.error(`Error updating task ${taskId} in database:`, dbError);
    }

    // ลองประมวลผลงานถัดไปใน queue
    processNextQueue();

    // Response based on what was accomplished
    if (processKilled && statusUpdated) {
      return res.json({ 
        success: true, 
        message: `Task ${taskId} force stopped successfully. Process killed and database updated.`,
        actions: ['process_killed', 'database_updated']
      });
    } else if (statusUpdated) {
      return res.json({ 
        success: true, 
        message: `Task ${taskId} marked as stopped in database. ${processKilled ? 'Process was not running.' : 'No active process found.'}`,
        actions: ['database_updated']
      });
    } else if (processKilled) {
      return res.json({ 
        success: true, 
        message: `Task ${taskId} process killed but database update failed.`,
        actions: ['process_killed'],
        warning: 'Database status not updated'
      });
    } else {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to stop task completely.',
        details: 'Neither process kill nor database update succeeded'
      });
    }

  } catch (error) {
    console.error('Error in stop endpoint:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error while stopping task.',
      details: error.message 
    });
  }
});

// Endpoint: Delete completed task
app.delete('/task/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  
  try {
    const task = await Task.findOne({ taskId });
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    // Only allow deletion of completed, error, or stopped tasks
    if (!['completed', 'error', 'stopped'].includes(task.status)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Can only delete completed, error, or stopped tasks' 
      });
    }
    
    // Clean up output file if exists
    if (task.outputFile) {
      const outputPath = path.join(__dirname, 'outputs', task.outputFile.replace('/', ''));
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
          console.log('Deleted output file:', outputPath);
        }
      } catch (fileError) {
        console.error('Error deleting output file:', fileError);
      }
    }
    
    // Clean up input file if exists
    if (task.inputPath) {
      try {
        if (fs.existsSync(task.inputPath)) {
          fs.unlinkSync(task.inputPath);
          console.log('Deleted input file:', task.inputPath);
        }
      } catch (fileError) {
        console.error('Error deleting input file:', fileError);
      }
    }
    
    // Delete task from database
    await Task.deleteOne({ taskId });
    
    console.log(`Task ${taskId} deleted successfully`);
    res.json({ 
      success: true, 
      message: `Task ${taskId} deleted successfully` 
    });
    
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete task',
      details: error.message 
    });
  }
});

// Endpoint: Delete completed task (alternative path for compatibility)
app.delete('/delete/task/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  
  try {
    const task = await Task.findOne({ taskId });
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    // Only allow deletion of completed, error, or stopped tasks
    if (!['completed', 'error', 'stopped'].includes(task.status)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Can only delete completed, error, or stopped tasks' 
      });
    }
    
    // Clean up output file if exists
    if (task.outputFile) {
      const outputPath = path.join(__dirname, 'outputs', task.outputFile.replace('/', ''));
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
          console.log('Deleted output file:', outputPath);
        }
      } catch (fileError) {
        console.error('Error deleting output file:', fileError);
      }
    }
    
    // Clean up input file if exists
    if (task.inputPath) {
      try {
        if (fs.existsSync(task.inputPath)) {
          fs.unlinkSync(task.inputPath);
          console.log('Deleted input file:', task.inputPath);
        }
      } catch (fileError) {
        console.error('Error deleting input file:', fileError);
      }
    }
    
    // Delete task from database
    await Task.deleteOne({ taskId });
    
    console.log(`Task ${taskId} deleted successfully`);
    res.json({ 
      success: true, 
      message: `Task ${taskId} deleted successfully` 
    });
    
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete task',
      details: error.message 
    });
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

// Endpoint: Force stop all jobs and reset system
app.post('/force-reset', async (req, res) => {
  try {
    // หยุด ffmpeg processes ทั้งหมด
    const processIds = Object.keys(ffmpegProcesses);
    for (const taskId of processIds) {
      try {
        ffmpegProcesses[taskId].kill('SIGKILL'); // บังคับหยุด
        delete ffmpegProcesses[taskId];
        console.log(`Force killed process for task: ${taskId}`);
      } catch (error) {
        console.error(`Error killing process ${taskId}:`, error.message);
      }
    }
    
    // Reset concurrent jobs counter
    concurrentJobs = 0;
    
    // อัปเดต tasks ที่ค้างใน processing กลับเป็น queued
    const processingTasks = await Task.updateMany(
      { status: 'processing' },
      { $set: { status: 'queued' } }
    );
    
    console.log(`Force reset completed. Reset ${processingTasks.modifiedCount} processing tasks to queued.`);
    
    // เริ่ม process queue ใหม่
    setTimeout(processNextQueue, 2000);
    
    res.json({ 
      success: true, 
      message: `System reset successfully. Killed ${processIds.length} processes and reset ${processingTasks.modifiedCount} tasks.`,
      resetProcesses: processIds.length,
      resetTasks: processingTasks.modifiedCount
    });
  } catch (error) {
    console.error('Error in force reset:', error);
    res.status(500).json({ success: false, error: 'Internal server error during reset.' });
  }
});

// Endpoint: Get system status for debugging
app.get('/system-status', async (req, res) => {
  try {
    const queuedTasks = await Task.countDocuments({ status: 'queued' });
    const processingTasks = await Task.countDocuments({ status: 'processing' });
    const completedTasks = await Task.countDocuments({ status: 'completed' });
    const errorTasks = await Task.countDocuments({ status: 'error' });
    const stoppedTasks = await Task.countDocuments({ status: 'stopped' });
    
    const systemLoad = await checkSystemLoad();
    const runningProcesses = Object.keys(ffmpegProcesses);
    
    res.json({
      success: true,
      status: {
        concurrentJobs,
        maxConcurrentJobs: MAX_CONCURRENT_JOBS,
        canProcessMore: concurrentJobs < MAX_CONCURRENT_JOBS,
        systemLoad,
        runningProcesses,
        taskCounts: {
          queued: queuedTasks,
          processing: processingTasks,
          completed: completedTasks,
          error: errorTasks,
          stopped: stoppedTasks
        }
      }
    });
  } catch (error) {
    console.error('Error getting system status:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
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

// Helper function สำหรับ update transcode field อย่างปลอดภัย
async function safeUpdateTranscode(storageId, quality, value, isTrimmingTask = false) {
  if (!storageId) return;
  
  try {
    const key = isTrimmingTask ? `trim_${quality}` : quality;
    
    // ตรวจสอบว่า storage document มี transcode field หรือไม่
    const storageDoc = await Storage.findById(new mongoose.Types.ObjectId(storageId));
    if (!storageDoc) {
      console.error(`Storage document not found: ${storageId}`);
      return;
    }
    
    if (storageDoc.transcode === null || storageDoc.transcode === undefined) {
      // สร้าง transcode field ใหม่
      await Storage.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(storageId) },
        { $set: { transcode: { [key]: value } } },
        { new: true }
      ).exec();
      console.log(`Created transcode field for storage ${storageId} with ${key}: ${value}`);
    } else {
      // update field ปกติ
      await Storage.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(storageId) },
        { $set: { [`transcode.${key}`]: value } },
        { new: true }
      ).exec();
    }
  } catch (error) {
    console.error(`Error updating transcode for storage ${storageId}:`, error);
    // Fallback: ลองสร้าง transcode object ใหม่
    try {
      const key = isTrimmingTask ? `trim_${quality}` : quality;
      await Storage.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(storageId) },
        { $set: { transcode: { [key]: value } } },
        { new: true }
      ).exec();
      console.log(`Fallback: Created new transcode object for storage ${storageId}`);
    } catch (fallbackError) {
      console.error(`Fallback also failed for storage ${storageId}:`, fallbackError);
    }
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

    inputPath = taskData.inputPath || generateInputPath(taskId, taskData.url);

    // If URL provided, download the video
    if (taskData.url) {
      console.log('Downloading video from URL:', taskData.url);
      await Task.updateOne({ taskId }, { status: 'downloading' });
      
      await safeUpdateTranscode(taskData.storage, taskData.quality, 'downloading...');

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
    console.log('Input file:', inputPath);
    console.log('Output file:', outputPath);
    
    // ตรวจสอบข้อมูลไฟล์ input
    let videoDuration = null;
    try {
      const inputStats = fs.statSync(inputPath);
      console.log(`Input file size: ${(inputStats.size / 1024 / 1024).toFixed(2)} MB`);
      
      // ตรวจสอบ extension
      const inputExt = path.extname(inputPath).toLowerCase();
      console.log(`Input file extension: ${inputExt}`);
      if (inputExt === '.webm') {
        console.log('⚠️  WebM input detected - adding compatibility options');
        
        // ใช้ ffprobe เพื่อหาความยาวไฟล์ WebM
        try {
          const ffprobeResult = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(inputPath, (err, metadata) => {
              if (err) reject(err);
              else resolve(metadata);
            });
          });
          
          videoDuration = ffprobeResult.format?.duration;
          
          // ตรวจสอบและแปลงค่า duration ให้ถูกต้อง
          if (videoDuration) {
            videoDuration = parseFloat(videoDuration);
            if (isNaN(videoDuration) || videoDuration <= 0) {
              console.log('⚠️  Invalid duration from ffprobe, will use fallback estimation');
              videoDuration = null;
            } else {
              console.log(`📹 WebM video duration: ${videoDuration}s`);
            }
          } else {
            console.log('⚠️  Could not determine WebM duration from ffprobe');
            videoDuration = null;
          }
        } catch (ffprobeError) {
          console.warn('ffprobe failed for WebM file:', ffprobeError.message);
          videoDuration = null; // ตั้งค่าเป็น null เพื่อใช้ fallback
        }
      }
    } catch (statError) {
      console.error('Error reading input file stats:', statError);
    }
    
    const ffmpegProcess = ffmpeg(inputPath)
      .size(videoSize)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset', 'fast',        // เปลี่ยนจาก medium เป็น fast เพื่อความเร็ว
        '-crf', '23',             // ปรับจาก 24 เป็น 23 (คุณภาพดีขึ้นเล็กน้อย)
        '-threads', '2',          // ใช้ 2 threads ต่องาน (2 งาน = 4 threads รวม)
        '-movflags', '+faststart',// optimized for streaming
        '-maxrate', '3M',         // เพิ่ม bitrate จาก 2M เป็น 3M
        '-bufsize', '6M',         // เพิ่ม buffer จาก 4M เป็น 6M
        '-avoid_negative_ts', 'make_zero', // Fix timing issues with webm
        '-fflags', '+genpts'      // Generate presentation timestamps
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
        let percent = Math.round(progress.percent) || 0;
        
        // เพิ่มการ log สำหรับ webm debugging
        if (path.extname(inputPath).toLowerCase() === '.webm') {
          console.log(`WebM progress details: timemark=${progress.timemark}, frames=${progress.frames}, fps=${progress.currentFps}`);
          
          // ถ้า percent เป็น 0 แต่มี frames แสดงว่า FFmpeg ทำงานอยู่
          // ลองประมาณจาก timemark
          if (percent === 0 && progress.timemark) {
            const timemarkSeconds = convertTimemarkToSeconds(progress.timemark);
            if (timemarkSeconds > 0) {
              // ใช้ความยาวจริงจาก ffprobe หรือประมาณ 30 วินาที
              const estimatedDuration = (videoDuration && videoDuration > 0) ? videoDuration : 30;
              
              // ตรวจสอบให้แน่ใจว่าไม่เกิด NaN
              if (estimatedDuration > 0) {
                percent = Math.min(Math.round((timemarkSeconds / estimatedDuration) * 100), 95);
                console.log(`📊 WebM estimated progress: ${percent}% (${timemarkSeconds.toFixed(1)}s/${estimatedDuration}s)`);
              } else {
                // fallback ถ้ายังมีปัญหา
                percent = Math.min(Math.round(timemarkSeconds * 10), 95); // ประมาณ 10% per second
                console.log(`📊 WebM fallback progress: ${percent}% (${timemarkSeconds.toFixed(1)}s)`);
              }
            }
          }
        }
        
        // ตรวจสอบให้แน่ใจว่า percent ไม่เป็น NaN หรือ null
        if (isNaN(percent) || percent === null || percent === undefined) {
          console.warn(`Invalid percent value: ${percent}, using fallback 0`);
          percent = 0;
        }
        
        // ตรวจสอบให้อยู่ในช่วง 0-100
        percent = Math.max(0, Math.min(100, percent));
        
        console.log(`Processing progress for task ${taskId}: ${percent}%`);
        
        try {
          await Task.updateOne({ taskId }, { status: 'processing', percent });
          await safeUpdateTranscode(taskData.storage, taskData.quality, percent);
        } catch (updateError) {
          console.error(`Error updating progress for task ${taskId}:`, updateError);
          // Don't throw, just log the error to prevent crashing
        }
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

          await safeUpdateTranscode(taskData.storage, taskData.quality, remoteUrl);

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
    
    // ตั้ง timeout สำหรับ ffmpeg process (เพิ่มเวลาสำหรับ webm)
    const inputExt = path.extname(inputPath).toLowerCase();
    const timeoutDuration = inputExt === '.webm' ? FFMPEG_TIMEOUT * 1.5 : FFMPEG_TIMEOUT; // เพิ่มเวลา 50% สำหรับ webm
    
    console.log(`Setting FFmpeg timeout: ${timeoutDuration / 1000}s for ${inputExt} file`);
    
    const timeoutId = setTimeout(async () => {
      if (ffmpegProcesses[taskId]) {
        console.log(`FFmpeg timeout for task: ${taskId} (${inputExt} file)`);
        ffmpegProcesses[taskId].kill('SIGTERM');
        delete ffmpegProcesses[taskId];
        await Task.updateOne({ taskId }, { status: 'error', error: `Processing timeout for ${inputExt} file` });
        await safeUpdateTranscode(taskData.storage, taskData.quality, 'error');
        await cleanupTempFiles(inputPath, outputPath);
        concurrentJobs--;
        processNextQueue();
      }
    }, timeoutDuration);
    
    // เพิ่มการตรวจสอบ progress stuck สำหรับ webm
    if (inputExt === '.webm') {
      let lastProgressTime = Date.now();
      let lastPercent = 0;
      let progressStuckCount = 0;
      
      const progressCheckInterval = setInterval(async () => {
        if (!ffmpegProcesses[taskId]) {
          clearInterval(progressCheckInterval);
          return;
        }
        
        const currentTask = await Task.findOne({ taskId });
        if (!currentTask) {
          clearInterval(progressCheckInterval);
          return;
        }
        
        const currentPercent = currentTask.percent || 0;
        const currentTime = Date.now();
        
        // ถ้า progress ไม่เปลี่ยนแปลงมากกว่า 2 นาที
        if (currentPercent === lastPercent && (currentTime - lastProgressTime) > 120000) {
          progressStuckCount++;
          console.log(`⚠️  WebM progress stuck at ${currentPercent}% for ${progressStuckCount * 2} minutes`);
          
          // ถ้า stuck มากกว่า 3 ครั้ง (6 นาที) ให้ยกเลิก
          if (progressStuckCount >= 3) {
            console.log(`❌ Killing stuck WebM process for task: ${taskId}`);
            clearInterval(progressCheckInterval);
            clearTimeout(timeoutId);
            
            if (ffmpegProcesses[taskId]) {
              ffmpegProcesses[taskId].kill('SIGKILL');
              delete ffmpegProcesses[taskId];
              await Task.updateOne({ taskId }, { status: 'error', error: 'WebM processing stuck - terminated' });
              await safeUpdateTranscode(taskData.storage, taskData.quality, 'error');
              await cleanupTempFiles(inputPath, outputPath);
              concurrentJobs--;
              processNextQueue();
            }
          }
        } else if (currentPercent !== lastPercent) {
          // Progress เปลี่ยน - reset counter
          lastPercent = currentPercent;
          lastProgressTime = currentTime;
          progressStuckCount = 0;
        }
      }, 120000); // ตรวจสอบทุก 2 นาที
    }

    // เริ่มการประมวลผล
    ffmpegProcess.save(outputPath);

  } catch (error) {
    console.error('Error in processQueue for task:', taskId, error);
    await Task.updateOne({ taskId }, { status: 'error', error: error.message });
    
    await safeUpdateTranscode(taskData.storage, taskData.quality, 'error');
    
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
  console.log(`=== ProcessNextQueue called ===`);
  console.log(`Current state: concurrentJobs=${concurrentJobs}, MAX_CONCURRENT_JOBS=${MAX_CONCURRENT_JOBS}`);
  
  // ตรวจสอบว่าสามารถรับงานใหม่ได้หรือไม่
  if (concurrentJobs >= MAX_CONCURRENT_JOBS) {
    console.log(`❌ Cannot process next queue: ${concurrentJobs}/${MAX_CONCURRENT_JOBS} jobs active`);
    return;
  }

  // ตรวจสอบ system load
  const systemLoad = await checkSystemLoad();
  console.log(`System Load: CPU ${systemLoad.cpuUsage}%, Memory ${systemLoad.memoryUsage}%, Can Process: ${systemLoad.canProcess}`);
  
  if (!systemLoad.canProcess) {
    console.log(`❌ System overloaded (CPU: ${systemLoad.cpuUsage}%, Memory: ${systemLoad.memoryUsage}%). Delaying queue processing for 60 seconds.`);
    // รอ 1 นาทีแล้วลองใหม่
    setTimeout(processNextQueue, 60000);
    return;
  }

  try {
    console.log(`🔍 Looking for queued tasks...`);
    const queuedCount = await Task.countDocuments({ status: 'queued' });
    console.log(`Found ${queuedCount} queued tasks in database`);
    
    const nextTask = await Task.findOneAndUpdate(
      { status: 'queued' },
      { $set: { status: 'processing' } },
      { new: true, sort: { createdAt: 1 } } // เรียงตามเวลาสร้าง (FIFO)
    );
    
    if (nextTask) {
      console.log(`✅ Found next task: ${nextTask.taskId} (Type: ${nextTask.type || 'convert'}) (System: CPU ${systemLoad.cpuUsage}%, Memory ${systemLoad.memoryUsage}%)`);
      console.log(`Task details: Created at ${nextTask.createdAt}, Quality: ${nextTask.quality || 'N/A'}`);
      
      // เลือก processing function ตาม task type
      setTimeout(() => {
        if (nextTask.type === 'trim') {
          console.log(`🎬 Starting trim processing for task: ${nextTask.taskId}`);
          processTrimQueue(nextTask.taskId, nextTask);
        } else if (nextTask.type === 'stream') {
          console.log(`☁️ Starting Cloudflare Stream processing for task: ${nextTask.taskId}`);
          processCloudflareStreamQueue(nextTask.taskId, nextTask);
        } else {
          console.log(`🎬 Starting convert processing for task: ${nextTask.taskId}`);
          processQueue(nextTask.taskId, nextTask);
        }
      }, 2000);
    } else {
      console.log(`ℹ️  No queued tasks found to process`);
    }
  } catch (error) {
    console.error('❌ Error in processNextQueue:', error);
    // หากเกิดข้อผิดพลาด ลอง process อีกครั้งในอีก 30 วินาที
    setTimeout(processNextQueue, 30000);
  }
  
  console.log(`=== ProcessNextQueue completed ===`);
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

  // Validate required fields - support both 'url' and 'input_url'
  const inputUrl = trimData.url || trimData.input_url;
  if (!inputUrl) {
    return res.status(400).json({ success: false, error: 'url is required' });
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
    // Check for existing task - use the normalized inputUrl
    const existingTask = await Task.findOne({ 
      url: inputUrl, 
      type: 'trim',
      'trimData.segments': { $elemMatch: { $in: trimData.segments.map(s => s.id) } }
    });
    
    if (existingTask) {
      console.log('Existing trim task found:', existingTask.taskId);
      return res.json({ success: true, taskId: existingTask.taskId });
    }

    taskId = uuidv4();

    // Normalize the trim data to use consistent field names
    const normalizedTrimData = {
      ...trimData,
      input_url: inputUrl, // Ensure input_url is set for backward compatibility
      url: inputUrl,       // Keep the new url field
      // Convert new overlay format to old format for processing
      overlays: []
    };

    // Convert text_overlays to overlays format
    if (trimData.text_overlays && Array.isArray(trimData.text_overlays)) {
      trimData.text_overlays.forEach(textOverlay => {
        normalizedTrimData.overlays.push({
          type: 'text',
          content: textOverlay.text,
          position: {
            x: textOverlay.position?.x || 10,
            y: textOverlay.position?.y || 10
          },
          style: {
            font_size: textOverlay.font_size || 24,
            color: textOverlay.color || '#FFFFFF',
            opacity: textOverlay.style?.opacity || 1,
            bold: textOverlay.style?.bold || false,
            italic: textOverlay.style?.italic || false,
            text_shadow: textOverlay.style?.shadow || false,
            stroke_width: textOverlay.style?.stroke_width || 0,
            stroke_color: textOverlay.style?.stroke_color || '#000000'
          },
          start_time: textOverlay.timing?.start || 0,
          end_time: textOverlay.timing?.end || trimData.segments[0]?.duration || 0
        });
      });
    }

    // Convert image_overlays to overlays format
    if (trimData.image_overlays && Array.isArray(trimData.image_overlays)) {
      trimData.image_overlays.forEach(imageOverlay => {
        normalizedTrimData.overlays.push({
          type: 'image',
          content: imageOverlay.image_url,
          position: {
            x: imageOverlay.position?.x || 10,
            y: imageOverlay.position?.y || 10,
            width: imageOverlay.position?.width || 25,
            height: imageOverlay.position?.height || 25
          },
          style: {
            opacity: imageOverlay.style?.opacity || 1,
            rotation: imageOverlay.style?.rotation || 0,
            scale_x: imageOverlay.style?.scale_x || 1,
            scale_y: imageOverlay.style?.scale_y || 1
          },
          start_time: imageOverlay.timing?.start || 0,
          end_time: imageOverlay.timing?.end || trimData.segments[0]?.duration || 0
        });
      });
    }

    console.log(`Converted ${trimData.text_overlays?.length || 0} text overlays and ${trimData.image_overlays?.length || 0} image overlays`);

    // Construct task data with trim information
    const taskData = {
      taskId,
      type: 'trim', // Add type to distinguish from regular convert tasks
      status: 'queued',
      quality: trimData.quality || '720p',
      createdAt: Date.now(),
      outputFile: null,
      url: inputUrl,
      trimData: normalizedTrimData, // Store normalized trim data
      site: hostnameData,
      space: spaceData,
      storage: trimData.storage,
      retryCount: 0
    };

    console.log('Trim task data created:', { 
      taskId, 
      inputUrl: inputUrl, 
      segments: trimData.segments.length,
      textOverlays: trimData.text_overlays?.length || 0,
      imageOverlays: trimData.image_overlays?.length || 0,
      audioVolume: trimData.audio_volume || 1.0,
      copyStreams: trimData.copy_streams || false
    });
    await Task.create(taskData);

    // อัปเดตข้อมูลในคอลเลกชัน storage
    await safeUpdateTranscode(taskData.storage, taskData.quality, 'queue...', true);

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

// Endpoint: Upload video to Cloudflare Stream
app.post('/stream-upload', upload.none(), async (req, res) => {
  console.log('Received Cloudflare Stream upload request');
  console.log('Request body:', req.body);
  
  const { url, title, description, site, storage } = req.body;
  let taskId;

  // Validate required fields
  if (!url) {
    return res.status(400).json({ success: false, error: 'Video URL is required' });
  }

  if (!site) {
    return res.status(400).json({ success: false, error: 'Site is required' });
  }

  // Validate URL format
  try {
    new URL(url);
  } catch (urlError) {
    return res.status(400).json({ success: false, error: 'Invalid URL format' });
  }

  // Check if Account ID is configured
  if (!CLOUDFLARE_ACCOUNT_ID || CLOUDFLARE_ACCOUNT_ID === 'YOUR_ACCOUNT_ID') {
    return res.status(500).json({ 
      success: false, 
      error: 'Cloudflare Account ID not configured. Please contact administrator.' 
    });
  }

  console.log(`Processing request: URL=${url}, Site=${site}, Storage=${storage || 'none'}`);

  // ตรวจสอบคิวที่รอ
  const queuedCount = await Task.countDocuments({ status: 'queued' });
  const processingCount = await Task.countDocuments({ status: 'processing' });
  
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
    // Check for existing task with same URL and storage
    const existingTask = await Task.findOne({ 
      url: url, 
      type: 'stream',
      storage: storage || { $exists: false }
    });
    
    if (existingTask) {
      console.log('Existing Cloudflare Stream task found:', existingTask.taskId);
      return res.json({ 
        success: true, 
        taskId: existingTask.taskId,
        cloudflareStreamId: existingTask.cloudflareStreamId,
        playbackUrl: existingTask.cloudflarePlaybackUrl,
        status: existingTask.status,
        message: 'Task already exists'
      });
    }

    taskId = uuidv4();

    // Extract filename from URL for better naming
    let videoTitle = title;
    if (!videoTitle) {
      try {
        const urlPath = new URL(url).pathname;
        const filename = urlPath.split('/').pop();
        videoTitle = filename ? filename.replace(/\.[^/.]+$/, '') : `Video_${taskId.slice(0, 8)}`;
      } catch {
        videoTitle = `Video_${taskId.slice(0, 8)}`;
      }
    }

    // Construct task data for Cloudflare Stream
    const taskData = {
      taskId,
      type: 'stream', // New type for Cloudflare Stream
      status: 'queued',
      createdAt: Date.now(),
      url: url,
      site: hostnameData,
      space: spaceData,
      storage: storage || null, // Store storage ID if provided
      retryCount: 0,
      // Cloudflare Stream specific data
      cloudflareStreamMeta: {
        title: videoTitle,
        description: description || `Uploaded from ${site}`,
        originalUrl: url,
        uploadSource: 'ffmprg-system',
        storageReference: storage || null
      }
    };

    console.log('Cloudflare Stream task data created:', { 
      taskId, 
      inputUrl: url, 
      title: videoTitle,
      storage: storage || 'none',
      site: site
    });
    await Task.create(taskData);

    // อัปเดตข้อมูลในคอลเลกชัน storage ถ้ามี storage ID
    if (storage) {
      try {
        await safeUpdateTranscode(storage, 'stream', 'queued for Cloudflare Stream...', false);
        console.log(`Updated storage ${storage} with stream status`);
      } catch (storageError) {
        console.warn(`Failed to update storage ${storage}:`, storageError.message);
      }
    }

    console.log('Process Cloudflare Stream queue started for task:', taskId);
    // เริ่มประมวลผลทันทีหากมีช่องว่าง
    if (concurrentJobs < MAX_CONCURRENT_JOBS) {
      processCloudflareStreamQueue(taskId, taskData);
    }

    res.json({ 
      success: true, 
      taskId, 
      type: 'stream',
      url: url,
      title: videoTitle,
      site: hostnameData,
      space: spaceData,
      storage: storage || null,
      queuePosition: queuedCount + 1,
      estimatedWaitTime: `${Math.ceil(queuedCount * 2)} minutes`,
      message: 'Video upload to Cloudflare Stream has been queued',
      statusCheckUrl: `${baseUrl}/status/${taskId}`,
      dashboardUrl: `${baseUrl}`
    });

  } catch (error) {
    console.error('Error in stream-upload endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Webhook endpoint for Cloudflare Stream status updates
app.post('/webhook/cloudflare-stream', async (req, res) => {
  console.log('Received Cloudflare Stream webhook:', JSON.stringify(req.body, null, 2));
  
  try {
    const webhookData = req.body;
    
    // Validate webhook signature (optional but recommended)
    // const signature = req.headers['cf-webhook-signature'];
    // if (!validateWebhookSignature(req.body, signature)) {
    //   return res.status(401).json({ error: 'Invalid signature' });
    // }
    
    const { uid, status, meta } = webhookData;
    
    if (!uid) {
      return res.status(400).json({ error: 'Missing video UID' });
    }
    
    // Find task by cloudflareStreamId
    const task = await Task.findOne({ cloudflareStreamId: uid });
    
    if (!task) {
      console.log(`No task found for Cloudflare Stream UID: ${uid}`);
      return res.status(200).json({ message: 'Task not found, but webhook acknowledged' });
    }
    
    console.log(`Webhook update for task ${task.taskId}: status=${status?.state}, ready=${status?.readyToStream}`);
    
    // Update task based on webhook status
    if (status?.state === 'ready' && status?.readyToStream) {
      // Video is ready for streaming
      await Task.updateOne({ taskId: task.taskId }, {
        status: 'completed',
        percent: 100,
        cloudflareStreamStatus: 'ready',
        cloudflareStreamMeta: {
          ...task.cloudflareStreamMeta,
          webhookData: webhookData,
          completedAt: new Date().toISOString()
        }
      });
      
      // Update storage with final stream UID (not URL)
      if (task.storage) {
        await safeUpdateTranscode(task.storage, 'stream', uid, false);
      }
      
      console.log(`✅ Cloudflare Stream task ${task.taskId} completed via webhook`);
      
    } else if (status?.state === 'error') {
      // Video processing failed
      await Task.updateOne({ taskId: task.taskId }, {
        status: 'error',
        error: status?.errorReasonText || 'Cloudflare Stream processing failed',
        cloudflareStreamStatus: 'error',
        cloudflareStreamMeta: {
          ...task.cloudflareStreamMeta,
          webhookData: webhookData,
          errorAt: new Date().toISOString()
        }
      });
      
      // Update storage with error status
      if (task.storage) {
        await safeUpdateTranscode(task.storage, 'stream', 'error', false);
      }
      
      console.log(`❌ Cloudflare Stream task ${task.taskId} failed via webhook: ${status?.errorReasonText}`);
      
    } else if (status?.state === 'inprogress') {
      // Video is still processing - show percentage in storage
      const percent = Math.min(50 + Math.floor(Math.random() * 40), 95); // Estimate progress 50-95%
      await Task.updateOne({ taskId: task.taskId }, {
        status: 'processing',
        percent: percent,
        cloudflareStreamStatus: 'inprogress',
        cloudflareStreamMeta: {
          ...task.cloudflareStreamMeta,
          webhookData: webhookData,
          lastUpdate: new Date().toISOString()
        }
      });
      
      // Update storage with percentage instead of UID during processing
      if (task.storage) {
        await safeUpdateTranscode(task.storage, 'stream', `${percent}%`, false);
      }
      
      console.log(`⏳ Cloudflare Stream task ${task.taskId} still processing via webhook (${percent}%)`);
    }
    
    // Acknowledge webhook
    res.status(200).json({ 
      success: true, 
      message: 'Webhook processed successfully',
      taskId: task.taskId,
      uid: uid,
      status: status?.state
    });
    
  } catch (error) {
    console.error('Error processing Cloudflare Stream webhook:', error);
    res.status(500).json({ 
      error: 'Webhook processing failed',
      details: error.message 
    });
  }
});

// Endpoint: Get Cloudflare Stream video info
app.get('/stream-info/:streamId', async (req, res) => {
  const streamId = req.params.streamId;
  
  if (!CLOUDFLARE_ACCOUNT_ID || CLOUDFLARE_ACCOUNT_ID === 'YOUR_ACCOUNT_ID') {
    return res.status(500).json({ 
      success: false, 
      error: 'Cloudflare Account ID not configured' 
    });
  }
  
  try {
    const response = await axios.get(
      `${CLOUDFLARE_API_BASE}/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream/${streamId}`,
      {
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`
        }
      }
    );
    
    if (response.data.success) {
      res.json({
        success: true,
        stream: response.data.result
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Stream not found'
      });
    }
  } catch (error) {
    console.error('Error fetching stream info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stream information'
    });
  }
});

// Processing function for Cloudflare Stream tasks
async function processCloudflareStreamQueue(taskId, taskData) {
  // ตรวจสอบ system load ก่อนเริ่มงาน
  const systemLoad = await checkSystemLoad();
  if (!systemLoad.canProcess) {
    console.log(`System overloaded (CPU: ${systemLoad.cpuUsage}%, Memory: ${systemLoad.memoryUsage}%). Cloudflare Stream task ${taskId} delayed.`);
    setTimeout(() => processCloudflareStreamQueue(taskId, taskData), 30000);
    return;
  }

  // ตรวจสอบจำนวนงานที่กำลังทำพร้อมกัน
  if (concurrentJobs >= MAX_CONCURRENT_JOBS) {
    console.log(`Max concurrent jobs reached (${MAX_CONCURRENT_JOBS}). Cloudflare Stream task ${taskId} remains queued.`);
    return;
  }

  concurrentJobs++;
  console.log(`Processing Cloudflare Stream queue for task: ${taskId} (Active jobs: ${concurrentJobs}/${MAX_CONCURRENT_JOBS})`);

  const tempFilePath = generateInputPath(taskId, taskData.url, 'stream-input');

  try {
    // Update task status to downloading
    await Task.updateOne({ taskId }, { status: 'downloading', percent: 5 });
    
    // Update storage with initial downloading status
    if (taskData.storage) {
      await safeUpdateTranscode(taskData.storage, 'stream', '5%', false);
    }
    
    console.log(`Downloading video from URL for Cloudflare Stream: ${taskData.url}`);

    // Download video file
    try {
      await downloadWithTimeout(taskData.url, tempFilePath);
      console.log('Video downloaded successfully for Cloudflare Stream:', tempFilePath);
    } catch (downloadError) {
      console.error('Download failed for Cloudflare Stream task:', taskId, downloadError);
      throw new Error(`Download failed: ${downloadError.message}`);
    }

    // Update task status to uploading
    await Task.updateOne({ taskId }, { status: 'processing', percent: 20 });
    
    // Update storage with upload starting status
    if (taskData.storage) {
      await safeUpdateTranscode(taskData.storage, 'stream', '20%', false);
    }
    console.log(`Starting upload to Cloudflare Stream for task: ${taskId}`);

    // Create form data for Cloudflare Stream upload
    const formData = new FormData();
    formData.append('file', fs.createReadStream(tempFilePath));
    
    // Add metadata with webhook URL
    const webhookUrl = `${baseUrl}/webhook/cloudflare-stream`;
    const metadata = {
      name: taskData.cloudflareStreamMeta.title,
      meta: {
        description: taskData.cloudflareStreamMeta.description,
        source: taskData.cloudflareStreamMeta.originalUrl,
        uploadedBy: 'ffmprg-system',
        taskId: taskId
      },
      // Set webhook URL for status updates
      webhookUrl: webhookUrl
    };
    
    formData.append('meta', JSON.stringify(metadata));

    // Upload to Cloudflare Stream
    const uploadUrl = `${CLOUDFLARE_API_BASE}/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream`;
    
    console.log(`Uploading to Cloudflare Stream: ${uploadUrl}`);
    console.log(`Webhook URL configured: ${webhookUrl}`);
    
    const uploadResponse = await axios.post(uploadUrl, formData, {
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        ...formData.getHeaders()
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 30 * 60 * 1000, // 30 minutes timeout
      onUploadProgress: async (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round(20 + (progressEvent.loaded / progressEvent.total) * 70); // 20-90%
          await Task.updateOne({ taskId }, { percent });
          
          // Update storage with upload percentage
          if (taskData.storage) {
            await safeUpdateTranscode(taskData.storage, 'stream', `${percent}%`, false);
          }
          
          console.log(`Cloudflare Stream upload progress for task ${taskId}: ${percent}%`);
        }
      }
    });

    console.log('Cloudflare Stream upload response:', uploadResponse.data);

    if (uploadResponse.data.success) {
      const streamData = uploadResponse.data.result;
      const streamUID = streamData.uid;
      
      console.log(`Cloudflare Stream upload initiated: ${streamUID}`);
      
      // Update task with Cloudflare Stream UID immediately
      await Task.updateOne({ taskId }, { 
        status: 'processing', 
        percent: 60,
        cloudflareStreamUID: streamUID,
        cloudflareStreamStatus: streamData.status?.state || 'uploading',
        cloudflareStreamMeta: {
          ...taskData.cloudflareStreamMeta,
          cloudflareData: streamData,
          uploadedAt: new Date().toISOString()
        }
      });

      // Update storage with initial processing status instead of UID
      if (taskData.storage) {
        await safeUpdateTranscode(taskData.storage, 'stream', 'uploading...', false);
        console.log(`Updated storage ${taskData.storage} with initial status: uploading...`);
      }

      console.log(`Stream ID: ${streamUID}`);
      console.log(`Initial status: ${streamData.status?.state}`);

      // Start polling for video status using Retrieve Video Details API
      await pollVideoStatus(taskId, streamUID, taskData);

      // Clean up temp file
      await cleanupTempFiles(tempFilePath, null);

    } else {
      throw new Error(`Cloudflare Stream upload failed: ${uploadResponse.data.errors?.map(e => e.message).join(', ') || 'Unknown error'}`);
    }

  } catch (error) {
    console.error('Error in processCloudflareStreamQueue for task:', taskId, error);
    await Task.updateOne({ taskId }, { 
      status: 'error', 
      error: error.message,
      cloudflareStreamStatus: 'error',
      errorAt: Date.now()
    });
    
    // Update storage with error status if storage ID provided
    if (taskData.storage) {
      try {
        await safeUpdateTranscode(taskData.storage, 'stream', 'error', false);
        console.log(`Updated storage ${taskData.storage} with error status`);
      } catch (storageError) {
        console.error(`Failed to update storage ${taskData.storage} with error:`, storageError.message);
      }
    }
    
    // Clean up temp file
    await cleanupTempFiles(tempFilePath, null);
  } finally {
    concurrentJobs--;
    console.log(`Cloudflare Stream task ${taskId} finished. Active jobs: ${concurrentJobs}/${MAX_CONCURRENT_JOBS}`);
    processNextQueue();
  }
}

// Function to poll video status using Retrieve Video Details API
async function pollVideoStatus(taskId, streamUID, taskData) {
  const maxPollingAttempts = 60; // 60 attempts * 10 seconds = 10 minutes max
  let pollingAttempts = 0;
  let isReady = false;

  console.log(`Starting to poll video status for Stream UID: ${streamUID}`);

  while (pollingAttempts < maxPollingAttempts && !isReady) {
    pollingAttempts++;
    
    try {
      // Wait 10 seconds between polls
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Use Retrieve Video Details API
      const statusResponse = await axios.get(
        `${CLOUDFLARE_API_BASE}/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream/${streamUID}`,
        {
          headers: {
            'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`
          },
          timeout: 30000 // 30 second timeout
        }
      );

      if (statusResponse.data.success) {
        const videoData = statusResponse.data.result;
        const status = videoData.status?.state || 'unknown';
        const progress = Math.min(60 + (pollingAttempts * 2), 95); // Progress from 60% to 95%
        
        console.log(`Poll attempt ${pollingAttempts}/${maxPollingAttempts} for ${streamUID}: status=${status}, ready=${videoData.readyToStream}`);

        // Update task progress
        await Task.updateOne({ taskId }, { 
          percent: progress,
          cloudflareStreamStatus: status,
          cloudflareStreamMeta: {
            ...taskData.cloudflareStreamMeta,
            cloudflareData: videoData,
            lastPolled: new Date().toISOString(),
            pollingAttempts: pollingAttempts
          }
        });

        // Check if video is ready
        if (status === 'ready' && videoData.readyToStream) {
          isReady = true;
          
          const playbackUrl = `https://customer-${streamUID}.cloudflarestream.com/${streamUID}/manifest/video.m3u8`;
          const streamUrl = videoData.preview || `https://customer-${streamUID}.cloudflarestream.com/${streamUID}/watch`;
          
          // Final update - mark as completed
          await Task.updateOne({ taskId }, { 
            status: 'completed',
            percent: 100,
            cloudflareStreamStatus: 'ready',
            cloudflarePlaybackUrl: playbackUrl,
            cloudflareStreamMeta: {
              ...taskData.cloudflareStreamMeta,
              cloudflareData: videoData,
              completedAt: new Date().toISOString(),
              duration: videoData.duration,
              size: videoData.size
            }
          });

          // Update storage with final stream UID only
          if (taskData.storage) {
            await safeUpdateTranscode(taskData.storage, 'stream', streamUID, false);
            console.log(`Updated storage ${taskData.storage} with final stream UID: ${streamUID}`);
          }

          console.log(`✅ Stream is ready: ${streamUID}`);
          console.log(`   Playback URL: ${playbackUrl}`);
          console.log(`   Stream URL: ${streamUrl}`);
          break;
        }

        // Check for error states
        if (status === 'error') {
          throw new Error(`Cloudflare Stream processing failed: ${videoData.status?.errorReasonText || 'Unknown error'}`);
        }

        // Update storage with processing percentage instead of status
        if (taskData.storage && pollingAttempts % 3 === 0) { // Update every 3 polls (30 seconds)
          await safeUpdateTranscode(taskData.storage, 'stream', `${progress}%`, false);
        }

      } else {
        console.warn(`Failed to get video status for ${streamUID}:`, statusResponse.data.errors);
        
        // If 404, video might have been deleted
        if (statusResponse.status === 404) {
          throw new Error('Video not found on Cloudflare Stream');
        }
      }

    } catch (pollError) {
      console.error(`Polling error for ${streamUID}, attempt ${pollingAttempts}:`, pollError.message);
      
      // Continue polling unless it's a critical error
      if (pollError.response?.status === 404) {
        throw new Error('Video not found on Cloudflare Stream');
      }
      
      // If too many consecutive errors, break
      if (pollingAttempts > 5 && pollError.response?.status >= 400) {
        console.error(`Too many API errors for ${streamUID}, stopping polling`);
        break;
      }
    }
  }

  // Check if we timed out
  if (!isReady) {
    console.error(`Polling timeout for ${streamUID} after ${pollingAttempts} attempts`);
    
    await Task.updateOne({ taskId }, { 
      status: 'error',
      error: `Stream processing timeout after ${pollingAttempts} attempts (${pollingAttempts * 10 / 60} minutes)`,
      cloudflareStreamStatus: 'timeout'
    });
    
    if (taskData.storage) {
      await safeUpdateTranscode(taskData.storage, 'stream', 'error:timeout', false);
    }
    
    throw new Error(`Stream processing timeout after ${pollingAttempts} attempts`);
  }
}

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
  const inputPath = generateInputPath(taskId, trimData.input_url || trimData.url);
  let additionalInputs = []; // For storing overlay image paths

  // สร้าง output directory ถ้ายังไม่มี
  const outputDir = path.join(__dirname, 'outputs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log('Created output directory:', outputDir);
  }

  try {
    console.log('Downloading video from URL:', trimData.input_url || trimData.url);
    await Task.updateOne({ taskId }, { status: 'downloading' });
    
    if (taskData.storage) {
      await safeUpdateTranscode(taskData.storage, taskData.quality, 'downloading...', true);
    }

    try {
      await downloadWithTimeout(trimData.input_url || trimData.url, inputPath);
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

    // ตรวจสอบว่าสามารถใช้ copy mode ได้หรือไม่
    const hasOverlays = (trimData.overlays && trimData.overlays.length > 0) ||
                       (trimData.text_overlays && trimData.text_overlays.length > 0) ||
                       (trimData.image_overlays && trimData.image_overlays.length > 0);
    
    const hasAudioProcessing = trimData.audio_volume && trimData.audio_volume !== 1.0 ||
                              trimData.audio_filter;

    const hasMultipleSegments = trimData.trim_mode === 'multi' && trimData.segments.length > 1;
    
    const canUseCopyMode = trimData.copy_streams && 
                          !hasOverlays &&
                          !hasAudioProcessing &&
                          !hasMultipleSegments;

    console.log(`Copy mode analysis: requested=${trimData.copy_streams}, hasOverlays=${hasOverlays}, hasAudioProcessing=${hasAudioProcessing}, hasMultipleSegments=${hasMultipleSegments}, canUse=${canUseCopyMode}`);

    if (canUseCopyMode) {
      console.log('Using simple copy mode - single segment trim only');
      
      // สำหรับ copy mode ใช้ simple trim ไม่ใช้ filter complex
      const segment = trimData.segments[0];
      
      ffmpegCommand = ffmpegCommand
        .seekInput(segment.start)
        .duration(segment.duration)
        .videoCodec('copy')
        .audioCodec('copy')
        .outputOptions(['-avoid_negative_ts', 'make_zero']);
        
    } else {
      console.log('Using encode mode with filters due to overlays or audio processing');
      
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
      let overlayInputIndex = 1; // เริ่มจาก input index 1 (0 คือ video หลัก)
      
      if (trimData.overlays && trimData.overlays.length > 0) {
        console.log(`Processing ${trimData.overlays.length} overlays for task ${taskId}`);
        
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
              console.log(`Successfully added image input ${overlayInputIndex}:`, imageInputPath);
              overlayInputIndex++;
            } catch (imageError) {
              console.warn(`Failed to download overlay image ${i}:`, imageError.message);
              // Continue without this overlay
            }
          }
        }

        // Reset overlay input index for filter processing
        overlayInputIndex = 1;
        let imageOverlayIndex = 0;
        
        // เพิ่ม overlay filters
        trimData.overlays.forEach((overlay, index) => {
          console.log(`Processing overlay ${index}:`, overlay.type, overlay.content);
          console.log(`Overlay position:`, overlay.position);
          console.log(`Video dimensions:`, trimData.video_metadata?.width, 'x', trimData.video_metadata?.height);
          
          if (overlay.type === 'image' && additionalInputs[imageOverlayIndex]) {
            // สำหรับ image overlay - คำนวณตำแหน่งและขนาดจากเปอร์เซ็นต์
            const videoWidth = trimData.video_metadata?.width || 1280;
            const videoHeight = trimData.video_metadata?.height || 720;
            
            const x = Math.round((overlay.position?.x || 0) * videoWidth / 100);
            const y = Math.round((overlay.position?.y || 0) * videoHeight / 100);
            const width = Math.round((overlay.position?.width || 25) * videoWidth / 100);
            const height = Math.round((overlay.position?.height || 25) * videoHeight / 100);
            const opacity = overlay.style?.opacity || 1;
            
            console.log(`Image overlay calculated: ${width}x${height} at ${x},${y} with opacity ${opacity}`);
            console.log(`Image overlay percentages: ${overlay.position?.width}% x ${overlay.position?.height}% at ${overlay.position?.x}%,${overlay.position?.y}%`);
            
            // Scale image with opacity
            filterComplex.push(
              `[${overlayInputIndex}:v]scale=${width}:${height},format=rgba,colorchannelmixer=aa=${opacity}[overlay_img${index}]`
            );
            
            // Apply overlay with time constraints
            filterComplex.push(
              `${finalVideoInput}[overlay_img${index}]overlay=${x}:${y}:enable='between(t,${overlay.start_time},${overlay.end_time})'[overlay${index}]`
            );
            
            finalVideoInput = `[overlay${index}]`;
            overlayInputIndex++;
            imageOverlayIndex++;
          } else if (overlay.type === 'text') {
            // สำหรับ text overlay - คำนวณตำแหน่งจากเปอร์เซ็นต์
            const videoWidth = trimData.video_metadata?.width || 1280;
            const videoHeight = trimData.video_metadata?.height || 720;
            
            const fontsize = overlay.style?.font_size || 24;
            const fontcolor = overlay.style?.color || 'white';
            
            // คำนวณตำแหน่งจากเปอร์เซ็นต์
            let x = Math.round((overlay.position?.x || 10) * videoWidth / 100);
            let y = Math.round((overlay.position?.y || 10) * videoHeight / 100);
            
            const text = overlay.content.replace(/'/g, "\\\\'").replace(/"/g, '\\\\"'); // Escape quotes
            
            console.log(`Text overlay calculated: "${text}" at ${x},${y} (${overlay.position?.x}%, ${overlay.position?.y}%), size ${fontsize}`);
            console.log(`Text overlay style:`, overlay.style);
            
            let drawTextFilter = `${finalVideoInput}drawtext=text='${text}':fontsize=${fontsize}:fontcolor=${fontcolor}`;
            
            // Handle text alignment - ปรับตำแหน่ง x ตาม text_align
            if (overlay.style?.text_align === 'center') {
              drawTextFilter += `:x=(w-text_w)/2`; // ใช้ width ทั้งหมด สำหรับ center
            } else if (overlay.style?.text_align === 'right') {
              drawTextFilter += `:x=w-text_w-${x}`; // จากขวา minus margin
            } else {
              drawTextFilter += `:x=${x}`; // left align ใช้ตำแหน่งตรงๆ
            }
            
            drawTextFilter += `:y=${y}`;
            
            // เพิ่ม text styling options
            if (overlay.style?.font_weight === 'bold') {
              // Note: FFmpeg doesn't directly support font-weight, would need different font file
            }
            if (overlay.style?.text_shadow) {
              drawTextFilter += `:shadowcolor=black:shadowx=2:shadowy=2`;
            }
            if (overlay.style?.opacity && overlay.style.opacity !== 1) {
              drawTextFilter += `:alpha=${overlay.style.opacity}`;
            }
            
            drawTextFilter += `:enable='between(t,${overlay.start_time},${overlay.end_time})'`;
            
            console.log(`Generated text filter:`, drawTextFilter);
            
            filterComplex.push(
              `${drawTextFilter}[text${index}]`
            );
            finalVideoInput = `[text${index}]`;
          }
        });
        
        console.log(`Generated filter complex (${filterComplex.length} filters):`, filterComplex);
      }

      // สร้าง audio filter chain
      let finalAudioInput = inputs[1];
      
      // เพิ่ม audio filter สำหรับ volume adjustment
      if (trimData.audio_volume && trimData.audio_volume !== 1) {
        filterComplex.push(`${inputs[1]}volume=${trimData.audio_volume}[adjusted_audio]`);
        finalAudioInput = '[adjusted_audio]';
      } else if (trimData.audio_filter) {
        // ใช้ audio_filter ที่กำหนดมาโดยตรง
        filterComplex.push(`${inputs[1]}${trimData.audio_filter}[filtered_audio]`);
        finalAudioInput = '[filtered_audio]';
      }

      // Scale video ถ้าจำเป็น
      if (videoSize !== `${trimData.video_metadata?.width || 1280}x${trimData.video_metadata?.height || 720}`) {
        filterComplex.push(`${finalVideoInput}scale=${videoSize}[scaled]`);
        finalVideoInput = '[scaled]';
      }

      // Map final outputs
      let outputOptions = [
        '-preset', trimData.processing_mode === 'fast' ? 'fast' : 'medium',
        '-crf', '23',
        '-threads', '2',
        '-movflags', '+faststart',
        '-maxrate', '3M',
        '-bufsize', '6M'
      ];

      // ตั้งค่า filter complex
      if (filterComplex.length > 0) {
        ffmpegCommand = ffmpegCommand.complexFilter(filterComplex);
        
        // Map final video and audio outputs
        if (finalVideoInput.startsWith('[') && finalVideoInput.endsWith(']')) {
          outputOptions.push('-map', finalVideoInput);
        } else {
          outputOptions.push('-map', '0:v');
        }
        
        if (finalAudioInput.startsWith('[') && finalAudioInput.endsWith(']')) {
          outputOptions.push('-map', finalAudioInput);
        } else {
          outputOptions.push('-map', '0:a');
        }
      }

      // เพิ่ม options สำหรับ encode mode
      ffmpegCommand = ffmpegCommand
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions(outputOptions);
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
          await safeUpdateTranscode(taskData.storage, taskData.quality, percent, true);
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
            await safeUpdateTranscode(taskData.storage, taskData.quality, remoteUrl, true);
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
            await safeUpdateTranscode(taskData.storage, taskData.quality, 'error', true);
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
      await safeUpdateTranscode(taskData.storage, taskData.quality, 'error', true);
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
