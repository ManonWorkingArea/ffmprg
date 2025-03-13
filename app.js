const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 6000;

app.use(cors());
app.use(express.static('outputs'));

// Configure Multer for file upload
const upload = multer({ dest: 'uploads/' });

app.post('/convert', upload.single('video'), (req, res) => {
  const inputPath = req.file ? req.file.path : req.body.url;
  const quality = req.body.quality || '720p';
  const outputFileName = `${Date.now()}-output.mp4`;
  const outputPath = path.join(__dirname, 'outputs', outputFileName);

  let videoSize;
  switch (quality) {
    case '420p':
      videoSize = '640x360';
      break;
    case '720p':
      videoSize = '1280x720';
      break;
    case '1080p':
      videoSize = '1920x1080';
      break;
    case '1920p':
      videoSize = '1920x1080';
      break;
    default:
      videoSize = '1280x720';
  }

  ffmpeg(inputPath)
    .outputOptions('-c:v libx264', '-preset fast', '-crf 22', `-s ${videoSize}`)
    .on('end', () => {
      res.json({ success: true, url: `/${outputFileName}` });
    })
    .on('error', (err) => {
      res.status(500).json({ success: false, error: err.message });
    })
    .save(outputPath);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
