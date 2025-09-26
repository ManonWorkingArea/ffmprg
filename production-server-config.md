# Production Server Configuration for Media Recording

## Issues Fixed
1. **CORS Policy**: Enhanced origin validation with localhost:8080 support
2. **413 Content Too Large**: Increased limits to 100MB for video chunks

## Required Production Server Settings

### 1. Nginx Configuration (if using nginx as proxy)

Add these settings to your nginx server configuration:

```nginx
server {
    listen 443 ssl;
    server_name media.cloudrestfulapi.com;
    
    # Increase client body size for large video chunks
    client_max_body_size 100M;
    
    # Increase timeouts for large uploads
    client_body_timeout 120s;
    client_header_timeout 120s;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
    
    # Enable CORS for all routes
    add_header 'Access-Control-Allow-Origin' '$http_origin' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS, PATCH' always;
    add_header 'Access-Control-Allow-Headers' 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, X-Session-ID, X-Chunk-Index, Content-Length' always;
    add_header 'Access-Control-Allow-Credentials' 'true' always;
    add_header 'Access-Control-Max-Age' '86400' always;
    
    # Handle preflight requests
    if ($request_method = 'OPTIONS') {
        add_header 'Access-Control-Allow-Origin' '$http_origin' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS, PATCH' always;
        add_header 'Access-Control-Allow-Headers' 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, X-Session-ID, X-Chunk-Index, Content-Length' always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Max-Age' '86400' always;
        add_header 'Content-Length' '0' always;
        add_header 'Content-Type' 'text/plain' always;
        return 200;
    }
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Large file upload settings
        proxy_request_buffering off;
        proxy_buffering off;
    }
}
```

### 2. PM2 Configuration (ecosystem.config.js)

```javascript
module.exports = {
  apps: [{
    name: 'media-api',
    script: 'app.js',
    instances: 1, // Single instance for file handling consistency
    autorestart: true,
    watch: false,
    max_memory_restart: '2G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      // Increase Node.js limits for large requests
      NODE_OPTIONS: '--max-old-space-size=2048'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log'
  }]
};
```

### 3. System Limits (Ubuntu/CentOS)

Add to `/etc/security/limits.conf`:
```
* soft nofile 65536
* hard nofile 65536
* soft memlock unlimited
* hard memlock unlimited
```

### 4. Node.js Process Limits

Set these environment variables in your production environment:
```bash
export UV_THREADPOOL_SIZE=32
export NODE_OPTIONS="--max-old-space-size=2048 --max-http-header-size=32768"
```

## Testing Commands

### 1. Test CORS Configuration
```bash
# Test preflight request
curl -X OPTIONS \
  https://media.cloudrestfulapi.com/api/media/recording/init \
  -H "Origin: http://localhost:8080" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type, X-Session-ID" \
  -v

# Test actual CORS request
curl -X GET \
  https://media.cloudrestfulapi.com/api/cors-test \
  -H "Origin: http://localhost:8080" \
  -v
```

### 2. Test File Upload Limits
```bash
# Create a 50MB test file
dd if=/dev/zero of=test-50mb.bin bs=1M count=50

# Test upload
curl -X POST \
  https://media.cloudrestfulapi.com/api/media/recording/chunk \
  -H "Origin: http://localhost:8080" \
  -H "X-Session-ID: test-session-123" \
  -H "X-Chunk-Index: 0" \
  -F "chunk=@test-50mb.bin" \
  -v
```

## Deployment Steps

1. **Update your production code:**
   ```bash
   git pull origin main
   npm install
   ```

2. **Restart the application:**
   ```bash
   pm2 restart media-api
   ```

3. **Update nginx configuration:**
   ```bash
   sudo nano /etc/nginx/sites-available/media.cloudrestfulapi.com
   sudo nginx -t
   sudo systemctl reload nginx
   ```

4. **Check logs for CORS and upload issues:**
   ```bash
   pm2 logs media-api --lines 100
   tail -f /var/log/nginx/error.log
   ```

## Monitoring

Monitor for these issues in production:
- CORS-related errors in browser console
- 413 errors in server logs
- High memory usage during large uploads
- Slow response times for chunk uploads

## Security Considerations

1. **Rate Limiting**: Add rate limiting for media endpoints
2. **File Type Validation**: Ensure only video chunks are accepted
3. **Size Limits**: Implement per-user or per-session upload limits
4. **Authentication**: Add proper session validation
5. **Cleanup**: Implement automatic cleanup of old chunks and sessions