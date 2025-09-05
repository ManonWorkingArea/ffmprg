# Trim Endpoint Update Documentation

## Overview
Updated the `/trim` endpoint to support new data structure with enhanced text and image overlay capabilities, audio processing options, and improved stream handling.

## New Data Structure Support

### Input URL Field
- **Before**: `input_url` (required)
- **After**: `url` (primary) or `input_url` (backward compatibility)

### Overlay System Enhancement

#### Text Overlays
**New Format**: `text_overlays` array
```json
{
  "text_overlays": [
    {
      "id": "L3m69mym",
      "text": "Your text",
      "font_family": "sans-serif",
      "font_size": 24,
      "color": "#FFFFFF",
      "position": {
        "x": 10,
        "y": 10
      },
      "timing": {
        "start": 0,
        "end": 167.7,
        "duration": 167.7
      },
      "style": {
        "opacity": 1,
        "rotation": 0,
        "scale_x": 1,
        "scale_y": 1,
        "stroke_width": 0,
        "stroke_color": "#000000",
        "shadow": false,
        "bold": false,
        "italic": false
      }
    }
  ]
}
```

#### Image Overlays
**New Format**: `image_overlays` array
```json
{
  "image_overlays": [
    {
      "id": "Ljfaezj8",
      "image_url": "https://backend-storage.sgp1.digitaloceanspaces.com/Graphic/Logo/white-logopng-1png.png",
      "position": {
        "x": 60,
        "y": 10,
        "width": 25,
        "height": 25
      },
      "timing": {
        "start": 0,
        "end": 167.7,
        "duration": 167.7
      },
      "style": {
        "opacity": 1,
        "rotation": 0,
        "scale_x": 1,
        "scale_y": 1
      }
    }
  ]
}
```

### Audio Processing Options

#### Audio Volume
```json
{
  "audio_volume": 1.1
}
```

#### Audio Filter
```json
{
  "audio_filter": "volume=1.1"
}
```

#### Copy Streams
```json
{
  "copy_streams": true
}
```
- When `true`: Uses stream copy mode for better performance (no re-encoding)
- When `false`: Full re-encoding with filters applied

### Processing Mode
```json
{
  "processing_mode": "fast"
}
```
- `"fast"`: Uses FFmpeg preset 'fast'
- Other values: Uses preset 'medium'

### Segments Enhancement
```json
{
  "trim_mode": "multi",
  "segments": [
    {
      "start": 0,
      "end": 167.7,
      "duration": 167.7
    }
  ]
}
```

## Complete Example Request

```json
{
  "url": "https://vue-project.sgp1.digitaloceanspaces.com/https://vue-project.sgp1.digitaloceanspaces.com/2025/09/1757062947922.mp4",
  "site": "fti.academy",
  "storage": "68baa727914117c87b497ceb",
  "filename": "6339299-hd_1920_1080_30fps_trimmed.mp4",
  "output_format": "mp4",
  "quality": "720p",
  "processing_mode": "fast",
  "audio_volume": 1.1,
  "copy_streams": true,
  "trim_mode": "multi",
  "segments": [
    {
      "start": 0,
      "end": 167.7,
      "duration": 167.7
    }
  ],
  "audio_filter": "volume=1.1",
  "text_overlays": [
    {
      "id": "L3m69mym",
      "text": "Your text",
      "font_family": "sans-serif",
      "font_size": 24,
      "color": "#FFFFFF",
      "position": {
        "x": 10,
        "y": 10
      },
      "timing": {
        "start": 0,
        "end": 167.7,
        "duration": 167.7
      },
      "style": {
        "opacity": 1,
        "rotation": 0,
        "scale_x": 1,
        "scale_y": 1,
        "stroke_width": 0,
        "stroke_color": "#000000",
        "shadow": false,
        "bold": false,
        "italic": false
      }
    }
  ],
  "image_overlays": [
    {
      "id": "Ljfaezj8",
      "image_url": "https://backend-storage.sgp1.digitaloceanspaces.com/Graphic/Logo/white-logopng-1png.png",
      "position": {
        "x": 60,
        "y": 10,
        "width": 25,
        "height": 25
      },
      "timing": {
        "start": 0,
        "end": 167.7,
        "duration": 167.7
      },
      "style": {
        "opacity": 1,
        "rotation": 0,
        "scale_x": 1,
        "scale_y": 1
      }
    }
  ]
}
```

## Backward Compatibility

The endpoint maintains backward compatibility:
- Still accepts `input_url` field
- Old `overlays` format still works
- All existing functionality preserved

## Internal Data Conversion

The system automatically converts the new overlay formats to the internal processing format:

### Text Overlay Conversion
- `text_overlays[].text` → `overlays[].content`
- `text_overlays[].position` → `overlays[].position`
- `text_overlays[].timing.start` → `overlays[].start_time`
- `text_overlays[].timing.end` → `overlays[].end_time`
- `text_overlays[].style` → `overlays[].style`

### Image Overlay Conversion
- `image_overlays[].image_url` → `overlays[].content`
- `image_overlays[].position` → `overlays[].position`
- `image_overlays[].timing.start` → `overlays[].start_time`
- `image_overlays[].timing.end` → `overlays[].end_time`

## Enhanced Features

1. **Flexible Audio Processing**: Support for both `audio_volume` and `audio_filter`
2. **Stream Copy Mode**: Option to copy streams without re-encoding for performance
3. **Processing Mode Control**: Fast vs medium quality presets
4. **Improved Overlay Handling**: Separate text and image overlay arrays for better organization
5. **Enhanced Logging**: Better tracking of overlay processing and audio settings

## Error Handling

The endpoint validates:
- Required `url` field (with fallback to `input_url`)
- Required `site` field
- Required `segments` array
- Valid overlay data structures
- Audio processing parameters

## Response Format

Same as before:
```json
{
  "success": true,
  "taskId": "uuid-string",
  "queueStatus": {
    "queued": 0,
    "processing": 1
  }
}
```

## Notes

- Position values in overlays are percentage-based (0-100)
- Audio volume values are multipliers (1.0 = normal, 1.1 = 10% louder)
- Copy streams mode bypasses most filters for performance but may not work with overlays
- Processing mode affects encoding speed vs quality balance
