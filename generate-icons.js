const fs = require('fs');
const { createCanvas } = require('canvas');

function createIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#131722';
  ctx.fillRect(0, 0, size, size);
  
  // Chart line
  ctx.strokeStyle = '#2962ff';
  ctx.lineWidth = size * 0.05;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.1875, size * 0.625);
  ctx.lineTo(size * 0.34375, size * 0.4375);
  ctx.lineTo(size * 0.46875, size * 0.5625);
  ctx.lineTo(size * 0.625, size * 0.3125);
  ctx.lineTo(size * 0.8125, size * 0.625);
  ctx.stroke();
  
  // Dot
  ctx.fillStyle = '#089981';
  ctx.beginPath();
  ctx.arc(size * 0.8125, size * 0.3125, size * 0.035, 0, Math.PI * 2);
  ctx.fill();
  
  // Text
  ctx.fillStyle = '#d1d4dc';
  ctx.font = `bold ${size * 0.086}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('COIN', size / 2, size * 0.82);
  
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(`public/icon-${size}.png`, buffer);
  console.log(`Created icon-${size}.png`);
}

createIcon(192);
createIcon(512);
