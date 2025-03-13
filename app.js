const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');
const { createClient } = require('redis');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const fs = require('fs'); 
const redis = require('redis');

const app = express();
const port = process.env.PORT || 6000;

app.use(cors());

app.use(express.json());
app.use(express.static('outputs'));

const upload = multer({ dest: 'uploads/' });

// Redis Client Setup
const redisClient = redis.createClient({
  url: 'redis://default:e3PHPsEo92tMA5mNmWmgV8O6cn4tlblB@redis-19867.fcrce171.ap-south-1-1.ec2.redns.redis-cloud.com:19867',
  socket: {
    tls: true,
    connectTimeout: 10000,
    keepAlive: 5000,
    reconnectStrategy: (retries) => {
      const delay = Math.min(50 * 2 ** retries + Math.random() * 100, 3000);
      console.warn(`Reconnecting to Redis... Attempt ${retries}, retrying in ${delay}ms`);
      return delay;
    }
  }
});

// Event Listeners
redisClient.on('connect', () => console.log('RED :: Connected.'));
redisClient.on('ready', () => console.log('RED :: Ready.'));
redisClient.on('error', (err) => {
  console.error('RED :: Error:', err);
  // เพิ่มการจัดการข้อผิดพลาดเพิ่มเติมที่นี่
});
redisClient.on('end', () => console.warn('RED :: Closed.'));
redisClient.on('reconnecting', () => console.warn('RED :: Reconnecting...'));

// Connect to Redis
(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
  }
})();

// Endpoint: Add conversion task to queue
app.post('/convert', upload.single('video'), async (req, res) => {
  const taskId = uuidv4();
  const quality = req.body.quality || '720p';

  const taskData = {
    status: 'queued',
    quality,
    createdAt: Date.now(),
    outputFile: null
  };

  if (req.file) {
    taskData.inputPath = req.file.path;
  } else if (req.body.url) {
    taskData.url = req.body.url;
  } else {
    return res.status(400).json({ success: false, error: 'Video file or URL required' });
  }

  await redisClient.set(taskId, JSON.stringify(taskData));

  processQueue(taskId, taskData);

  res.json({ success: true, taskId });
});

// Endpoint: Check status and get result
app.get('/status/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  const task = await redisClient.get(taskId);

  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  const taskData = JSON.parse(task);
  const response = {
    success: true,
    task: taskData,
    percent: taskData.status === 'processing' ? calculatePercent(taskData) : 100 // คำนวณเปอร์เซ็นต์ถ้ากำลังประมวลผล
  };

  res.json(response);
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

  await redisClient.set(taskId, JSON.stringify({ ...taskData, status: 'processing' }));

  ffmpeg(inputPath)
    .size(videoSize)
    .videoCodec('libx264')
    .outputOptions(['-preset', 'fast', '-crf', '22'])
    .on('progress', (progress) => {
      const percent = Math.round(progress.percent);
      redisClient.set(taskId, JSON.stringify({
        ...taskData,
        status: 'processing',
        percent // บันทึกเปอร์เซ็นต์ใน Redis
      }));
    })
    .on('end', async () => {
      await redisClient.set(taskId, JSON.stringify({
        ...taskData,
        status: 'completed',
        outputFile: `/${outputFileName}`
      }));
      // Clean up uploaded/input file
      fs.unlink(inputPath, () => {});
    })
    .on('error', async (err) => {
      await redisClient.set(taskId, JSON.stringify({
        ...taskData,
        status: 'error',
        error: err.message
      }));
      fs.unlink(inputPath, () => {});
    })
    .save(outputPath);
}

// ฟังก์ชันคำนวณเปอร์เซ็นต์
function calculatePercent(taskData) {
  return taskData.percent || 0; // คืนค่าเปอร์เซ็นต์จากข้อมูลที่บันทึกไว้
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
