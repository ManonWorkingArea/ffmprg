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

const app = express();
const port = process.env.PORT || 6000;

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

// Endpoint: Add conversion task to queue
app.post('/convert', upload.single('video'), async (req, res) => {
  const quality = req.body.quality || '720p';
  let taskId;

  if (req.file) {
    // ตรวจสอบว่ามีงานที่มี inputPath เดียวกันอยู่ใน MongoDB หรือไม่
    const existingTask = await Task.findOne({ inputPath: req.file.path });
    if (existingTask) {
      return res.json({ success: true, taskId: existingTask.taskId }); // คืนค่า taskId ของงานที่มีอยู่
    }
    taskId = uuidv4();
  } else if (req.body.url) {
    // ตรวจสอบว่ามีงานที่มี url เดียวกันอยู่ใน MongoDB หรือไม่
    const existingTask = await Task.findOne({ url: req.body.url });
    if (existingTask) {
      return res.json({ success: true, taskId: existingTask.taskId }); // คืนค่า taskId ของงานที่มีอยู่
    }
    taskId = uuidv4();
  } else {
    return res.status(400).json({ success: false, error: 'Video file or URL required' });
  }

  const taskData = {
    taskId,
    status: 'queued',
    quality,
    createdAt: Date.now(),
    outputFile: null,
    inputPath: req.file ? req.file.path : undefined,
    url: req.body.url
  };

  await Task.create(taskData); // บันทึกข้อมูลใน MongoDB

  processQueue(taskId, taskData);

  res.json({ success: true, taskId });
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
    percent: task.status === 'processing' ? calculatePercent(task) : 100 // คำนวณเปอร์เซ็นต์ถ้ากำลังประมวลผล
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

  ffmpeg(inputPath)
    .size(videoSize)
    .videoCodec('libx264')
    .outputOptions(['-preset', 'fast', '-crf', '22'])
    .on('progress', async (progress) => {
      const percent = Math.round(progress.percent);
      await Task.updateOne({ taskId }, { status: 'processing', percent }); // บันทึกเปอร์เซ็นต์ใน MongoDB
    })
    .on('end', async () => {
      await Task.updateOne({ taskId }, { status: 'completed', outputFile: `/${outputFileName}` }); // อัปเดตสถานะใน MongoDB
      // Clean up uploaded/input file
      fs.unlink(inputPath, () => {});

      // เรียกใช้คิวถัดไป
      processNextQueue();
    })
    .on('error', async (err) => {
      await Task.updateOne({ taskId }, { status: 'error', error: err.message }); // อัปเดตสถานะใน MongoDB
      fs.unlink(inputPath, () => {});
    })
    .save(outputPath);
}

// ฟังก์ชันคำนวณเปอร์เซ็นต์
function calculatePercent(taskData) {
  return taskData.percent || 0; // คืนค่าเปอร์เซ็นต์จากข้อมูลที่บันทึกไว้
}

// ฟังก์ชันใหม่สำหรับจัดการคิวถัดไป
async function processNextQueue() {
  const nextTask = await Task.findOneAndDelete({ status: 'queued' }); // ดึง task ถัดไปจาก MongoDB
  if (nextTask) {
    processQueue(nextTask.taskId, nextTask); // เรียกใช้ processQueue สำหรับ task ถัดไป
  }
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
