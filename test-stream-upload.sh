#!/bin/bash

# Cloudflare Stream Upload Example
# Usage: ./test-stream-upload.sh

BASE_URL="http://localhost:3000"
VIDEO_URL="https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4"
SITE="example.com"

echo "🚀 Testing Cloudflare Stream Upload..."
echo "Video URL: $VIDEO_URL"
echo "Site: $SITE"
echo ""

# Upload video to Cloudflare Stream
echo "📤 Uploading video to Cloudflare Stream..."
RESPONSE=$(curl -s -X POST "$BASE_URL/stream-upload" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"$VIDEO_URL\",
    \"title\": \"Test Video Upload\",
    \"description\": \"Testing Cloudflare Stream integration\",
    \"site\": \"$SITE\"
  }")

echo "Response: $RESPONSE"
echo ""

# Extract task ID from response
TASK_ID=$(echo $RESPONSE | grep -o '"taskId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TASK_ID" ]; then
  echo "❌ Failed to get task ID. Response: $RESPONSE"
  exit 1
fi

echo "✅ Task created successfully!"
echo "Task ID: $TASK_ID"
echo ""

# Monitor task status
echo "👁️  Monitoring task status..."
while true; do
  STATUS_RESPONSE=$(curl -s "$BASE_URL/status/$TASK_ID")
  STATUS=$(echo $STATUS_RESPONSE | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  PERCENT=$(echo $STATUS_RESPONSE | grep -o '"percent":[^,}]*' | cut -d':' -f2)
  
  echo "Status: $STATUS | Progress: $PERCENT%"
  
  if [ "$STATUS" = "completed" ]; then
    echo ""
    echo "🎉 Upload completed successfully!"
    
    # Extract Cloudflare Stream info
    STREAM_ID=$(echo $STATUS_RESPONSE | grep -o '"cloudflareStreamId":"[^"]*"' | cut -d'"' -f4)
    PLAYBACK_URL=$(echo $STATUS_RESPONSE | grep -o '"cloudflarePlaybackUrl":"[^"]*"' | cut -d'"' -f4)
    
    echo "Stream ID: $STREAM_ID"
    echo "Playback URL: $PLAYBACK_URL"
    echo ""
    echo "🎬 You can now play the video using the playback URL"
    break
  elif [ "$STATUS" = "error" ]; then
    echo ""
    echo "❌ Upload failed!"
    echo "Full response: $STATUS_RESPONSE"
    break
  fi
  
  sleep 5
done

echo ""
echo "📋 All tasks in system:"
curl -s "$BASE_URL/tasks" | jq '.tasks[] | {taskId: .taskId, type: .type, status: .status, createdAt: .createdAt}'
