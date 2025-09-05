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
  storage: String,
  // เพิ่มฟิลด์สำหรับ video trimming
  type: { type: String, default: 'convert' }, // 'convert' หรือ 'trim'
  startTime: String,  // เวลาเริ่มต้นสำหรับ trim
  endTime: String,    // เวลาสิ้นสุดสำหรับ trim
  originalFilename: String, // ชื่อไฟล์ต้นฉบับ
  // เพิ่มฟิลด์สำหรับ text และ image overlay
  textOverlay: Object,  // ข้อมูล text overlay
  imageOverlay: Object, // ข้อมูล image overlay
  error: String,       // ข้อผิดพลาด (ถ้ามี)
  // เพิ่มฟิลด์สำหรับ advanced trim features
  trimData: {
    mode: String,           // 'single' หรือ 'multi'
    segments: [Object],     // array ของ segments สำหรับ multi-trim
    overlays: [Object],     // array ของ overlays (text/image)
    videoMetadata: Object,  // metadata ของวิดีโอ
    audioVolume: Number,    // ระดับเสียง
    outputFormat: String,   // รูปแบบไฟล์ output
    processingMode: String, // โหมดการประมวลผล
    filename: String,       // ชื่อไฟล์ output
    copyStreams: Boolean,   // copy streams หรือ re-encode
    audioFilter: String,    // audio filter
    preserveQuality: Boolean, // รักษาคุณภาพ
    hardwareAcceleration: Boolean, // ใช้ hardware acceleration
    threads: String         // จำนวน threads
  },
  clientInfo: Object      // ข้อมูล client
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

// ฟังก์ชันตรวจสอบและเลือกฟอนต์ไทยที่ดีที่สุด
function selectThaiFont() {
  const thaiFonts = [
    {
      path: '/usr/share/fonts/truetype/tlwg/Garuda.ttf',
      name: 'Garuda',
      description: 'ฟอนต์ไทยยอดนิยม อ่านง่าย'
    },
    {
      path: '/usr/share/fonts/truetype/tlwg/Waree.ttf',
      name: 'Waree', 
      description: 'ฟอนต์ไทยสวย เหมาะกับหัวข้อ'
    },
    {
      path: '/usr/share/fonts/truetype/tlwg/TlwgTypist.ttf',
      name: 'Tlwg Typist',
      description: 'ฟอนต์ไทยแบบพิมพ์ดีด'
    },
    {
      path: '/usr/share/fonts/truetype/tlwg/Kinnari-Italic.ttf',
      name: 'Kinnari',
      description: 'ฟอนต์ไทยแบบหนังสือ'
    }
  ];
  
  for (const font of thaiFonts) {
    if (fs.existsSync(font.path)) {
      console.log(`✅ Selected Thai font: ${font.name} (${font.description})`);
      console.log(`📁 Font path: ${font.path}`);
      return font;
    }
  }
  
  // Fallback
  const fallbackPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  console.log(`⚠️  Using fallback font: ${fallbackPath}`);
  return { path: fallbackPath, name: 'DejaVu Sans', description: 'Fallback font' };
}

// ฟังก์ชันคำนวณระยะเวลาสำหรับการตัดต่อวิดีโอ
function calculateDuration(startTime, endTime) {
  // แปลงเวลาเป็นวินาที
  function timeToSeconds(time) {
    if (typeof time === 'number') return time;
    
    // รองรับรูปแบบ HH:MM:SS, MM:SS, หรือ SS
    const parts = time.toString().split(':').reverse();
    let seconds = 0;
    
    if (parts[0]) seconds += parseFloat(parts[0]); // วินาที
    if (parts[1]) seconds += parseInt(parts[1]) * 60; // นาที
    if (parts[2]) seconds += parseInt(parts[2]) * 3600; // ชั่วโมง
    
    return seconds;
  }
  
  const startSeconds = timeToSeconds(startTime);
  const endSeconds = timeToSeconds(endTime);
  const duration = endSeconds - startSeconds;
  
  if (duration <= 0) {
    throw new Error('End time must be greater than start time');
  }
  
  console.log(`📐 Duration calculation: ${startTime} (${startSeconds}s) - ${endTime} (${endSeconds}s) = ${duration}s`);
  return duration;
}

// ฟังก์ชันสร้าง text overlay filter
function createTextOverlayFilter(overlay, videoSize, inputLabel, outputLabel) {
  const selectedFont = selectThaiFont();
  const fontPath = selectedFont.path;
  
  // คำนวณตำแหน่งจาก percentage
  const videoWidth = parseInt(videoSize.split('x')[0]);
  const videoHeight = parseInt(videoSize.split('x')[1]);
  
  const x = Math.round((overlay.position.x / 100) * videoWidth);
  const y = Math.round((overlay.position.y / 100) * videoHeight);
  
  // เข้ารหัสข้อความ
  const cleanText = overlay.content
    .replace(/'/g, "'")
    .replace(/"/g, '"')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/\n/g, '\\n');
  
  const encodedText = Buffer.from(cleanText, 'utf8').toString('utf8');
  
  // สร้าง filter
  const textFilter = `${inputLabel}drawtext=text='${encodedText}':fontsize=${overlay.style.font_size || 24}:fontcolor=${overlay.style.color || 'white'}:x=${x}:y=${y}:fontfile='${fontPath}':enable='between(t,${overlay.start_time || 0},${overlay.end_time || 999999})':shadowcolor=black@0.8:shadowx=2:shadowy=2:borderw=2:bordercolor=black@0.7${outputLabel}`;
  
  console.log(`📝 Text overlay: "${encodedText}" at (${x}, ${y})`);
  return textFilter;
}

// ฟังก์ชันสร้าง image overlay filter
function createImageOverlayFilter(overlay, videoSize, inputLabel, outputLabel, inputIndex) {
  // คำนวณตำแหน่งและขนาดจาก percentage
  const videoWidth = parseInt(videoSize.split('x')[0]);
  const videoHeight = parseInt(videoSize.split('x')[1]);
  
  const x = Math.round((overlay.position.x / 100) * videoWidth);
  const y = Math.round((overlay.position.y / 100) * videoHeight);
  const width = Math.round((overlay.position.width / 100) * videoWidth);
  const height = Math.round((overlay.position.height / 100) * videoHeight);
  
  // สร้าง filter สำหรับ scale และ overlay
  const scaleFilter = `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${overlay.style.opacity || 1.0}[scaled_img_${inputIndex}]`;
  const overlayFilter = `${inputLabel}[scaled_img_${inputIndex}]overlay=${x}:${y}:enable='between(t,${overlay.start_time || 0},${overlay.end_time || 999999})'${outputLabel}`;
  
  console.log(`🖼️ Image overlay: ${overlay.content} at (${x}, ${y}) size ${width}x${height}`);
  return [scaleFilter, overlayFilter];
}

let ffmpegProcesses = {}; // เก็บข้อมูลเกี่ยวกับกระบวนการ ffmpeg
let isProcessing = false; // ตัวแปรเพื่อบอกสถานะการประมวลผล
let concurrentJobs = 0; // ตัวนับงานที่กำลังทำพร้อมกัน
const MAX_CONCURRENT_JOBS = 2; // เพิ่มเป็น 2 งานพร้อมกัน (จาก 1)
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
      url: req.body.url,
      site: hostnameData,
      space: spaceData,
      storage: req.body.storage,
      retryCount: 0, // เพิ่มตัวนับการ retry
      // Text overlay settings
      textOverlay: req.body.textOverlay ? {
        text: req.body.textOverlay.text || '',
        position: req.body.textOverlay.position || 'bottom-right',
        color: req.body.textOverlay.color || 'white',
        size: req.body.textOverlay.size || 'medium',
        x: req.body.textOverlay.x || null,
        y: req.body.textOverlay.y || null
      } : null,
      // Image overlay settings
      imageOverlay: req.body.imageOverlay ? {
        imagePath: req.body.imageOverlay.imagePath || null,
        position: req.body.imageOverlay.position || 'top-right',
        size: req.body.imageOverlay.size || '200x200',
        x: req.body.imageOverlay.x || null,
        y: req.body.imageOverlay.y || null,
        opacity: req.body.imageOverlay.opacity || 1.0
      } : null
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
    res.json({ success: true, tasks }); // คืนค่าข้อมูลทั้งหมด
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

// Endpoint สำหรับตัดต่อวิดีโอ (Video Trimming) - รองรับ Advanced Features
app.post('/trim', upload.single('video'), async (req, res) => {
  const taskId = uuidv4();
  
  try {
    // รองรับทั้งการส่งไฟล์และ JSON payload
    let videoData = {};
    
    if (req.body.input_url) {
      // รับข้อมูลจาก JSON payload (Advanced mode)
      videoData = {
        input_url: req.body.input_url,
        trim_mode: req.body.trim_mode || 'single',
        segments: req.body.segments || [],
        overlays: req.body.overlays || [],
        video_metadata: req.body.video_metadata || {},
        audio_volume: req.body.audio_volume || 1,
        output_format: req.body.output_format || 'mp4',
        quality: req.body.quality || '720p',
        processing_mode: req.body.processing_mode || 'fast',
        filename: req.body.filename || `${taskId}-trimmed.mp4`,
        site: req.body.site || '',
        storage: req.body.storage || '',
        client_info: req.body.client_info || {}
      };
      
      console.log(`🎬 Advanced trim request: ${videoData.trim_mode} mode with ${videoData.segments.length} segments`);
      
    } else if (req.file) {
      // โหมดพื้นฐาน (Basic mode) - ใช้ไฟล์ที่อัปโหลด
      const { startTime, endTime, quality = '720p' } = req.body;
      
      if (!startTime || !endTime) {
        return res.status(400).json({ 
          success: false, 
          error: 'Start time and end time are required (format: HH:MM:SS or seconds)' 
        });
      }

      // ตรวจสอบรูปแบบเวลา
      const timeRegex = /^(\d{1,2}:)?(\d{1,2}:)?\d{1,2}(\.\d+)?$/;
      if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid time format. Use HH:MM:SS or seconds' 
        });
      }
      
      videoData = {
        inputPath: req.file.path,
        originalFilename: req.file.originalname,
        startTime,
        endTime,
        quality,
        trim_mode: 'single'
      };
      
    } else {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file or input_url provided' 
      });
    }

    // สร้าง task ใหม่ด้วยข้อมูลครบถ้วน
    const newTask = new Task({
      taskId,
      originalFilename: videoData.originalFilename || videoData.filename || 'video.mp4',
      inputPath: videoData.inputPath,
      url: videoData.input_url,
      quality: videoData.quality,
      startTime: videoData.startTime,
      endTime: videoData.endTime,
      type: 'trim',
      status: 'queued',
      percent: 0,
      createdAt: new Date(),
      // เพิ่มข้อมูลสำหรับ advanced trim
      trimData: {
        mode: videoData.trim_mode,
        segments: videoData.segments,
        overlays: videoData.overlays,
        videoMetadata: videoData.video_metadata,
        audioVolume: videoData.audio_volume,
        outputFormat: videoData.output_format,
        processingMode: videoData.processing_mode,
        filename: videoData.filename,
        copyStreams: videoData.copy_streams,
        audioFilter: videoData.audio_filter,
        preserveQuality: videoData.preserve_quality,
        hardwareAcceleration: videoData.hardware_acceleration,
        threads: videoData.threads
      },
      site: { spaceId: videoData.storage },
      storage: videoData.storage,
      clientInfo: videoData.client_info
    });

    await newTask.save();
    
    if (videoData.trim_mode === 'multi') {
      console.log(`✂️ Multi-segment trim task created: ${taskId}`);
      console.log(`📊 Segments: ${videoData.segments.length}`);
      console.log(`🎨 Overlays: ${videoData.overlays.length}`);
    } else {
      console.log(`✂️ Single trim task created: ${taskId} (${videoData.startTime} - ${videoData.endTime})`);
    }

    // เริ่มประมวลผลคิว
    processNextQueue();

    res.json({ 
      success: true, 
      taskId, 
      message: `Video ${videoData.trim_mode} trim task queued successfully`,
      trimMode: videoData.trim_mode,
      segments: videoData.segments?.length || 1,
      overlays: videoData.overlays?.length || 0,
      quality: videoData.quality,
      processingMode: videoData.processing_mode
    });

  } catch (error) {
    console.error('Error creating trim task:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error: ' + error.message 
    });
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

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
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
    
    // ปรับเกณฑ์ให้ใช้ประโยชน์จาก 4 cores ได้มากขึ้น
    // CPU: หยุดเมื่อ > 90% (เพิ่มจาก 85% เพื่อใช้ประโยชน์มากขึ้น)
    // Memory: หยุดเมื่อ > 85% (เพิ่มจาก 80%)
    const cpuOverload = cpuUsage > 90;
    const memoryUsagePercent = (memInfo.usedMemMb / memInfo.totalMemMb) * 100;
    const memoryOverload = memoryUsagePercent > 85;
    
    return {
      canProcess: !cpuOverload && !memoryOverload,
      cpuUsage,
      memoryUsage: memoryUsagePercent,
      thresholds: {
        cpu: 90,
        memory: 85
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
    
    // สร้าง filter complex สำหรับ text และ image overlay
    let filterComplexArray = [];
    let inputIndex = 0;
    
    // สร้างส่วน video scale และ text overlay
    let videoFilter = `[0:v]scale=${videoSize}:force_original_aspect_ratio=decrease,pad=${videoSize}:(ow-iw)/2:(oh-ih)/2,setsar=1[scaled]`;
    
    // เพิ่ม text overlay ถ้ามี
    if (taskData.textOverlay && taskData.textOverlay.text) {
      const textData = taskData.textOverlay;
      
      // กำหนดขนาดฟอนต์ตาม video resolution
      let fontSize = Math.round(parseInt(videoSize.split('x')[1]) * 0.05); // 5% ของความสูงวิดีโอ
      switch (textData.size) {
        case 'small': fontSize = Math.round(fontSize * 0.7); break;
        case 'medium': fontSize = Math.round(fontSize * 1.0); break;
        case 'large': fontSize = Math.round(fontSize * 1.4); break;
      }
      
      // กำหนดตำแหน่ง text
      let textPosition = 'x=10:y=10'; // default: บนซ้าย
      switch (textData.position) {
        case 'top-left': textPosition = 'x=10:y=10'; break;
        case 'top-center': textPosition = 'x=(w-text_w)/2:y=10'; break;
        case 'top-right': textPosition = 'x=w-text_w-10:y=10'; break;
        case 'center-left': textPosition = 'x=10:y=(h-text_h)/2'; break;
        case 'center': textPosition = 'x=(w-text_w)/2:y=(h-text_h)/2'; break;
        case 'center-right': textPosition = 'x=w-text_w-10:y=(h-text_h)/2'; break;
        case 'bottom-left': textPosition = 'x=10:y=h-text_h-10'; break;
        case 'bottom-center': textPosition = 'x=(w-text_w)/2:y=h-text_h-10'; break;
        case 'bottom-right': textPosition = 'x=w-text_w-10:y=h-text_h-10'; break;
        default: textPosition = textData.x && textData.y ? `x=${textData.x}:y=${textData.y}` : 'x=10:y=10';
      }
      
      // เลือก Thai font ที่เหมาะสมผ่านฟังก์ชัน selectThaiFont()
      const selectedFont = selectThaiFont();
      const fontPath = selectedFont.path;
      
      console.log(`Using Thai font: ${fontPath}`);
      
      // เข้ารหัส text สำหรับภาษาไทยให้ถูกต้อง - รองรับ Unicode
      let cleanText = textData.text
        .replace(/'/g, "'")           // แทนที่ single quote
        .replace(/"/g, '"')           // แทนที่ double quote
        .replace(/\\/g, '\\\\')       // escape backslash
        .replace(/:/g, '\\:')         // escape colon สำหรับ FFmpeg
        .replace(/\n/g, '\\n');       // แทนที่ newline
      
      // ตรวจสอบและแปลงข้อความไทยให้ FFmpeg อ่านได้
      const encodedText = Buffer.from(cleanText, 'utf8').toString('utf8');
      
      // สร้าง text filter พร้อม Thai font support, shadow และการปรับแต่งขั้นสูง
      const textFilter = `drawtext=text='${encodedText}':fontsize=${fontSize}:fontcolor=${textData.color || 'white'}:${textPosition}:fontfile='${fontPath}':enable='between(t,0,999999)':shadowcolor=black@0.8:shadowx=2:shadowy=2:borderw=2:bordercolor=black@0.7:box=1:boxcolor=black@0.3:boxborderw=5`;
      
      console.log(`🎨 Text overlay: "${encodedText}"`);
      console.log(`📝 Using font: ${selectedFont.name} (${selectedFont.description})`);
      console.log(`🔧 Text filter: ${textFilter}`);
      
      videoFilter += `[scaled]${textFilter}[text_overlay]`;
    } else {
      videoFilter += '[text_overlay]';
    }
    
    filterComplexArray.push(videoFilter);
    
    // เพิ่ม image overlay ถ้ามี
    if (taskData.imageOverlay && taskData.imageOverlay.imagePath) {
      const imageData = taskData.imageOverlay;
      inputIndex = 1;
      
      // กำหนดขนาดของ image overlay ตาม video resolution
      const videoWidth = parseInt(videoSize.split('x')[0]);
      const videoHeight = parseInt(videoSize.split('x')[1]);
      
      let imageWidth, imageHeight;
      if (imageData.size.includes('x')) {
        [imageWidth, imageHeight] = imageData.size.split('x').map(s => parseInt(s));
      } else {
        // ถ้าไม่ระบุขนาด ให้ใช้ 15% ของความกว้างวิดีโอ
        imageWidth = Math.round(videoWidth * 0.15);
        imageHeight = Math.round(videoHeight * 0.15);
      }
      
      // จำกัดขนาดไม่ให้เกิน 25% ของวิดีโอ
      const maxWidth = Math.round(videoWidth * 0.25);
      const maxHeight = Math.round(videoHeight * 0.25);
      
      if (imageWidth > maxWidth) imageWidth = maxWidth;
      if (imageHeight > maxHeight) imageHeight = maxHeight;
      
      // กำหนดตำแหน่งของ image overlay
      let overlayX = 10, overlayY = 10; // default: บนซ้าย
      
      switch (imageData.position) {
        case 'top-left': 
          overlayX = 10; 
          overlayY = 10; 
          break;
        case 'top-center': 
          overlayX = `(main_w-overlay_w)/2`; 
          overlayY = 10; 
          break;
        case 'top-right': 
          overlayX = `main_w-overlay_w-10`; 
          overlayY = 10; 
          break;
        case 'center-left': 
          overlayX = 10; 
          overlayY = `(main_h-overlay_h)/2`; 
          break;
        case 'center': 
          overlayX = `(main_w-overlay_w)/2`; 
          overlayY = `(main_h-overlay_h)/2`; 
          break;
        case 'center-right': 
          overlayX = `main_w-overlay_w-10`; 
          overlayY = `(main_h-overlay_h)/2`; 
          break;
        case 'bottom-left': 
          overlayX = 10; 
          overlayY = `main_h-overlay_h-10`; 
          break;
        case 'bottom-center': 
          overlayX = `(main_w-overlay_w)/2`; 
          overlayY = `main_h-overlay_h-10`; 
          break;
        case 'bottom-right': 
          overlayX = `main_w-overlay_w-10`; 
          overlayY = `main_h-overlay_h-10`; 
          break;
        default: 
          overlayX = imageData.x || 10; 
          overlayY = imageData.y || 10;
      }
      
      // สร้าง image filter พร้อมการรักษาสัดส่วน
      const opacity = imageData.opacity || 1.0;
      const imageFilter = `[1:v]scale=${imageWidth}:${imageHeight}:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${opacity}[img_scaled];[text_overlay][img_scaled]overlay=${overlayX}:${overlayY}[final]`;
      filterComplexArray.push(imageFilter);
    }
    
    let ffmpegCommand = ffmpeg(inputPath);
    
    // เพิ่ม input สำหรับ image overlay
    if (taskData.imageOverlay && taskData.imageOverlay.imagePath) {
      ffmpegCommand = ffmpegCommand.input(taskData.imageOverlay.imagePath);
    }
    
    // ปรับแต่งการประมวลผลตามประเภทงาน
    let ffmpegProcess;
    
    if (taskData.type === 'trim') {
      // สำหรับงานตัดต่อวิดีโอ - รองรับทั้ง single และ multi-segment
      const trimData = taskData.trimData || {};
      const trimMode = trimData.mode || 'single';
      
      if (trimMode === 'multi' && trimData.segments && trimData.segments.length > 0) {
        // Multi-segment trim - รวมหลายช่วงเป็นวิดีโอเดียว
        console.log(`🎬 Processing multi-segment trim: ${trimData.segments.length} segments`);
        
        // สร้าง filter complex สำหรับ multi-segment
        let segmentFilters = [];
        let overlayFilters = [];
        
        // สร้าง filter สำหรับแต่ละ segment
        trimData.segments.forEach((segment, index) => {
          const segmentFilter = `[0:v]trim=start=${segment.start}:end=${segment.end},setpts=PTS-STARTPTS[v${index}]; [0:a]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS[a${index}]`;
          segmentFilters.push(segmentFilter);
        });
        
        // รวม segments เข้าด้วยกัน
        const videoInputs = trimData.segments.map((_, index) => `[v${index}]`).join('');
        const audioInputs = trimData.segments.map((_, index) => `[a${index}]`).join('');
        const concatFilter = `${videoInputs}concat=n=${trimData.segments.length}:v=1:a=0[trimmed_video]; ${audioInputs}concat=n=${trimData.segments.length}:v=0:a=1[trimmed_audio]`;
        
        // เพิ่ม overlays ถ้ามี
        let finalVideoOutput = '[trimmed_video]';
        if (trimData.overlays && trimData.overlays.length > 0) {
          trimData.overlays.forEach((overlay, index) => {
            if (overlay.type === 'text') {
              const textFilter = createTextOverlayFilter(overlay, videoSize, finalVideoOutput, `[text_${index}]`);
              overlayFilters.push(textFilter);
              finalVideoOutput = `[text_${index}]`;
            } else if (overlay.type === 'image') {
              // สำหรับ image overlay ต้องเพิ่ม input
              ffmpegCommand = ffmpegCommand.input(overlay.content);
              const imageFilter = createImageOverlayFilter(overlay, videoSize, finalVideoOutput, `[img_${index}]`, index + 1);
              overlayFilters.push(imageFilter);
              finalVideoOutput = `[img_${index}]`;
            }
          });
        }
        
        // รวม filters ทั้งหมด
        const allFilters = [...segmentFilters, concatFilter, ...overlayFilters];
        
        ffmpegProcess = ffmpegCommand
          .complexFilter(allFilters)
          .map(finalVideoOutput) // video output
          .map('[trimmed_audio]')  // audio output
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            '-preset', trimData.processingMode === 'fast' ? 'fast' : 'medium',
            '-crf', '23',
            '-threads', trimData.threads === 'auto' ? '0' : '2',
            '-movflags', '+faststart',
            '-maxrate', '3M',
            '-bufsize', '6M'
          ]);
          
      } else {
        // Single segment trim (โหมดปกติ)
        console.log(`🎬 Processing single trim: ${taskData.startTime} - ${taskData.endTime}`);
        
        ffmpegProcess = ffmpegCommand
          .seekInput(taskData.startTime)
          .duration(calculateDuration(taskData.startTime, taskData.endTime))
          .size(videoSize)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            '-preset', 'fast',
            '-crf', '23',
            '-threads', '2',
            '-movflags', '+faststart',
            '-maxrate', '3M',
            '-bufsize', '6M'
          ]);
      }
    } else {
      // สำหรับงานแปลงปกติ (convert)
      ffmpegProcess = ffmpegCommand
        .size(videoSize)
        .videoCodec('libx264')
        .outputOptions([
          '-preset', 'fast',        // เปลี่ยนจาก medium เป็น fast เพื่อความเร็ว
          '-crf', '23',             // ปรับจาก 24 เป็น 23 (คุณภาพดีขึ้นเล็กน้อย)
          '-threads', '2',          // ใช้ 2 threads ต่องาน (2 งาน = 4 threads รวม)
          '-movflags', '+faststart',// optimized for streaming
          '-maxrate', '3M',         // เพิ่ม bitrate จาก 2M เป็น 3M
          '-bufsize', '6M',         // เพิ่ม buffer จาก 4M เป็น 6M
          ...(filterComplexArray.length > 0 ? ['-filter_complex', filterComplexArray.join(';')] : []),
          ...(taskData.imageOverlay ? ['-map', '[final]'] : taskData.textOverlay ? ['-map', '[text_overlay]'] : [])
        ]);
    }
    
    ffmpegProcess
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
          await Task.updateOne({ taskId }, { status: 'completed', outputFile: `/${outputFileName}` });
          
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
      console.log(`Found next task: ${nextTask.taskId} (System: CPU ${systemLoad.cpuUsage}%, Memory ${systemLoad.memoryUsage}%)`);
      // เริ่มประมวลผลโดยมี delay เล็กน้อยเพื่อให้ระบบได้พัก
      setTimeout(() => processQueue(nextTask.taskId, nextTask), 2000);
    } else {
      console.log('No queued tasks found');
    }
  } catch (error) {
    console.error('Error in processNextQueue:', error);
    // หากเกิดข้อผิดพลาด ลอง process อีกครั้งในอีก 30 วินาที
    setTimeout(processNextQueue, 30000);
  }
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

// Endpoint สำหรับตรวจสอบฟอนต์ไทยที่ติดตั้ง
app.get('/check-thai-fonts', (req, res) => {
  try {
    const selectedFont = selectThaiFont();
    
    // ตรวจสอบฟอนต์ TLWG ทั้งหมด
    const allThaiFonts = [
      '/usr/share/fonts/truetype/tlwg/Garuda.ttf',
      '/usr/share/fonts/truetype/tlwg/Waree.ttf', 
      '/usr/share/fonts/truetype/tlwg/TlwgTypist.ttf',
      '/usr/share/fonts/truetype/tlwg/Kinnari-Italic.ttf',
      '/usr/share/fonts/truetype/tlwg/Loma-Oblique.ttf',
      '/usr/share/fonts/truetype/tlwg/Laksaman-Italic.ttf',
      '/usr/share/fonts/truetype/tlwg/TlwgTypo-Bold.ttf',
      '/usr/share/fonts/truetype/tlwg/TlwgMono-Bold.ttf',
      '/usr/share/fonts/truetype/tlwg/TlwgTypewriter-BoldOblique.ttf'
    ];
    
    const installedFonts = allThaiFonts.filter(fontPath => fs.existsSync(fontPath));
    
    res.json({
      success: true,
      selectedFont: {
        name: selectedFont.name,
        path: selectedFont.path,
        description: selectedFont.description,
        exists: fs.existsSync(selectedFont.path)
      },
      installedThaiFonts: installedFonts.map(fontPath => ({
        path: fontPath,
        name: path.basename(fontPath, '.ttf'),
        exists: fs.existsSync(fontPath)
      })),
      totalInstalled: installedFonts.length,
      platform: process.platform
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

