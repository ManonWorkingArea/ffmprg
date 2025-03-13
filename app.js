const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const fs = require('fs');
const MongoDB = require('./middleware/mongodb'); // Import middleware

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('outputs'));

const upload = multer({ dest: 'uploads/' });

let ffmpegProcesses = {}; // Store active ffmpeg processes
let isProcessing = false;
const baseUrl = `http://159.65.131.165:${port}`;

// Endpoint: Add conversion task to queue
app.post('/convert', upload.single('video'), async (req, res) => {
  const quality = req.body.quality || '720p';
  let taskId;

  if (req.file) {
    const existingTask = await MongoDB.getTaskByInputPath(req.file.path);
    if (existingTask) return res.json({ success: true, taskId: existingTask.taskId });
    taskId = uuidv4();
  } else if (req.body.url) {
    const existingTask = await MongoDB.getTaskByUrl(req.body.url);
    if (existingTask) return res.json({ success: true, taskId: existingTask.taskId });
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

  await MongoDB.createTask(taskData);
  processQueue(taskId, taskData);

  res.json({ success: true, taskId, downloadLink: `${baseUrl}/outputs/${taskId}-output.mp4` });
});

// Endpoint: Check status and get result
app.get('/status/:taskId', async (req, res) => {
  const task = await MongoDB.getTaskById(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  res.json({
    success: true,
    task,
    percent: task.status === 'processing' ? calculatePercent(task) : 100,
    downloadLink: task.status === 'completed' ? `${baseUrl}/outputs/${task.taskId}-output.mp4` : null
  });
});

// Endpoint: Get all tasks
app.get('/tasks', async (req, res) => {
  const tasks = await MongoDB.getAllTasks();
  res.json({ success: true, tasks });
});

// Endpoint: Start task manually
app.post('/start/:taskId', async (req, res) => {
  const task = await MongoDB.getTaskById(req.params.taskId);
  if (!task || (task.status !== 'queued' && task.status !== 'error')) {
    return res.status(400).json({ success: false, error: 'Task not in a valid state' });
  }
  processQueue(task.taskId, task);
  res.json({ success: true, message: `Task ${task.taskId} started.` });
});

// Endpoint: Stop ffmpeg process
app.post('/stop/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  if (ffmpegProcesses[taskId]) {
    ffmpegProcesses[taskId].kill('SIGINT');
    delete ffmpegProcesses[taskId];
    await MongoDB.updateTask(taskId, { status: 'stopped' });
    return res.json({ success: true, message: `Process for task ${taskId} stopped.` });
  }
  res.status(404).json({ success: false, error: 'Task not found or already completed.' });
});

app.use('/outputs', express.static(path.join(__dirname, 'outputs')));
app.listen(port, () => console.log(`Server running on port ${port}`));

// Processing function
async function processQueue(taskId, taskData) {
  const outputFileName = `${taskId}-output.mp4`;
  const outputPath = path.join(__dirname, 'outputs', outputFileName);
  let videoSize = { '420p': '640x360', '720p': '1280x720', '1080p': '1920x1080', '1920p': '1920x1080' }[taskData.quality] || '1280x720';
  const inputPath = taskData.inputPath || path.join('uploads', `${taskId}-input.mp4`);

  if (taskData.url) {
    const writer = fs.createWriteStream(inputPath);
    const response = await axios.get(taskData.url, { responseType: 'stream' });
    response.data.pipe(writer);
    await new Promise(resolve => writer.on('finish', resolve));
  }

  await MongoDB.updateTask(taskId, { status: 'processing' });
  ffmpegProcesses[taskId] = ffmpeg(inputPath)
    .size(videoSize)
    .videoCodec('libx264')
    .outputOptions(['-preset', 'fast', '-crf', '22'])
    .on('progress', async progress => {
      await MongoDB.updateTask(taskId, { status: 'processing', percent: Math.round(progress.percent) });
    })
    .on('end', async () => {
      delete ffmpegProcesses[taskId];
      await MongoDB.updateTask(taskId, { status: 'completed', outputFile: `/${outputFileName}` });
      fs.unlink(inputPath, () => {});
      processNextQueue();
    })
    .on('error', async err => {
      delete ffmpegProcesses[taskId];
      await MongoDB.updateTask(taskId, { status: 'error', error: err.message });
      fs.unlink(inputPath, () => {});
      processNextQueue();
    })
    .save(outputPath);
}

function calculatePercent(taskData) {
  return taskData.percent || 0;
}

async function processNextQueue() {
  if (isProcessing) return;
  const nextTask = await MongoDB.getNextQueuedTask();
  if (nextTask) {
    isProcessing = true;
    await processQueue(nextTask.taskId, nextTask);
    isProcessing = false;
    processNextQueue();
  }
}


setInterval(async () => {
  const nextTask = await MongoDB.getNextQueuedTask();
  if (nextTask) {
    processQueue(nextTask.taskId, nextTask);
  }
}, 5000); // ตรวจสอบทุก 5 วินาที
