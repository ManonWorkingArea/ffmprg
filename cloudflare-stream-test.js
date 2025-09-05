#!/usr/bin/env node

/**
 * Cloudflare Stream Upload Test Script
 * ทดสอบการอัปโหลดวิดีโอไปยัง Cloudflare Stream
 */

const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:3000'; // หรือ URL ของ server ของคุณ
const TEST_SITE = 'example.com'; // เปลี่ยนเป็น site ที่มีอยู่ใน database

// Test data
const testVideo = {
  url: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4', // ตัวอย่างวิดีโอ
  title: 'Test Video Upload to Cloudflare Stream',
  description: 'This is a test video uploaded via API',
  site: TEST_SITE
};

async function testCloudflareStreamUpload() {
  console.log('🚀 เริ่มทดสอบการอัปโหลดไปยัง Cloudflare Stream...\n');
  
  try {
    // 1. ส่งคำขออัปโหลด
    console.log('📤 ส่งคำขออัปโหลดวิดีโอ...');
    console.log('URL:', testVideo.url);
    console.log('Title:', testVideo.title);
    console.log('Site:', testVideo.site);
    
    const uploadResponse = await axios.post(`${BASE_URL}/stream-upload`, testVideo);
    
    if (uploadResponse.data.success) {
      console.log('✅ คำขออัปโหลดสำเร็จ!');
      console.log('Task ID:', uploadResponse.data.taskId);
      console.log('Queue Position:', uploadResponse.data.queuePosition);
      console.log('Type:', uploadResponse.data.type);
      
      const taskId = uploadResponse.data.taskId;
      
      // 2. ติดตามสถานะ
      console.log('\n⏳ ติดตามสถานะการอัปโหลด...');
      await pollTaskStatus(taskId);
      
    } else {
      console.error('❌ คำขออัปโหลดล้มเหลว:', uploadResponse.data.error);
    }
    
  } catch (error) {
    console.error('❌ เกิดข้อผิดพลาด:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

async function pollTaskStatus(taskId) {
  const maxAttempts = 60; // รอสูงสุด 5 นาที (60 x 5 วินาที)
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
          
          // แสดงข้อมูลเพิ่มเติม
          if (task.cloudflareStreamMeta) {
            console.log('\n📋 ข้อมูลเพิ่มเติม:');
            console.log('Title:', task.cloudflareStreamMeta.title);
            console.log('Description:', task.cloudflareStreamMeta.description);
            console.log('Original URL:', task.cloudflareStreamMeta.originalUrl);
          }
          
          return;
        } else if (task.status === 'error') {
          console.log('\n❌ เกิดข้อผิดพลาดในการอัปโหลด:', task.error);
          return;
        } else if (task.status === 'stopped') {
          console.log('\n⏹️ การอัปโหลดถูกหยุด');
          return;
        }
        
        // รอ 5 วินาทีก่อนตรวจสอบอีกครั้ง
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
  
  console.log('\n⏰ หมดเวลารอ - การอัปโหลดใช้เวลานานเกินไป');
}

// ฟังก์ชันทดสอบการดึงข้อมูลระบบ
async function testSystemStatus() {
  console.log('\n📊 ทดสอบการดึงข้อมูลสถานะระบบ...');
  
  try {
    const response = await axios.get(`${BASE_URL}/system-status`);
    
    if (response.data.success) {
      console.log('✅ ข้อมูลสถานะระบบ:');
      console.log('Concurrent Jobs:', response.data.system.concurrentJobs + '/' + response.data.system.maxConcurrentJobs);
      console.log('Active Processes:', response.data.system.activeProcesses);
      console.log('CPU Usage:', response.data.system.systemLoad.cpuUsage + '%');
      console.log('Memory Usage:', response.data.system.systemLoad.memoryUsage + '%');
      console.log('Can Process:', response.data.system.systemLoad.canProcess ? 'Yes' : 'No');
      
      console.log('\nTasks:');
      console.log('- Queued:', response.data.tasks.queued);
      console.log('- Processing:', response.data.tasks.processing);
      console.log('- Completed:', response.data.tasks.completed);
      console.log('- Error:', response.data.tasks.error);
    } else {
      console.error('❌ ไม่สามารถดึงข้อมูลสถานะระบบได้:', response.data.error);
    }
    
  } catch (error) {
    console.error('❌ เกิดข้อผิดพลาดในการดึงข้อมูลระบบ:', error.message);
  }
}

// เริ่มการทดสอบ
async function main() {
  console.log('🧪 Cloudflare Stream Upload Test\n');
  
  // ทดสอบสถานะระบบก่อน
  await testSystemStatus();
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // ทดสอบการอัปโหลด
  await testCloudflareStreamUpload();
  
  console.log('\n✨ การทดสอบเสร็จสิ้น!');
}

// เรียกใช้งาน
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testCloudflareStreamUpload,
  testSystemStatus
};
