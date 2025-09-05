#!/usr/bin/env node

/**
 * Test Cloudflare Stream Upload with Form Data
 * ทดสอบการอัปโหลดด้วยข้อมูลที่ส่งมาจาก frontend
 */

const axios = require('axios');
const FormData = require('form-data');

// Configuration
const BASE_URL = 'http://localhost:3000';

// Test data จากข้อมูลที่ส่งมา
const testData = {
  url: 'https://vue-project.sgp1.digitaloceanspaces.com/2025/09/1757062947922.mp4',
  site: 'fti.academy',
  storage: '68baa727914117c87b497ceb',
  title: 'Test Video from FTI Academy',
  description: 'Video uploaded for testing Cloudflare Stream integration'
};

async function testWithFormData() {
  console.log('🧪 Testing Cloudflare Stream Upload with Form Data...\n');
  
  try {
    // สร้าง FormData
    const formData = new FormData();
    formData.append('url', testData.url);
    formData.append('site', testData.site);
    formData.append('storage', testData.storage);
    formData.append('title', testData.title);
    formData.append('description', testData.description);
    
    console.log('📤 ส่งข้อมูลผ่าน Form Data...');
    console.log('Data to send:', testData);
    
    const response = await axios.post(`${BASE_URL}/stream-upload`, formData, {
      headers: {
        ...formData.getHeaders()
      }
    });
    
    if (response.data.success) {
      console.log('✅ Upload request successful!');
      console.log('Task ID:', response.data.taskId);
      console.log('Type:', response.data.type);
      console.log('Queue Position:', response.data.queuePosition);
      
      const taskId = response.data.taskId;
      
      // ติดตามสถานะ
      console.log('\n⏳ ติดตามสถานะการอัปโหลด...');
      await pollTaskStatus(taskId);
      
    } else {
      console.error('❌ Upload request failed:', response.data.error);
    }
    
  } catch (error) {
    console.error('❌ Error occurred:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', error.response.data);
    }
  }
}

async function testWithJSON() {
  console.log('\n🧪 Testing Cloudflare Stream Upload with JSON...\n');
  
  try {
    console.log('📤 ส่งข้อมูลผ่าน JSON...');
    console.log('Data to send:', testData);
    
    const response = await axios.post(`${BASE_URL}/stream-upload`, testData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.success) {
      console.log('✅ JSON Upload request successful!');
      console.log('Task ID:', response.data.taskId);
      console.log('Type:', response.data.type);
      console.log('Queue Position:', response.data.queuePosition);
    } else {
      console.error('❌ JSON Upload request failed:', response.data.error);
    }
    
  } catch (error) {
    console.error('❌ JSON Error occurred:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', error.response.data);
    }
  }
}

async function pollTaskStatus(taskId) {
  const maxAttempts = 60; // รอสูงสุด 5 นาที
  let attempt = 0;
  
  while (attempt < maxAttempts) {
    try {
      const response = await axios.get(`${BASE_URL}/status/${taskId}`);
      
      if (response.data.success) {
        const task = response.data.task;
        
        console.log(`[${new Date().toLocaleTimeString()}] สถานะ: ${task.status} | ความคืบหน้า: ${task.percent || 0}%`);
        
        if (task.status === 'completed') {
          console.log('\n🎉 อัปโหลดเสร็จสมบูรณ์!');
          console.log('Stream ID:', task.cloudflareStreamId);
          console.log('Playback URL:', task.cloudflarePlaybackUrl);
          console.log('CF Status:', task.cloudflareStreamStatus);
          
          if (task.cloudflareStreamMeta) {
            console.log('\n📋 ข้อมูลเพิ่มเติม:');
            console.log('Title:', task.cloudflareStreamMeta.title);
            console.log('Description:', task.cloudflareStreamMeta.description);
            console.log('Storage Reference:', task.cloudflareStreamMeta.storageReference);
          }
          
          return;
        } else if (task.status === 'error') {
          console.log('\n❌ เกิดข้อผิดพลาด:', task.error);
          return;
        } else if (task.status === 'stopped') {
          console.log('\n⏹️ การอัปโหลดถูกหยุด');
          return;
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        attempt++;
        
      } else {
        console.error('❌ ไม่สามารถตรวจสอบสถานะได้:', response.data.error);
        return;
      }
      
    } catch (error) {
      console.error('❌ เกิดข้อผิดพลาดในการตรวจสอบสถานะ:', error.message);
      return;
    }
  }
  
  console.log('\n⏰ หมดเวลารอ');
}

// Test การเชื่อมต่อเซิร์ฟเวอร์ก่อน
async function testConnection() {
  try {
    const response = await axios.get(`${BASE_URL}/system-status`);
    console.log('✅ Server is running');
    console.log('Active jobs:', response.data.system?.concurrentJobs || 0);
    return true;
  } catch (error) {
    console.error('❌ Cannot connect to server:', error.message);
    console.error('Please make sure the server is running on', BASE_URL);
    return false;
  }
}

async function main() {
  console.log('🚀 Cloudflare Stream Upload Test');
  console.log('Base URL:', BASE_URL);
  console.log('Test Data:', testData);
  console.log('\n' + '='.repeat(60) + '\n');
  
  // ตรวจสอบการเชื่อมต่อ
  const connected = await testConnection();
  if (!connected) {
    return;
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  // ทดสอบด้วย Form Data (แบบที่ frontend ส่งมา)
  await testWithFormData();
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  // ทดสอบด้วย JSON (สำหรับเปรียบเทียบ)
  await testWithJSON();
  
  console.log('\n✨ การทดสอบเสร็จสิ้น!');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testWithFormData,
  testWithJSON,
  pollTaskStatus
};
