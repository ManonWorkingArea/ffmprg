#!/bin/bash

# Deploy Nginx CORS Configuration for Media Recording API
# Run this script on your production server

set -e

echo "🚀 Deploying Nginx CORS Configuration"
echo "====================================="

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    echo "❌ This script must be run as root or with sudo"
    echo "   Usage: sudo ./deploy-nginx-cors.sh"
    exit 1
fi

# Configuration variables
NGINX_SITES_AVAILABLE="/etc/nginx/sites-available"
NGINX_SITES_ENABLED="/etc/nginx/sites-enabled"
SITE_NAME="media.cloudrestfulapi.com"
CONFIG_FILE="nginx-cors-config.conf"

echo "📂 Checking nginx directories..."
if [ ! -d "$NGINX_SITES_AVAILABLE" ]; then
    echo "❌ Nginx sites-available directory not found: $NGINX_SITES_AVAILABLE"
    echo "   Please install nginx first or adjust the path"
    exit 1
fi

echo "📋 Copying configuration file..."
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Configuration file not found: $CONFIG_FILE"
    echo "   Please make sure the file exists in the current directory"
    exit 1
fi

# Copy configuration file
cp "$CONFIG_FILE" "$NGINX_SITES_AVAILABLE/$SITE_NAME"
echo "✅ Configuration copied to: $NGINX_SITES_AVAILABLE/$SITE_NAME"

# Create symbolic link to enable site
echo "🔗 Enabling site..."
if [ -L "$NGINX_SITES_ENABLED/$SITE_NAME" ]; then
    echo "⚠️  Site already enabled, removing old link..."
    rm "$NGINX_SITES_ENABLED/$SITE_NAME"
fi

ln -s "$NGINX_SITES_AVAILABLE/$SITE_NAME" "$NGINX_SITES_ENABLED/$SITE_NAME"
echo "✅ Site enabled: $NGINX_SITES_ENABLED/$SITE_NAME"

# Test nginx configuration
echo "🧪 Testing nginx configuration..."
nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Nginx configuration test passed"
    
    # Reload nginx
    echo "🔄 Reloading nginx..."
    systemctl reload nginx
    
    if [ $? -eq 0 ]; then
        echo "✅ Nginx reloaded successfully"
        echo ""
        echo "🎉 Deployment completed!"
        echo ""
        echo "📋 Configuration summary:"
        echo "   - Site: $SITE_NAME"
        echo "   - CORS: Enabled for all origins (*)"
        echo "   - Max upload size: 100MB"
        echo "   - Proxy target: http://localhost:3000"
        echo "   - SSL: Configure certificate paths in the config file"
        echo ""
        echo "🔧 Next steps:"
        echo "   1. Update SSL certificate paths in the configuration"
        echo "   2. Restart your Node.js application on port 3000"
        echo "   3. Test CORS functionality from different origins"
        
    else
        echo "❌ Failed to reload nginx"
        echo "   Check nginx logs: sudo journalctl -u nginx"
        exit 1
    fi
else
    echo "❌ Nginx configuration test failed"
    echo "   Please check the configuration file and try again"
    exit 1
fi

echo ""
echo "📊 Nginx status:"
systemctl status nginx --no-pager -l

echo ""
echo "🔍 Test your setup:"
echo "   curl -X OPTIONS -H \"Origin: http://localhost:8080\" https://media.cloudrestfulapi.com/api/media/recording/init"