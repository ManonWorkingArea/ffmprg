#!/usr/bin/env node

/**
 * Test Cloudflare Stream Upload with Real Data
 * ทดสอบการอัปโหลดไปยัง Cloudflare Stream ด้วยข้อมูลจริง
 */

const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:3000'; // หรือ URL ของ server ของคุณ

// Real test data from your frontend
const testData = {
  url: 'https://vue-project.sgp1.digitaloceanspaces.com/2025/09/1757062947922.mp4',
  site: 'fti.academy',
  storage: '68baa727914117c87b497ceb',
  title: 'Test Video from FTI Academy',
  description: 'Video uploaded from DigitalOcean Spaces to Cloudflare Stream'
};

async function testRealCloudflareStreamUpload() {
  console.log('🚀 ทดสอบการอัปโหลดไปยัง Cloudflare Stream ด้วยข้อมูลจริง...\n');
  
  try {
    // แสดงข้อมูลที่จะส่ง
    console.log('📋 ข้อมูลที่จะส่ง:');
    console.log('URL:', testData.url);
    console.log('Site:', testData.site);
    console.log('Storage ID:', testData.storage);
    console.log('Title:', testData.title);
    console.log('Description:', testData.description);
    console.log('');
    
    // ส่งคำขออัปโหลด
    console.log('📤 ส่งคำขออัปโหลดวิดีโอ...');
    
    const uploadResponse = await axios.post(`${BASE_URL}/stream-upload`, testData);
    
    if (uploadResponse.data.success) {
      console.log('✅ คำขออัปโหลดสำเร็จ!');
      console.log('Task ID:', uploadResponse.data.taskId);
      console.log('Queue Position:', uploadResponse.data.queuePosition);
      console.log('Estimated Wait Time:', uploadResponse.data.estimatedWaitTime);
      console.log('Status Check URL:', uploadResponse.data.statusCheckUrl);
      console.log('Dashboard URL:', uploadResponse.data.dashboardUrl);
      
      const taskId = uploadResponse.data.taskId;
      
      // ติดตามสถานะ
      console.log('\n⏳ ติดตามสถานะการอัปโหลด...');
      await pollTaskStatus(taskId);
      
    } else {
      console.error('❌ คำขออัปโหลดล้มเหลว:', uploadResponse.data.error);
    }
    
  } catch (error) {
    console.error('❌ เกิดข้อผิดพลาด:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
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
        
        const statusEmoji = {
          'queued': '⏳',
          'downloading': '📥',
          'processing': '⚡',
          'completed': '✅',
          'error': '❌'
        };
        
        console.log(`[${new Date().toLocaleTimeString()}] ${statusEmoji[task.status] || '❓'} สถานะ: ${task.status} | ความคืบหน้า: ${task.percent || 0}%`);
        
        if (task.status === 'completed') {
          console.log('\n🎉 อัปโหลดเสร็จสมบูรณ์!');
          console.log('━'.repeat(50));
          console.log('📺 ข้อมูลวิดีโอ Cloudflare Stream:');
          console.log('Stream ID:', task.cloudflareStreamId);
          console.log('Playback URL:', task.cloudflarePlaybackUrl);
          console.log('CF Status:', task.cloudflareStreamStatus);
          console.log('Completed At:', new Date(task.completedAt).toLocaleString('th-TH'));
          
          // แสดงข้อมูล metadata
          if (task.cloudflareStreamMeta) {
            console.log('\n📋 Metadata:');
            console.log('Title:', task.cloudflareStreamMeta.title);
            console.log('Description:', task.cloudflareStreamMeta.description);
            console.log('Original URL:', task.cloudflareStreamMeta.originalUrl);
            console.log('Storage Reference:', task.cloudflareStreamMeta.storageReference);
          }
          
          console.log('\n🔗 ลิงก์ที่เป็นประโยชน์:');
          console.log('Dashboard:', `${BASE_URL}`);
          console.log('Status API:', `${BASE_URL}/status/${taskId}`);
          if (task.cloudflareStreamId) {
            console.log('Stream Info:', `${BASE_URL}/stream-info/${task.cloudflareStreamId}`);
          }
          
          return;
        } else if (task.status === 'error') {
          console.log('\n❌ เกิดข้อผิดพลาดในการอัปโหลด:');
          console.log('Error:', task.error);
          console.log('Error Time:', new Date(task.errorAt).toLocaleString('th-TH'));
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

// ฟังก์ชันตรวจสอบว่า URL accessible หรือไม่
async function testVideoUrlAccess() {
  console.log('🔍 ตรวจสอบการเข้าถึง URL วิดีโอ...');
  try {
    const response = await axios.head(testData.url, { timeout: 10000 });
    console.log('✅ URL accessible');
    console.log('Content-Type:', response.headers['content-type']);
    console.log('Content-Length:', response.headers['content-length']);
    console.log('Size:', (parseInt(response.headers['content-length']) / 1024 / 1024).toFixed(2) + ' MB');
  } catch (error) {
    console.error('❌ ไม่สามารถเข้าถึง URL ได้:', error.message);
  }
}

// ฟังก์ชันหลัก
async function main() {
  console.log('🧪 Cloudflare Stream Upload Test - Real Data\n');
  
  // ตรวจสอบ URL ก่อน
  await testVideoUrlAccess();
  console.log('\n' + '='.repeat(50) + '\n');
  
  // ทดสอบการอัปโหลด
  await testRealCloudflareStreamUpload();
  
  console.log('\n✨ การทดสอบเสร็จสิ้น!');
}

// เรียกใช้งาน
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testRealCloudflareStreamUpload,
  testVideoUrlAccess
};
