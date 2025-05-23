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

const baseUrl = `http://159.65.131.165:${port}`; // อัปเดต base URL

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
    const existingTask = await Task.findOne({ inputPath: req.file.path });
    if (existingTask) {
      console.log('Existing task found:', existingTask.taskId); // เพิ่ม log
      return res.json({ success: true, taskId: existingTask.taskId });
    }
    taskId = uuidv4();
  } else if (req.body.url) {
    console.log('URL provided:', req.body.url); // เพิ่ม log
    const existingTask = await Task.findOne({ url: req.body.url });
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
  await Storage.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(taskData.storage) },
    { $set: { [`transcode.${taskData.quality}`]: 'queue...' } }, // ตั้งค่าเป็น 'queue'
    { new: true } // Returns the updated document
  ).exec(); // เพิ่ม .exec() เพื่อให้แน่ใจว่าคำสั่งจะถูกดำเนินการ

  console.log('Process queue started for task:', taskId); // เพิ่ม log
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
    return res.json({ success: true, message: `Process for task ${taskId} stopped.` });
  } else {
    return res.status(404).json({ success: false, error: 'Task not found or already completed.' });
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
      supportedResolutions: ['420p', '720p', '1080p', '1920p']
    }
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Processing function
async function processQueue(taskId, taskData) {
  console.log('Processing queue for task:', taskId); // เพิ่ม log
  const outputFileName = `${taskId}-output.mp4`;
  const outputPath = path.join(__dirname, 'outputs', outputFileName);

  let videoSize;
  switch (taskData.quality) {
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
    await Storage.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(taskData.storage) },
      { $set: { [`transcode.${taskData.quality}`]: 'downloading...' } }, // ตั้งค่าเป็น 'downloading...'
      { new: true } // Returns the updated document
    ).exec(); // เพิ่ม .exec() เพื่อให้แน่ใจว่าคำสั่งจะถูกดำเนินการ

    const writer = fs.createWriteStream(inputPath);
    const response = await axios.get(taskData.url, { responseType: 'stream' });
    response.data.pipe(writer);
    await new Promise(resolve => writer.on('finish', resolve));
    console.log('Video downloaded to:', inputPath); // เพิ่ม log
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
      await Storage.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(taskData.storage) },
        { $set: { [`transcode.${taskData.quality}`]: percent } }, // อัปเดตเปอร์เซ็นต์
        { new: true } // Returns the updated document
      ).exec(); // เพิ่ม .exec() เพื่อให้แน่ใจว่าคำสั่งจะถูกดำเนินการ
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

        // อัปเดตข้อมูลในคอลเลกชัน storage โดยใช้เปอร์เซ็นต์
        await Storage.findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(taskData.storage) },
          { $set: { [`transcode.${taskData.quality}`]: remoteUrl, percent: 100 } }, // อัปเดต remoteUrl และเปอร์เซ็นต์
          { new: true } // Returns the updated document
        ).exec(); // เพิ่ม .exec() เพื่อให้แน่ใจว่าคำสั่งจะถูกดำเนินการ

        console.log("Storage updated with remote URL:", remoteUrl); // เพิ่ม log
      } catch (uploadError) {
        console.error('Error uploading to S3:', uploadError); // เพิ่ม log
      }

      fs.unlink(inputPath, () => {
        console.log('Input file deleted:', inputPath); // เพิ่ม log
      });
      processNextQueue(); // เรียกใช้ processNextQueue เพื่อประมวลผลงานถัดไป
    })
    .on('error', async (err) => {
      console.error('ffmpeg process error for task:', taskId, err); // เพิ่ม log
      delete ffmpegProcesses[taskId]; // ลบกระบวนการเมื่อเกิดข้อผิดพลาด
      await Task.updateOne({ taskId }, { status: 'error', error: err.message });
      fs.unlink(inputPath, () => {
        console.log('Input file deleted due to error:', inputPath); // เพิ่ม log
      });
      processNextQueue(); // เรียกใช้ processNextQueue เพื่อประมวลผลงานถัดไป
    })
    .save(outputPath);
}

// ฟังก์ชันคำนวณเปอร์เซ็นต์
function calculatePercent(taskData) {
  return taskData.percent || 0; // คืนค่าเปอร์เซ็นต์จากข้อมูลที่บันทึกไว้
}

// ฟังก์ชันใหม่สำหรับจัดการคิวถัดไป
async function processNextQueue() {
  if (isProcessing) return; // ถ้ากำลังประมวลผลอยู่ ให้หยุด
  const nextTask = await Task.findOneAndUpdate(
    { status: 'queued' },
    { $set: { status: 'processing' } },
    { new: true }
  );
  
  if (nextTask) {
    isProcessing = true; // ตั้งค่าสถานะการประมวลผล
    await processQueue(nextTask.taskId, nextTask); // เรียกใช้ processQueue สำหรับ task ถัดไป
    isProcessing = false; // รีเซ็ตสถานะการประมวลผล
    processNextQueue(); // เรียกใช้ processNextQueue เพื่อประมวลผลงานถัดไป
  }
}

