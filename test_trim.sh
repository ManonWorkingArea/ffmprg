#!/bin/bash
echo "Testing /trim endpoint..."

# Test 1: Simple POST to /trim
echo "Test 1: Simple request"
curl -X POST http://159.65.131.165:3000/trim \
  -H "Content-Type: application/json" \
  -d '{"test": "simple"}' \
  2>/dev/null | head -1

echo -e "\n"

# Test 2: GET request (should be 404 since it's POST only)
echo "Test 2: GET request (should be 404)"
curl -s -o /dev/null -w "HTTP Code: %{http_code}" http://159.65.131.165:3000/trim

echo -e "\n\n"

# Test 3: Check if server is running
echo "Test 3: Server status"
curl -s http://159.65.131.165:3000/system-status | jq '.success' 2>/dev/null || echo "Server not responding"
