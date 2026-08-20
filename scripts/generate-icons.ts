/**
 * @file generate-icons.ts
 * @description 使用原生 node:zlib 生成标准的 16x16, 48x48, 128x128 扩展 PNG 图标 (零第三方依赖)
 */

import fs from "fs";
import path from "path";
import zlib from "node:zlib";

function createPNG(width: number, height: number): Buffer {
  // 1. PNG Signature (8 bytes)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // 2. IHDR Chunk (13 bytes payload)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8-bit depth
  ihdrData.writeUInt8(6, 9); // RGBA color type
  ihdrData.writeUInt8(0, 10); // Deflate compression
  ihdrData.writeUInt8(0, 11); // Filter method 0
  ihdrData.writeUInt8(0, 12); // No interlace

  const ihdrChunk = createChunk("IHDR", ihdrData);

  // 3. IDAT Chunk (Raw scanlines + Deflate)
  // Each scanline starts with filter byte (0 = None) followed by width * 4 bytes
  const rawScanlines = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;

  for (let y = 0; y < height; y++) {
    rawScanlines[offset++] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const nx = (x / width - 0.5) * 2;
      const ny = (y / height - 0.5) * 2;
      const dist = Math.sqrt(nx * nx + ny * ny);

      // Rounded shield / emblem shape
      const inIcon = Math.abs(nx) < 0.85 && Math.abs(ny) < 0.85;

      if (inIcon && dist < 1.1) {
        // High-tech Blue Gradient: #2563eb to #3b82f6
        const r = Math.floor(37 + 22 * (x / width));
        const g = Math.floor(99 + 31 * (y / height));
        const b = Math.floor(235 + 20 * (x / width));
        const a = 255;

        rawScanlines[offset++] = r;
        rawScanlines[offset++] = g;
        rawScanlines[offset++] = b;
        rawScanlines[offset++] = a;
      } else {
        // Transparent outside
        rawScanlines[offset++] = 0;
        rawScanlines[offset++] = 0;
        rawScanlines[offset++] = 0;
        rawScanlines[offset++] = 0;
      }
    }
  }

  const compressedData = zlib.deflateSync(rawScanlines);
  const idatChunk = createChunk("IDAT", compressedData);

  // 4. IEND Chunk
  const iendChunk = createChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32 implementation for PNG chunks
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.alloc(4);
  const typeAndData = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(typeAndData), 0);

  return Buffer.concat([lenBuf, typeAndData, crcBuf]);
}

const ICON_SIZES = [16, 48, 128];
const OUTPUT_DIR = path.resolve(__dirname, "../apps/browser-extension/icons");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

for (const size of ICON_SIZES) {
  const pngBuf = createPNG(size, size);
  const outPath = path.join(OUTPUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(outPath, pngBuf);
  console.log(`✅ Generated PNG icon: ${outPath} (${size}x${size}, ${pngBuf.length} bytes)`);
}
