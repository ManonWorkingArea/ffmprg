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
app.use(express.json());
app.use(express.static('public'));
app.use(express.static('outputs'));

const upload = multer({ dest: 'uploads/' });

// เชื่อมต่อกับ MongoDB
mongoose.connect('mongodb+srv://vue:Qazwsx1234!!@cloudmongodb.wpc62e9.mongodb.net/API').then(() => {
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

const baseUrl = `http://159.65.131.165:${port}`; // อัปเดต base URL

// Helper function สำหรับอัปเดต transcode field ใน Storage
async function updateStorageTranscode(storageId, quality, value) {
  try {
    // ตรวจสอบว่า storage มี transcode field หรือไม่
    const storage = await Storage.findById(new mongoose.Types.ObjectId(storageId));
    if (!storage) return;
    
    // ถ้า transcode เป็น null หรือไม่มี ให้สร้างใหม่
    if (!storage.transcode || storage.transcode === null) {
      await Storage.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(storageId) },
        { $set: { transcode: { [quality]: value } } },
        { new: true }
      ).exec();
    } else {
      // ถ้ามี transcode แล้ว ให้อัปเดตเฉพาะ field นั้น
      await Storage.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(storageId) },
        { $set: { [`transcode.${quality}`]: value } },
        { new: true }
      ).exec();
    }
  } catch (error) {
    console.error('Error updating storage transcode:', error);
  }
}

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
  console.log('Received conversion request'); // เพิ่ม log
  const quality = req.body.quality || '720p';
  const site = req.body.site; // Get the site from the request body
  let taskId;

  // Validate if site is provided
  if (!site) {
    console.log('Site is required'); // เพิ่ม log
    return res.status(400).json({ success: false, error: 'Site is required' });
  }

  // Fetch hostname data
  let hostnameData;
  let spaceData;
  try {
    hostnameData = await getHostnameData(site);
    console.log('Fetched hostname data:', hostnameData); // เพิ่ม log
    if (!hostnameData) {
      console.log('Hostname not found'); // เพิ่ม log
      return res.status(404).json({ success: false, error: 'Hostname not found' });
    }
  } catch (error) {
    console.error('Failed to fetch hostname data:', error); // เพิ่ม log
    return res.status(500).json({ success: false, error: 'Failed to fetch hostname data' });
  }

  try {
    spaceData = await getSpaceData(hostnameData.spaceId);
    console.log('Fetched space data:', spaceData); // เพิ่ม log
    if (!spaceData) {
      console.log('Space not found'); // เพิ่ม log
      return res.status(404).json({ success: false, error: 'Hostname not found' });
    }
  } catch (error) {
    console.error('Failed to fetch space data:', error); // เพิ่ม log
    return res.status(500).json({ success: false, error: 'Failed to fetch hostname data' });
  }

  if (req.file) {
    console.log('File uploaded:', req.file.path); // เพิ่ม log
    const existingTask = await Task.findOne({ inputPath: req.file.path, quality: quality });
    if (existingTask) {
      console.log('Existing task found:', existingTask.taskId); // เพิ่ม log
      return res.json({ success: true, taskId: existingTask.taskId });
    }
    taskId = uuidv4();
  } else if (req.body.url) {
    console.log('URL provided:', req.body.url); // เพิ่ม log
    const existingTask = await Task.findOne({ url: req.body.url, quality: quality });
    if (existingTask) {
      console.log('Existing task found:', existingTask.taskId); // เพิ่ม log
      return res.json({ success: true, taskId: existingTask.taskId });
    }
    taskId = uuidv4();
  } else {
    console.log('No video file or URL provided'); // เพิ่ม log
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
    site: hostnameData, // Store hostname reference
    space: spaceData, // Store spaceId for future processing
    storage: req.body.storage
  };

  console.log('Task data created:', taskData); // เพิ่ม log
  await Task.create(taskData); // Save to MongoDB

  // อัปเดตข้อมูลในคอลเลกชัน storage โดยใช้ค่า 'queue'
  await updateStorageTranscode(taskData.storage, taskData.quality, 'queue...');

  console.log('Process queue started for task:', taskId); // เพิ่ม log
  
  // เรียกใช้ processQueue โดยตรงแทนการใช้ queue system
  processQueue(taskId, taskData);

  res.json({ 
    success: true, 
    taskId, 
    downloadLink: `${baseUrl}/outputs/${taskId}-output.mp4`,
    site: hostnameData, // Store hostname reference
    space: spaceData, // Store spaceId for future processing
  });
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

  // เริ่มกระบวนการ queue
  processQueue(taskId, task);

  res.json({ success: true, message: `Task ${taskId} started.` });
});

// Endpoint: Force start queue processing
app.post('/start-queue', async (req, res) => {
  try {
    console.log('Force starting queue processing...');
    
    // หา task ที่รอดำเนินการ
    const queuedTasks = await Task.find({ status: 'queued' });
    
    if (queuedTasks.length > 0) {
      console.log(`Found ${queuedTasks.length} queued tasks`);
      
      // เรียกใช้ processQueue สำหรับ task แรก
      const firstTask = queuedTasks[0];
      console.log('Starting first task:', firstTask.taskId);
      processQueue(firstTask.taskId, firstTask);
      
      res.json({ 
        success: true, 
        message: `Queue processing started for task ${firstTask.taskId}`,
        tasksFound: queuedTasks.length 
      });
    } else {
      res.json({ 
        success: true, 
        message: 'No queued tasks found',
        tasksFound: 0 
      });
    }
  } catch (error) {
    console.error('Error starting queue:', error);
    res.status(500).json({ success: false, error: 'Failed to start queue' });
  }
});

// Endpoint: Debug queue status
app.get('/debug/queue', async (req, res) => {
  try {
    const queuedTasks = await Task.find({ status: 'queued' });
    const processingTasks = await Task.find({ status: 'processing' });
    const allTasks = await Task.find();
    
    res.json({
      success: true,
      debug: {
        isProcessing,
        queuedCount: queuedTasks.length,
        processingCount: processingTasks.length,
        totalTasks: allTasks.length,
        queuedTasks: queuedTasks.map(t => ({ taskId: t.taskId, status: t.status, createdAt: t.createdAt })),
        processingTasks: processingTasks.map(t => ({ taskId: t.taskId, status: t.status, percent: t.percent })),
        ffmpegProcesses: Object.keys(ffmpegProcesses)
      }
    });
  } catch (error) {
    console.error('Error getting debug info:', error);
    res.status(500).json({ success: false, error: 'Failed to get debug info' });
  }
});

// Endpoint: Reset processing flag
app.post('/debug/reset', async (req, res) => {
  try {
    isProcessing = false;
    console.log('Processing flag reset to false');
    res.json({ success: true, message: 'Processing flag reset' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to reset flag' });
  }
});

// Endpoint: Restart stuck task
app.post('/restart/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  
  try {
    const task = await Task.findOne({ taskId });
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // หยุดกระบวนการ ffmpeg ถ้ากำลังทำงานอยู่
    if (ffmpegProcesses[taskId]) {
      ffmpegProcesses[taskId].kill('SIGINT');
      delete ffmpegProcesses[taskId];
    }

    // ลบไฟล์ input ที่อาจดาวน์โหลดไม่สมบูรณ์
    if (task.inputPath) {
      fs.unlink(task.inputPath, (err) => {
        if (err) console.log('Input file not found or already deleted');
      });
    }

    // รีเซ็ตสถานะเป็น queued
    await Task.updateOne({ taskId }, { 
      status: 'queued', 
      percent: 0,
      error: null 
    });

    // อัปเดต storage
    if (task.storage) {
      await updateStorageTranscode(task.storage, task.quality, 'queue...');
    }

    // เริ่ม queue ใหม่
    processQueue(taskId, task);

    console.log(`Task ${taskId} restarted successfully`);
    res.json({ success: true, message: `Task ${taskId} restarted successfully.` });

  } catch (error) {
    console.error('Error restarting task:', error);
    res.status(500).json({ success: false, error: 'Failed to restart task' });
  }
});

// Endpoint: Stop ffmpeg process
app.post('/stop/:taskId', async (req, res) => {
  const taskId = req.params.taskId;

  if (ffmpegProcesses[taskId]) {
    ffmpegProcesses[taskId].kill('SIGINT'); // ส่งสัญญาณให้หยุดกระบวนการ
    delete ffmpegProcesses[taskId]; // ลบกระบวนการจากรายการ
    await Task.updateOne({ taskId }, { status: 'stopped' }); // อัปเดตสถานะใน MongoDB
    return res.json({ success: true, message: `Process for task ${taskId} stopped.` });
  } else {
    return res.status(404).json({ success: false, error: 'Task not found or already completed.' });
  }
});

// Endpoint: Delete task
app.delete('/task/:taskId', async (req, res) => {
  const taskId = req.params.taskId;

  try {
    const task = await Task.findOne({ taskId });
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // หยุดกระบวนการ ffmpeg ถ้ากำลังทำงานอยู่
    if (ffmpegProcesses[taskId]) {
      ffmpegProcesses[taskId].kill('SIGINT');
      delete ffmpegProcesses[taskId];
    }

    // ลบไฟล์ output ถ้ามี
    if (task.outputFile) {
      const outputPath = path.join(__dirname, 'outputs', `${taskId}-output.mp4`);
      fs.unlink(outputPath, (err) => {
        if (err) console.log('Output file not found or already deleted');
      });
    }

    // ลบไฟล์ input ถ้ามี
    if (task.inputPath) {
      fs.unlink(task.inputPath, (err) => {
        if (err) console.log('Input file not found or already deleted');
      });
    }

    // ลบข้อมูล transcode จาก Storage collection ถ้ามี storage
    if (task.storage) {
      try {
        await Storage.findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(task.storage) },
          { $unset: { [`transcode.${task.quality}`]: "" } },
          { new: true }
        ).exec();
      } catch (error) {
        console.log('Error removing transcode field:', error);
      }
    }

    // ลบ task จากฐานข้อมูล
    await Task.deleteOne({ taskId });

    console.log(`Task ${taskId} deleted successfully`);
    res.json({ success: true, message: `Task ${taskId} deleted successfully.` });

  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ success: false, error: 'Failed to delete task' });
  }
});

// Serve 'outputs' folder publicly
app.use('/outputs', express.static(path.join(__dirname, 'outputs')));

// เพิ่ม route สำหรับหน้าแรก
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
    const usedDiskGB = Math.round(diskInfo.usedGb);
    
    // คำนวณเปอร์เซ็นต์การใช้งาน
    const memoryPercent = Math.round((usedMemoryMB / 8192) * 100);
    const diskPercent = Math.round((usedDiskGB / 120) * 100);
    
    res.json({
      cpu: {
        cores: 4,
        usage: Math.round(cpuUsage), // ปัดเศษให้เป็นจำนวนเต็ม
        type: 'Regular Intel'
      },
      memory: {
        total: 8192, // 8GB
        used: usedMemoryMB,
        free: 8192 - usedMemoryMB,
        usagePercent: memoryPercent
      },
      disk: {
        total: 120, // 120GB
        used: usedDiskGB,
        free: 120 - usedDiskGB,
        usagePercent: diskPercent,
        bandwidth: {
          total: 5120, // 5TB
          unit: 'GB'
        }
      },
      server: {
        type: 'Basic',
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
      port: process.env.PORT || 3003,
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
  // ตรวจสอบว่ามี task ที่รอประมวลผลหรือไม่
  setTimeout(async () => {
    const queuedTasks = await Task.find({ status: 'queued' });
    if (queuedTasks.length > 0) {
      console.log(`Found ${queuedTasks.length} pending tasks, starting first task`);
      processQueue(queuedTasks[0].taskId, queuedTasks[0]);
    }
  }, 2000);
});

// Processing function
async function processQueue(taskId, taskData) {
  console.log('Processing queue for task:', taskId); // เพิ่ม log
  const outputFileName = `${taskId}-output.mp4`;
  const outputPath = path.join(__dirname, 'outputs', outputFileName);

  let videoSize;
  switch (taskData.quality) {
    case '240p': videoSize = '426x240'; break;
    case '420p': videoSize = '640x360'; break;
    case '720p': videoSize = '1280x720'; break;
    case '1080p': videoSize = '1920x1080'; break;
    case '1920p': videoSize = '1920x1080'; break;
    default: videoSize = '1280x720';
  }

  const inputPath = taskData.inputPath || path.join('uploads', `${taskId}-input.mp4`);

  // If URL provided, download the video
  if (taskData.url) {
    console.log('Downloading video from URL:', taskData.url); // เพิ่ม log
    await Task.updateOne({ taskId }, { status: 'downloading' }); // อัปเดตสถานะใน MongoDB
    // อัปเดตข้อมูลในคอลเลกชัน storage โดยใช้ค่า 'downloading...'
    await updateStorageTranscode(taskData.storage, taskData.quality, 'downloading...');

    try {
      const writer = fs.createWriteStream(inputPath);
      
      // เพิ่ม timeout และ headers สำหรับการดาวน์โหลด
      const response = await axios.get(taskData.url, { 
        responseType: 'stream',
        timeout: 300000, // 5 minutes timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      response.data.pipe(writer);
      
      // เพิ่ม error handling สำหรับ stream
      await new Promise((resolve, reject) => {
        let downloadedBytes = 0;
        const totalBytes = parseInt(response.headers['content-length']) || 0;
        
        response.data.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const percent = Math.round((downloadedBytes / totalBytes) * 100);
            console.log(`Download progress for task ${taskId}: ${percent}% (${downloadedBytes}/${totalBytes} bytes)`);
          }
        });
        
        writer.on('finish', () => {
          console.log('Video downloaded successfully to:', inputPath);
          resolve();
        });
        
        writer.on('error', (err) => {
          console.error('Writer error:', err);
          reject(err);
        });
        
        response.data.on('error', (err) => {
          console.error('Download stream error:', err);
          reject(err);
        });
        
        // เพิ่ม timeout สำหรับการดาวน์โหลด
        setTimeout(() => {
          reject(new Error('Download timeout after 5 minutes'));
        }, 300000);
      });
      
    } catch (downloadError) {
      console.error('Download failed for task:', taskId, downloadError);
      await Task.updateOne({ taskId }, { status: 'error', error: `Download failed: ${downloadError.message}` });
      await updateStorageTranscode(taskData.storage, taskData.quality, 'error');
      
      // ประมวลผล task ถัดไป
      setTimeout(async () => {
        const nextTask = await Task.findOne({ status: 'queued' });
        if (nextTask) {
          console.log('Starting next task after download error:', nextTask.taskId);
          processQueue(nextTask.taskId, nextTask);
        }
      }, 1000);
      
      return; // หยุดการทำงานของ task นี้
    }
  }

  // ตรวจสอบว่าไฟล์ input มีอยู่จริงและไม่เสียหาย
  try {
    const fileStats = fs.statSync(inputPath);
    if (fileStats.size === 0) {
      throw new Error('Downloaded file is empty');
    }
    console.log(`Input file verified: ${inputPath} (${fileStats.size} bytes)`);
  } catch (fileError) {
    console.error('Input file verification failed:', fileError);
    await Task.updateOne({ taskId }, { status: 'error', error: `Input file error: ${fileError.message}` });
    await updateStorageTranscode(taskData.storage, taskData.quality, 'error');
    
    // ประมวลผล task ถัดไป
    setTimeout(async () => {
      const nextTask = await Task.findOne({ status: 'queued' });
      if (nextTask) {
        console.log('Starting next task after file verification error:', nextTask.taskId);
        processQueue(nextTask.taskId, nextTask);
      }
    }, 1000);
    
    return;
  }

  await Task.updateOne({ taskId }, { status: 'processing' }); // อัปเดตสถานะใน MongoDB
  console.log('Task status updated to processing for task:', taskId); // เพิ่ม log

  const spaceData = JSON.parse(JSON.stringify(await getSpaceData(taskData.site.spaceId)));
  taskData.space = spaceData;

  const s3DataConfig = taskData.space;

  // ตั้งค่า S3 โดยใช้ข้อมูลจาก taskData
  const s3Client = new S3({
    endpoint: `${taskData.space.s3EndpointDefault}`, // Include bucket in the endpoint
    region: `${taskData.space.s3Region}`, // DigitalOcean Spaces does not require a specific region
    ResponseContentEncoding: "utf-8",
    credentials: {
      accessKeyId: s3DataConfig.s3Key, // Ensure they are valid strings
      secretAccessKey: s3DataConfig.s3Secret
    },
    forcePathStyle: false // DigitalOcean Spaces does NOT use path-style addressing
  });

  // เริ่มกระบวนการ ffmpeg
  console.log('Starting ffmpeg process for task:', taskId); // เพิ่ม log
  ffmpegProcesses[taskId] = ffmpeg(inputPath)
    .size(videoSize)
    .videoCodec('libx264')
    .outputOptions(['-preset', 'veryfast', '-crf', '22'])
    .on('progress', async (progress) => {
      const percent = Math.round(progress.percent);
      console.log(`Processing progress for task ${taskId}: ${percent}%`); // เพิ่ม log
      await Task.updateOne({ taskId }, { status: 'processing', percent });

      // อัปเดตข้อมูลในคอลเลกชัน storage โดยใช้เปอร์เซ็นต์
      await updateStorageTranscode(taskData.storage, taskData.quality, percent);
    })    
    .on('end', async () => {
      console.log('ffmpeg process completed for task:', taskId); // เพิ่ม log
      delete ffmpegProcesses[taskId]; // ลบกระบวนการเมื่อเสร็จสิ้น
      await Task.updateOne({ taskId }, { status: 'completed', outputFile: `/${outputFileName}` });
      
      // อัปโหลดไปยัง S3
      const fileContent = fs.readFileSync(outputPath);
      const params = {
        Bucket: `${taskData.space.s3Bucket}`, // ชื่อ bucket จาก taskData
        Key: `outputs/${outputFileName}`, // ชื่อไฟล์ใน S3
        Body: fileContent,
        ACL: 'public-read' // ตั้งค่าสิทธิ์การเข้าถึง
      };

      try {
        const uploadResult = await s3Client.putObject(params); // เปลี่ยนเป็นใช้ putObject
        const remoteUrl = `${taskData.space.s3Endpoint}outputs/${outputFileName}`; // สร้าง URL ของไฟล์ที่อัปโหลด

        // อัปเดตข้อมูลในคอลเลกชัน storage โดยใช้ remoteUrl
        await updateStorageTranscode(taskData.storage, taskData.quality, remoteUrl);

        console.log("Storage updated with remote URL:", remoteUrl); // เพิ่ม log
      } catch (uploadError) {
        console.error('Error uploading to S3:', uploadError); // เพิ่ม log
      }

      fs.unlink(inputPath, () => {
        console.log('Input file deleted:', inputPath); // เพิ่ม log
      });
      
      // ประมวลผล task ถัดไป
      setTimeout(async () => {
        const nextTask = await Task.findOne({ status: 'queued' });
        if (nextTask) {
          console.log('Starting next task:', nextTask.taskId);
          processQueue(nextTask.taskId, nextTask);
        }
      }, 1000);
    })
    .on('error', async (err) => {
      console.error('ffmpeg process error for task:', taskId, err); // เพิ่ม log
      delete ffmpegProcesses[taskId]; // ลบกระบวนการเมื่อเกิดข้อผิดพลาด
      await Task.updateOne({ taskId }, { status: 'error', error: err.message });
      fs.unlink(inputPath, () => {
        console.log('Input file deleted due to error:', inputPath); // เพิ่ม log
      });
      
      // ประมวลผล task ถัดไป
      setTimeout(async () => {
        const nextTask = await Task.findOne({ status: 'queued' });
        if (nextTask) {
          console.log('Starting next task after error:', nextTask.taskId);
          processQueue(nextTask.taskId, nextTask);
        }
      }, 1000);
    })
    .save(outputPath);
}

// ฟังก์ชันคำนวณเปอร์เซ็นต์
function calculatePercent(taskData) {
  return taskData.percent || 0; // คืนค่าเปอร์เซ็นต์จากข้อมูลที่บันทึกไว้
}

// ฟังก์ชันใหม่สำหรับจัดการคิวถัดไป
async function processNextQueue() {
  if (isProcessing) {
    console.log('Queue is already processing, skipping...');
    return; // ถ้ากำลังประมวลผลอยู่ ให้หยุด
  }
  
  const nextTask = await Task.findOne({ status: 'queued' });
  
  if (nextTask) {
    console.log('Found queued task:', nextTask.taskId);
    isProcessing = true; // ตั้งค่าสถานะการประมวลผล
    
    try {
      await processQueue(nextTask.taskId, nextTask); // เรียกใช้ processQueue สำหรับ task ถัดไป
    } catch (error) {
      console.error('Error processing task:', nextTask.taskId, error);
      await Task.updateOne({ taskId: nextTask.taskId }, { status: 'error', error: error.message });
    } finally {
      isProcessing = false; // รีเซ็ตสถานะการประมวลผล
      // ตรวจสอบว่ามี task อื่นๆ ที่รออยู่หรือไม่
      setTimeout(() => {
        processNextQueue(); // เรียกใช้ processNextQueue เพื่อประมวลผลงานถัดไป
      }, 1000);
    }
  } else {
    console.log('No queued tasks found');
  }
}

