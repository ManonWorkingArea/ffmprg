const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const MongoDB = require('./middleware/mongodb'); // Import MongoDB middleware
const FFMPEG = require('./middleware/ffmpeg'); // Import FFmpeg middleware

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('outputs'));

const upload = multer({ dest: 'uploads/' });

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
  FFMPEG.processQueue(taskId, taskData);

  res.json({ success: true, taskId, downloadLink: `${baseUrl}/outputs/${taskId}-output.mp4` });
});

// Endpoint: Check status and get result
app.get('/status/:taskId', async (req, res) => {
  const task = await MongoDB.getTaskById(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  res.json({
    success: true,
    task,
    percent: task.status === 'processing' ? task.percent || 0 : 100,
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
  FFMPEG.processQueue(task.taskId, task);
  res.json({ success: true, message: `Task ${task.taskId} started.` });
});

// Endpoint: Stop ffmpeg process
app.post('/stop/:taskId', async (req, res) => {
  const result = await FFMPEG.stopProcess(req.params.taskId);
  res.json(result);
});

app.use('/outputs', express.static(path.join(__dirname, 'outputs')));
app.listen(port, () => console.log(`Server running on port ${port}`));