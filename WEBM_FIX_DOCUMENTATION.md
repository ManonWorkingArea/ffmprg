# WebM Processing Fix Documentation

## Problem
WebM files were getting stuck at 0% progress during FFmpeg conversion, causing tasks to hang indefinitely.

## Root Causes Identified
1. **Missing Audio Codec**: FFmpeg command didn't specify audio codec for WebM input
2. **Timing Issues**: WebM files can have timing/timestamp problems
3. **No Progress Monitoring**: System couldn't detect when WebM processing was stuck
4. **Insufficient Timeout**: Standard timeout not adequate for WebM complexity

## Solutions Implemented

### 1. Audio Codec Specification
**Added**: `.audioCodec('aac')` to FFmpeg command
```javascript
const ffmpegProcess = ffmpeg(inputPath)
  .size(videoSize)
  .videoCodec('libx264')
  .audioCodec('aac')  // 🆕 Added explicit audio codec
```

### 2. WebM Compatibility Options
**Added**: FFmpeg options to handle WebM timing issues
```javascript
.outputOptions([
  '-avoid_negative_ts', 'make_zero', // Fix timing issues with webm
  '-fflags', '+genpts'              // Generate presentation timestamps
])
```

### 3. Enhanced Input File Detection
**Added**: Detection and logging for WebM files
```javascript
const inputExt = path.extname(inputPath).toLowerCase();
console.log(`Input file extension: ${inputExt}`);
if (inputExt === '.webm') {
  console.log('⚠️  WebM input detected - adding compatibility options');
}
```

### 4. Extended Timeout for WebM
**Added**: Longer timeout for WebM files (50% more time)
```javascript
const timeoutDuration = inputExt === '.webm' ? FFMPEG_TIMEOUT * 1.5 : FFMPEG_TIMEOUT;
```

### 5. Progress Stuck Detection
**Added**: Monitoring system to detect when WebM processing gets stuck
```javascript
// Check every 2 minutes if progress is stuck
const progressCheckInterval = setInterval(async () => {
  // If progress stuck for 6+ minutes, kill process
  if (progressStuckCount >= 3) {
    console.log(`❌ Killing stuck WebM process for task: ${taskId}`);
    ffmpegProcesses[taskId].kill('SIGKILL');
  }
}, 120000);
```

### 6. Enhanced Progress Logging
**Added**: Detailed progress information for WebM debugging
```javascript
if (path.extname(inputPath).toLowerCase() === '.webm') {
  console.log(`WebM progress details: timemark=${progress.timemark}, frames=${progress.frames}, fps=${progress.currentFps}`);
}
```

## How It Works Now

### For Regular Files (MP4, AVI, etc.)
1. Standard FFmpeg processing
2. Normal timeout duration
3. Basic progress monitoring

### For WebM Files
1. **Detection**: System identifies WebM input
2. **Enhanced Command**: Adds WebM-specific FFmpeg options
3. **Extended Timeout**: 1.5x normal timeout duration
4. **Progress Monitoring**: Checks every 2 minutes for stuck progress
5. **Auto-Recovery**: Kills stuck processes after 6 minutes of no progress
6. **Detailed Logging**: Extra debug information for troubleshooting

## Expected Behavior

### Before Fix
```
Processing progress for task: 0%
Processing progress for task: 0%
Processing progress for task: 0%
... (infinite loop)
```

### After Fix
```
⚠️  WebM input detected - adding compatibility options
Input file size: 15.23 MB
Setting FFmpeg timeout: 45s for .webm file
WebM progress details: timemark=00:00:02.00, frames=60, fps=30
Processing progress for task: 15%
Processing progress for task: 45%
Processing progress for task: 78%
Processing progress for task: 100%
✅ ffmpeg process completed
```

## Error Scenarios Handled

1. **Stuck Progress**: Auto-detection and termination after 6 minutes
2. **Timeout**: Extended timeout for complex WebM files
3. **Audio Issues**: Explicit AAC audio codec specification
4. **Timing Problems**: FFmpeg options to fix timestamp issues

## Configuration

### Timeout Settings
- **Regular files**: `FFMPEG_TIMEOUT` (default: 30 seconds)
- **WebM files**: `FFMPEG_TIMEOUT * 1.5` (45 seconds)

### Progress Check
- **Interval**: Every 2 minutes
- **Stuck Threshold**: 3 consecutive checks (6 minutes total)
- **Action**: SIGKILL process and mark as error

## Monitoring

The system now logs:
- Input file format detection
- WebM-specific processing indicators
- Progress stuck warnings
- Timeout adjustments
- Detailed FFmpeg progress for WebM files

## Future Considerations

1. **Format-Specific Presets**: Different FFmpeg presets for different input formats
2. **Adaptive Timeouts**: Dynamic timeout based on file size
3. **Quality Fallback**: Automatic quality reduction for problematic files
4. **Format Conversion**: Pre-convert WebM to MP4 for better compatibility
