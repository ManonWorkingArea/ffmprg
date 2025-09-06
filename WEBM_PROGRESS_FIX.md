# WebM Progress Fix Documentation

## Problem Update
WebM files were processing correctly (frames increasing, FPS stable ~105) but showing 0% progress because FFmpeg couldn't determine video duration for percentage calculation.

## Root Cause Analysis
From the logs, we can see:
- **FFmpeg is working**: `timemark=00:00:04.81, frames=4821, fps=105`
- **Progress stuck at 0%**: `Processing progress for task: 0%`
- **File is small**: 4.35 MB WebM file
- **Processing is active**: Continuous frame progression

The issue is that FFmpeg's progress.percent remains 0 when it cannot determine the total video duration from WebM metadata.

## Enhanced Solutions Implemented

### 1. FFprobe Integration
**Added**: Pre-analysis of WebM files to determine actual duration
```javascript
const ffprobeResult = await new Promise((resolve, reject) => {
  ffmpeg.ffprobe(inputPath, (err, metadata) => {
    if (err) reject(err);
    else resolve(metadata);
  });
});

videoDuration = ffprobeResult.format?.duration;
console.log(`📹 WebM video duration: ${videoDuration}s`);
```

### 2. Smart Progress Calculation
**Enhanced**: Progress calculation using actual duration or fallback estimation
```javascript
if (percent === 0 && progress.timemark) {
  const timemarkSeconds = convertTimemarkToSeconds(progress.timemark);
  if (timemarkSeconds > 0) {
    // Use real duration from ffprobe or estimate
    const estimatedDuration = videoDuration || 30;
    percent = Math.min(Math.round((timemarkSeconds / estimatedDuration) * 100), 95);
    console.log(`📊 WebM estimated progress: ${percent}% (${timemarkSeconds.toFixed(1)}s/${estimatedDuration}s)`);
  }
}
```

### 3. Timemark Parser
**Added**: Function to convert FFmpeg timemark (HH:MM:SS.ss) to seconds
```javascript
function convertTimemarkToSeconds(timemark) {
  const parts = timemark.split(':');
  const hours = parseInt(parts[0]) || 0;
  const minutes = parseInt(parts[1]) || 0;
  const seconds = parseFloat(parts[2]) || 0;
  return hours * 3600 + minutes * 60 + seconds;
}
```

## Expected Behavior Now

### Before Fix (Stuck at 0%)
```
WebM progress details: timemark=00:00:04.81, frames=4821, fps=105
Processing progress for task: 0%
WebM progress details: timemark=00:00:04.87, frames=4881, fps=105
Processing progress for task: 0%
```

### After Fix (Progressive Updates)
```
📹 WebM video duration: 6.2s
WebM progress details: timemark=00:00:01.00, frames=1000, fps=105
📊 WebM estimated progress: 16% (1.0s/6.2s)
Processing progress for task: 16%

WebM progress details: timemark=00:00:03.00, frames=3000, fps=105
📊 WebM estimated progress: 48% (3.0s/6.2s)
Processing progress for task: 48%

WebM progress details: timemark=00:00:06.00, frames=6000, fps=105
📊 WebM estimated progress: 95% (6.0s/6.2s)
Processing progress for task: 95%
```

## How It Works

1. **Duration Detection**: Uses ffprobe to get exact WebM duration
2. **Fallback Estimation**: If ffprobe fails, estimates 30 seconds
3. **Real-time Calculation**: Converts timemark to seconds and calculates percentage
4. **Progress Updates**: Shows actual progress based on processing time vs total duration
5. **Cap at 95%**: Prevents showing 100% before actual completion

## Benefits

- ✅ **Accurate Progress**: Shows real processing progress for WebM files
- ✅ **User Experience**: Users see progress instead of stuck 0%
- ✅ **Better Monitoring**: System can track actual processing status
- ✅ **Robust Fallback**: Works even if duration detection fails
- ✅ **Minimal Overhead**: ffprobe runs once at start

## Configuration

### Duration Sources (Priority Order)
1. **ffprobe result**: Most accurate, from video metadata
2. **Fallback estimate**: 30 seconds if ffprobe fails
3. **Progress cap**: Maximum 95% until completion

### Progress Update Logic
- **WebM files**: Use timemark-based calculation
- **Other formats**: Use standard FFmpeg progress.percent
- **Update frequency**: Every progress event from FFmpeg

## Error Handling

- **ffprobe failures**: Graceful fallback to estimation
- **Invalid timemark**: Safe parsing with error handling
- **Missing metadata**: Uses reasonable defaults

This fix ensures WebM files show proper progress indication while maintaining compatibility with all other video formats.
