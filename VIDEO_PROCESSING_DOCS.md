# Video Processing Documentation

## Overview
The Media Recording API now supports automatic video processing using FFmpeg. When a recording session is finalized, the system automatically merges WebM chunks into a single MP4 file and cleans up temporary chunk files.

## New Features in Finalize Endpoint

### Enhanced POST /api/media/recording/finalize

When you call the finalize endpoint, the following additional processing now occurs:

#### 1. Video Chunk Merging
- **Technology**: FFmpeg with concat demuxer
- **Input**: Individual WebM chunk files
- **Output**: Single MP4 file (`{sessionId}_final.mp4`)
- **Process**: 
  - Creates a file list for FFmpeg concat
  - Uses `-c copy` for fast stream copying (no re-encoding)
  - Handles timestamp issues with `-avoid_negative_ts make_zero`
  - Generates presentation timestamps with `-fflags +genpts`

#### 2. Automatic Cleanup
- **Chunk Deletion**: All WebM chunk files are deleted after successful merge
- **Directory Cleanup**: Empty chunk directories are removed
- **Space Recovery**: Reports how much storage space was freed

#### 3. Enhanced Response Format

The finalize endpoint now returns additional information:

```json
{
  "success": true,
  "sessionId": "session_123",
  "status": "completed",
  "finalVideoUrl": "/api/media/recording/session/session_123/video",
  "totalChunks": 10,
  "totalSizeMB": 125.5,
  "finalizedAt": "2025-09-26T10:30:00.000Z",
  "processingTime": "2m 30s",
  "videoProcessing": {
    "merged": true,
    "mergedAt": "2025-09-26T10:30:15.000Z",
    "finalVideoPath": "/uploads/sessions/session_123/session_123_final.mp4",
    "finalVideoSizeMB": 95.2,
    "mergeDurationSeconds": 8.5,
    "chunksProcessed": 10,
    "cleanup": {
      "deletedFiles": 10,
      "spacesFreedMB": 30.3
    }
  },
  "note": "Video merged successfully: 10 chunks → 95.2MB MP4, 10 chunk files cleaned up"
}
```

### Error Handling

If video processing fails, the response includes error information:

```json
{
  "videoProcessing": {
    "merged": false,
    "error": "FFmpeg processing failed: Invalid input format",
    "errorAt": "2025-09-26T10:30:00.000Z"
  },
  "note": "Session finalized successfully (Video processing failed: Invalid input format)"
}
```

## New Video Download Endpoint

### GET /api/media/recording/session/{sessionId}/video

Downloads the final merged MP4 video file.

#### Response Headers
- `Content-Type: video/mp4`
- `Content-Length: {file_size}`
- `Content-Disposition: attachment; filename="{sessionId}_final.mp4"`
- `Accept-Ranges: bytes`

#### Error Responses

**Session Not Found (404)**
```json
{
  "success": false,
  "error": "Session not found",
  "sessionId": "session_123"
}
```

**Video Not Available (404)**
```json
{
  "success": false,
  "error": "Final video not available. Video processing may have failed or not been completed.",
  "sessionId": "session_123",
  "videoProcessing": {
    "merged": false,
    "error": "Processing failed"
  }
}
```

**File Not Found (404)**
```json
{
  "success": false,
  "error": "Video file not found on disk",
  "sessionId": "session_123",
  "expectedPath": "/uploads/sessions/session_123/session_123_final.mp4"
}
```

## Session Metadata Updates

The session JSON file now includes video processing information:

```json
{
  "sessionId": "session_123",
  "status": "completed",
  "finalizedAt": "2025-09-26T10:30:00.000Z",
  "videoProcessing": {
    "merged": true,
    "mergedAt": "2025-09-26T10:30:15.000Z",
    "finalVideoPath": "/uploads/sessions/session_123/session_123_final.mp4",
    "finalVideoSizeMB": 95.2,
    "mergeDurationSeconds": 8.5,
    "chunksProcessed": 10,
    "cleanup": {
      "deletedFiles": 10,
      "spacesFreedMB": 30.3
    }
  }
}
```

## Implementation Details

### FFmpeg Command Structure

The system generates commands similar to:
```bash
ffmpeg -f concat -safe 0 -i filelist.txt -c copy -avoid_negative_ts make_zero -fflags +genpts output.mp4
```

### File List Format (filelist.txt)
```
file 'chunks/chunk_0.webm'
file 'chunks/chunk_1.webm'
file 'chunks/chunk_2.webm'
```

### Processing Flow
1. **Validation**: Check session exists and has chunks
2. **File Discovery**: Locate all chunk files and sort by index
3. **List Creation**: Generate FFmpeg concat file list
4. **FFmpeg Execution**: Run merge command with progress monitoring
5. **Verification**: Check output file was created successfully
6. **Cleanup**: Delete original chunk files and temporary files
7. **Metadata Update**: Save processing results to session JSON

### Performance Considerations
- **Stream Copy**: Uses `-c copy` to avoid re-encoding for faster processing
- **Memory Efficient**: Streams data without loading entire files into memory
- **Progressive Cleanup**: Deletes chunks immediately after successful merge
- **Error Recovery**: Preserves original chunks if merge fails

### Storage Benefits
- **Space Savings**: Typically 20-30% reduction in storage usage
- **File Organization**: Single MP4 file instead of multiple chunks
- **Download Efficiency**: Single file download vs multiple chunk requests

## Testing

Use the provided test script to verify video processing functionality:

```bash
node test-video-processing.js
```

The test script simulates:
1. Session initialization
2. Multiple chunk uploads (3 x 2MB test chunks)
3. Session finalization with video processing
4. Video download endpoint testing
5. Final session status verification

## Error Recovery

If video processing fails:
1. Original chunk files are preserved
2. Session status remains "completed"
3. Error details are logged and stored in session metadata
4. Client can still access individual chunks via chunk endpoints
5. Manual processing can be attempted later

## Configuration

### FFmpeg Requirements
- FFmpeg must be installed and accessible in system PATH
- Supports WebM input format
- MP4 output encoding capability

### Directory Structure
```
uploads/
├── media-recording/
    ├── sessions/
        ├── session_123/
            ├── session.json          (metadata)
            ├── session_123_final.mp4 (final video)
            └── chunks/               (deleted after processing)
                ├── chunk_0.webm      (temporary)
                ├── chunk_1.webm      (temporary)
                └── filelist.txt      (temporary)
```

## Monitoring and Logs

### Log Messages
- `🎬 Starting video merge for session: {sessionId}`
- `✅ Video merge completed in {duration}s`
- `🧹 Starting cleanup for session: {sessionId}`
- `🗑️ Deleted chunk: {filename} ({size}MB)`
- `✅ Cleanup completed: {count} files deleted, {size}MB freed`

### Progress Tracking
FFmpeg progress is monitored and logged with percentage completion updates.

### Error Logging
All video processing errors are logged with full context for debugging.