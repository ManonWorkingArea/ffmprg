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

const { getHostnameData,getSpaceData } = require('./middleware/hostname'); // Import the function

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
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
  url: String
});

const Task = mongoose.model('Queue', taskSchema);

let ffmpegProcesses = {}; // เก็บข้อมูลเกี่ยวกับกระบวนการ ffmpeg
let isProcessing = false; // ตัวแปรเพื่อบอกสถานะการประมวลผล

const baseUrl = `http://159.65.131.165:${port}`; // อัปเดต base URL

// Grouped Endpoints

// Endpoint: Add conversion task to queue
app.post('/convert', upload.single('video'), async (req, res) => {
  const quality = req.body.quality || '720p';
  const site = req.body.site; // Get the site from the request body
  let taskId;

  // Validate if site is provided
  if (!site) {
    return res.status(400).json({ success: false, error: 'Site is required' });
  }

  // Fetch hostname data
  let hostnameData;
  let spaceData;
  try {
    hostnameData = await getHostnameData(site);
    if (!hostnameData) {
      return res.status(404).json({ success: false, error: 'Hostname not found' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to fetch hostname data' });
  }

  console.log(hostnameData);

  try {
    spaceData = await getSpaceData(hostnameData.spaceId);
    if (!spaceData) {
      return res.status(404).json({ success: false, error: 'Hostname not found' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to fetch hostname data' });
  }

  console.log(spaceData);

  if (req.file) {
    // Check if an existing task has the same inputPath
    const existingTask = await Task.findOne({ inputPath: req.file.path });
    if (existingTask) {
      return res.json({ success: true, taskId: existingTask.taskId });
    }
    taskId = uuidv4();
  } else if (req.body.url) {
    // Check if an existing task has the same URL
    const existingTask = await Task.findOne({ url: req.body.url });
    if (existingTask) {
      return res.json({ success: true, taskId: existingTask.taskId });
    }
    taskId = uuidv4();
  } else {
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
  };

  await Task.create(taskData); // Save to MongoDB

  processQueue(taskId, taskData);

  res.json({ 
    success: true, 
    taskId, 
    downloadLink: `${baseUrl}/outputs/${taskId}-output.mp4`,
    site: hostnameData.hostname,
    spaceId: hostnameData.spaceId 
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Processing function
async function processQueue(taskId, taskData) {
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
    const writer = fs.createWriteStream(inputPath);
    const response = await axios.get(taskData.url, { responseType: 'stream' });
    response.data.pipe(writer);
    await new Promise(resolve => writer.on('finish', resolve));
  }

  await Task.updateOne({ taskId }, { status: 'processing' }); // อัปเดตสถานะใน MongoDB

  // เริ่มกระบวนการ ffmpeg
  ffmpegProcesses[taskId] = ffmpeg(inputPath)
    .size(videoSize)
    .videoCodec('libx264')
    .outputOptions(['-preset', 'veryfast', '-crf', '22'])
    .on('progress', async (progress) => {
      const percent = Math.round(progress.percent);
      await Task.updateOne({ taskId }, { status: 'processing', percent });
    })
    .on('end', async () => {
      delete ffmpegProcesses[taskId]; // ลบกระบวนการเมื่อเสร็จสิ้น
      await Task.updateOne({ taskId }, { status: 'completed', outputFile: `/${outputFileName}` });
      fs.unlink(inputPath, () => {});
      processNextQueue(); // เรียกใช้ processNextQueue เพื่อประมวลผลงานถัดไป
    })
    .on('error', async (err) => {
      delete ffmpegProcesses[taskId]; // ลบกระบวนการเมื่อเกิดข้อผิดพลาด
      await Task.updateOne({ taskId }, { status: 'error', error: err.message });
      fs.unlink(inputPath, () => {});
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
  const nextTask = await Task.findOneAndDelete({ status: 'queued' }); // ดึง task ถัดไปจาก MongoDB
  if (nextTask) {
    isProcessing = true; // ตั้งค่าสถานะการประมวลผล
    await processQueue(nextTask.taskId, nextTask); // เรียกใช้ processQueue สำหรับ task ถัดไป
    isProcessing = false; // รีเซ็ตสถานะการประมวลผล
    processNextQueue(); // เรียกใช้ processNextQueue เพื่อประมวลผลงานถัดไป
  }
}