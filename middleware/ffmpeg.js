const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const MongoDB = require('./mongodb');

let ffmpegProcesses = {}; // Store active ffmpeg processes
let isProcessing = false;

const FFMPEG = {
  async processQueue(taskId, taskData) {
    const outputFileName = `${taskId}-output.mp4`;
    const outputPath = path.join(__dirname, 'outputs', outputFileName);
    let videoSize = {
      '420p': '640x360',
      '720p': '1280x720',
      '1080p': '1920x1080',
      '1920p': '1920x1080'
    }[taskData.quality] || '1280x720';
    
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
        FFMPEG.processNextQueue();
      })
      .on('error', async err => {
        delete ffmpegProcesses[taskId];
        await MongoDB.updateTask(taskId, { status: 'error', error: err.message });
        fs.unlink(inputPath, () => {});
        FFMPEG.processNextQueue();
      })
      .save(outputPath);
  },

  async processNextQueue() {
    if (isProcessing) return;
    const nextTask = await MongoDB.getNextQueuedTask();
    if (nextTask) {
      isProcessing = true;
      await FFMPEG.processQueue(nextTask.taskId, nextTask);
      isProcessing = false;
      FFMPEG.processNextQueue();
    }
  },

  async stopProcess(taskId) {
    if (ffmpegProcesses[taskId]) {
      ffmpegProcesses[taskId].kill('SIGINT');
      delete ffmpegProcesses[taskId];
      await MongoDB.updateTask(taskId, { status: 'stopped' });
      return { success: true, message: `Process for task ${taskId} stopped.` };
    }
    return { success: false, error: 'Task not found or already completed.' };
  }
};

module.exports = FFMPEG;
