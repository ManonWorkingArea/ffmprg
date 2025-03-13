const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('outputs'));

// Configure Multer for file upload
const upload = multer({ dest: 'uploads/' });

app.post('/convert', upload.single('video'), (req, res) => {
  const inputPath = req.file.path;
  const outputFileName = `${Date.now()}-output.mp4`;
  const outputPath = path.join(__dirname, 'outputs', outputFileName);

  ffmpeg(inputPath)
    .outputOptions('-c:v libx264', '-preset fast', '-crf 22')  // optimized compression
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
