const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');
const { createClient } = require('redis');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const fs = require('fs'); 

const app = express();
const port = process.env.PORT || 6000;

app.use(cors());

app.use(express.json());
app.use(express.static('outputs'));

const upload = multer({ dest: 'uploads/' });

// Connect to Redis Cloud
const redisClient = createClient({
  url: 'redis://default:e3PHPsEo92tMA5mNmWmgV8O6cn4tlblB@redis-19867.fcrce171.ap-south-1-1.ec2.redns.redis-cloud.com:19867'
});

let isConnected = false;

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
  // Attempt to reconnect if the socket is closed unexpectedly
  if (err.message.includes('Socket closed unexpectedly')) {
    reconnect();
  }
});

async function reconnect() {
  if (isConnected) return; // Prevent multiple reconnect attempts
  isConnected = true;

  try {
    await redisClient.connect();
    console.log('Redis reconnected');
    isConnected = true; // Update connection status
  } catch (error) {
    console.error('Failed to reconnect to Redis:', error);
    setTimeout(() => {
      isConnected = false; // Reset connection status before retrying
      reconnect();
    }, 5000); // Retry after 5 seconds
  }
}

(async () => {
  try {
    await redisClient.connect();
    isConnected = true; // Set connection status to true
    console.log('Redis connected');
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
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

  res.json({ success: true, task: JSON.parse(task) });
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
