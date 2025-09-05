#!/usr/bin/env node

/**
 * Thai Font Checker for FFmpeg
 * ตรวจสอบฟอนต์ภาษาไทยที่ติดตั้งในระบบ
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 ตรวจสอบฟอนต์ภาษาไทยในระบบ...\n');

// รายการฟอนต์ไทยที่แนะนำ
const recommendedFonts = {
  // TLWG Fonts (ฟอนต์ไทยมาตรฐาน)
  tlwg: [
    '/usr/share/fonts/truetype/tlwg/Garuda.ttf',
    '/usr/share/fonts/truetype/tlwg/Kinnari.ttf',
    '/usr/share/fonts/truetype/tlwg/Waree.ttf',
    '/usr/share/fonts/truetype/tlwg/Loma.ttf',
    '/usr/share/fonts/truetype/tlwg/Purisa.ttf',
    '/usr/share/fonts/truetype/tlwg/Sawasdee.ttf',
    '/usr/share/fonts/truetype/tlwg/Umpush.ttf'
  ],
  
  // Google Fonts Thai
  google: [
    '/usr/share/fonts/truetype/thai/Sarabun-Regular.ttf',
    '/usr/share/fonts/truetype/thai/Kanit-Regular.ttf',
    '/usr/share/fonts/truetype/thai/Prompt-Regular.ttf',
    '/usr/share/fonts/truetype/thai/Mitr-Regular.ttf',
    '/usr/share/fonts/truetype/thai/Chakra-Petch-Regular.ttf',
    '/usr/share/fonts/truetype/thai/IBM-Plex-Sans-Thai-Regular.ttf'
  ],
  
  // Noto Fonts
  noto: [
    '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSerifThai-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoLoopedThai-Regular.ttf'
  ],
  
  // System Fonts
  system: [
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-Regular.ttf'
  ]
};

let foundFonts = [];
let bestFont = null;

// ตรวจสอบฟอนต์แต่ละหมวดหมู่
Object.keys(recommendedFonts).forEach(category => {
  console.log(`📁 ${category.toUpperCase()} Fonts:`);
  
  recommendedFonts[category].forEach(fontPath => {
    if (fs.existsSync(fontPath)) {
      const fontName = path.basename(fontPath);
      console.log(`   ✅ ${fontName} - ${fontPath}`);
      foundFonts.push({ category, path: fontPath, name: fontName });
      
      // เลือกฟอนต์ไทยที่ดีที่สุด
      if (!bestFont && category === 'tlwg') {
        bestFont = fontPath;
      } else if (!bestFont && category === 'google') {
        bestFont = fontPath;
      } else if (!bestFont && category === 'noto') {
        bestFont = fontPath;
      }
    } else {
      const fontName = path.basename(fontPath);
      console.log(`   ❌ ${fontName} - ไม่พบ`);
    }
  });
  console.log('');
});

// แสดงผลสรุป
console.log('📊 สรุปผลการตรวจสอบ:');
console.log(`   พบฟอนต์ทั้งหมด: ${foundFonts.length} ไฟล์`);

if (foundFonts.length > 0) {
  console.log(`   ฟอนต์ที่แนะนำ: ${bestFont || foundFonts[0].path}`);
  
  // แสดงรายการฟอนต์ที่พบ
  console.log('\n📋 รายการฟอนต์ที่พบทั้งหมด:');
  foundFonts.forEach((font, index) => {
    const star = font.path === bestFont ? '⭐' : '  ';
    console.log(`${star} ${index + 1}. ${font.name} (${font.category})`);
    console.log(`      ${font.path}`);
  });
} else {
  console.log('   ⚠️  ไม่พบฟอนต์ไทยในระบบ');
  console.log('\n💡 คำแนะนำการติดตั้ง:');
  console.log('   sudo apt update');
  console.log('   sudo apt install fonts-tlwg-garuda fonts-tlwg-kinnari fonts-tlwg-waree');
  console.log('   sudo apt install fonts-noto-cjk fonts-noto-cjk-extra');
  console.log('   fc-cache -fv');
}

// ตรวจสอบ FFmpeg support
console.log('\n🎬 ตรวจสอบ FFmpeg Font Support:');
try {
  const ffmpegVersion = execSync('ffmpeg -version', { encoding: 'utf8' });
  if (ffmpegVersion.includes('--enable-libfreetype')) {
    console.log('   ✅ FFmpeg รองรับ text rendering (libfreetype)');
  } else {
    console.log('   ❌ FFmpeg ไม่รองรับ text rendering');
  }
  
  // ทดสอบ font loading
  if (bestFont) {
    console.log('\n🧪 ทดสอบการโหลดฟอนต์:');
    const testCommand = `ffmpeg -f lavfi -i color=black:size=320x240:duration=1 -vf "drawtext=text='ทดสอบ':fontfile='${bestFont}':fontsize=24:fontcolor=white:x=10:y=10" -y test_font.mp4 2>&1`;
    
    try {
      execSync(testCommand, { encoding: 'utf8' });
      if (fs.existsSync('test_font.mp4')) {
        console.log('   ✅ สามารถใช้ฟอนต์ไทยได้');
        fs.unlinkSync('test_font.mp4'); // ลบไฟล์ทดสอบ
      }
    } catch (error) {
      console.log('   ❌ ไม่สามารถใช้ฟอนต์ไทยได้');
      console.log('   Error:', error.message.split('\n')[0]);
    }
  }
} catch (error) {
  console.log('   ❌ ไม่พบ FFmpeg ในระบบ');
}

// สร้างไฟล์ config สำหรับ app
const configData = {
  bestFont: bestFont,
  availableFonts: foundFonts,
  timestamp: new Date().toISOString()
};

fs.writeFileSync('thai-fonts-config.json', JSON.stringify(configData, null, 2));
console.log('\n💾 บันทึกการตั้งค่าใน thai-fonts-config.json');

console.log('\n🚀 พร้อมใช้งานฟอนต์ไทยใน FFmpeg!');
