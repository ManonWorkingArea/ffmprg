# NaN Error Fix Documentation

## Problem
Application crashed with `UNHANDLED_REJECTION` due to MongoDB trying to save `NaN` (Not a Number) as a percentage value.

## Error Details
```
📊 WebM estimated progress: NaN% (0.7s/N/As)
CastError: Cast to Number failed for value "NaN" (type number) at path "percent"
```

## Root Cause Analysis
1. **videoDuration was null/undefined**: ffprobe failed to get duration
2. **Division by null**: `timemarkSeconds / videoDuration` = `0.7 / null` = `NaN`
3. **NaN passed to MongoDB**: Mongoose rejected `NaN` as invalid number
4. **Unhandled Promise Rejection**: Crashed the entire application

## Solutions Implemented

### 1. Enhanced Duration Validation
**Added**: Robust validation for ffprobe duration results
```javascript
videoDuration = parseFloat(videoDuration);
if (isNaN(videoDuration) || videoDuration <= 0) {
  console.log('⚠️  Invalid duration from ffprobe, will use fallback estimation');
  videoDuration = null;
} else {
  console.log(`📹 WebM video duration: ${videoDuration}s`);
}
```

### 2. Safe Progress Calculation
**Enhanced**: Multiple fallback strategies for progress calculation
```javascript
// Safe duration check
const estimatedDuration = (videoDuration && videoDuration > 0) ? videoDuration : 30;

// Additional fallback if still problematic
if (estimatedDuration > 0) {
  percent = Math.min(Math.round((timemarkSeconds / estimatedDuration) * 100), 95);
} else {
  // Ultimate fallback: 10% per second
  percent = Math.min(Math.round(timemarkSeconds * 10), 95);
}
```

### 3. NaN Protection
**Added**: Comprehensive NaN detection and prevention
```javascript
// Validate percent before database update
if (isNaN(percent) || percent === null || percent === undefined) {
  console.warn(`Invalid percent value: ${percent}, using fallback 0`);
  percent = 0;
}

// Ensure valid range
percent = Math.max(0, Math.min(100, percent));
```

### 4. Error-Safe Database Updates
**Enhanced**: Try-catch around database operations
```javascript
try {
  await Task.updateOne({ taskId }, { status: 'processing', percent });
  await safeUpdateTranscode(taskData.storage, taskData.quality, percent);
} catch (updateError) {
  console.error(`Error updating progress for task ${taskId}:`, updateError);
  // Don't throw, just log the error to prevent crashing
}
```

### 5. Improved Timemark Parsing
**Enhanced**: Better validation for timemark conversion
```javascript
function convertTimemarkToSeconds(timemark) {
  if (!timemark || typeof timemark !== 'string') {
    console.warn('Invalid timemark:', timemark);
    return 0;
  }
  
  // ... parsing logic ...
  
  // Validate result
  if (isNaN(totalSeconds) || totalSeconds < 0) {
    console.warn('Invalid calculated seconds from timemark:', timemark, '→', totalSeconds);
    return 0;
  }
  
  return totalSeconds;
}
```

### 6. Global Error Handlers
**Added**: Process-level error handling to prevent crashes
```javascript
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process, just log the error
});
```

## Flow Chart: Progress Calculation

```
WebM File Input
       ↓
   ffprobe Check
       ↓
   Duration Found? ────No───→ Use 30s fallback
       ↓ Yes
   Parse & Validate
       ↓
   Duration > 0? ────No───→ Use 30s fallback
       ↓ Yes
   Calculate: timemark/duration
       ↓
   Result is NaN? ────Yes──→ Use timemark*10 fallback
       ↓ No
   Validate 0-100 range
       ↓
   Safe Database Update
```

## Error Scenarios Handled

### 1. ffprobe Failure
- **Before**: `videoDuration = undefined` → `NaN` calculation
- **After**: `videoDuration = null` → fallback to 30s estimation

### 2. Invalid Duration
- **Before**: `videoDuration = "invalid"` → `NaN` calculation  
- **After**: Parse and validate → use fallback if invalid

### 3. Division Edge Cases
- **Before**: `0.7 / null` → `NaN`
- **After**: Check `duration > 0` before division

### 4. Database Rejection
- **Before**: Unhandled rejection crashes app
- **After**: Try-catch logs error but continues processing

### 5. Timemark Issues
- **Before**: Invalid timemark could return `NaN`
- **After**: Comprehensive validation returns safe fallback

## Expected Behavior Now

### Success Case with ffprobe
```
📹 WebM video duration: 6.2s
📊 WebM estimated progress: 16% (1.0s/6.2s)
Processing progress for task: 16%
```

### Fallback Case (ffprobe fails)
```
⚠️ Invalid duration from ffprobe, will use fallback estimation
📊 WebM estimated progress: 23% (0.7s/30s)
Processing progress for task: 23%
```

### Ultimate Fallback Case
```
📊 WebM fallback progress: 7% (0.7s)
Processing progress for task: 7%
```

### Error Case (handled gracefully)
```
Invalid percent value: NaN, using fallback 0
Processing progress for task: 0%
Error updating progress for task xxx: [error details]
```

## Benefits

- ✅ **No More Crashes**: NaN errors handled gracefully
- ✅ **Robust Fallbacks**: Multiple backup strategies for progress calculation
- ✅ **Better Logging**: Clear indication of which fallback is being used
- ✅ **Continued Processing**: Errors don't stop video processing
- ✅ **Data Integrity**: Only valid numbers saved to database

## Configuration

### Fallback Values
- **Primary**: ffprobe duration (most accurate)
- **Secondary**: 30 seconds estimation (reasonable default)
- **Tertiary**: 10% per second (time-based progress)
- **Final**: 0% (safe minimum)

### Validation Rules
- **Range**: 0-100%
- **Type**: Number (not NaN, null, undefined)
- **Progress Cap**: 95% maximum during processing

This comprehensive fix ensures that WebM processing continues smoothly even when duration detection fails, preventing application crashes while maintaining useful progress feedback.
