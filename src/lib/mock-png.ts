// Mock PNG generator — produces a valid PNG file with colored background and centered text
// Pure JS implementation, no external dependencies needed for mock mode

import { Buffer } from "buffer";

// CRC32 lookup table
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c = (crcTable[(c ^ b) & 0xff]!)! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// IHDR chunk: width, height, 8-bit RGB
function makeIHDR(w: number, h: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(w, 0);
  data.writeUInt32BE(h, 4);
  data[8] = 8;  // bit depth
  data[9] = 2;  // color type: RGB
  data[10] = 0; // compression
  data[11] = 0; // filter
  data[12] = 0; // interlace
  return makeChunk("IHDR", data);
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeB, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeB, data, crc]);
}

// Very basic bitmap font (5x7) for ASCII characters 32-126
const FONT_WIDTH = 5;
const FONT_HEIGHT = 7;
const FONT_DATA: Record<number, number[]> = {
  // Only store the chars we need: digits, #, space
  32: [0,0,0,0,0],        // space
  35: [0,10,31,10,31,10,0], // #
  48: [14,17,19,21,25,17,14], // 0
  49: [4,12,4,4,4,4,14],     // 1
  50: [14,17,2,4,8,16,31],   // 2
  51: [14,17,1,6,1,17,14],   // 3
  52: [2,6,10,18,31,2,2],    // 4
  53: [31,16,30,1,1,17,14],  // 5
  54: [14,17,16,30,17,17,14],// 6
  55: [31,1,2,4,8,8,8],      // 7
  56: [14,17,17,14,17,17,14],// 8
  57: [14,17,17,15,1,17,14], // 9
  120: [0,0,0,0,0,0,0],      // x (just use space)
};

function getCharPixels(ch: string): number[] {
  const code = ch.charCodeAt(0);
  return FONT_DATA[code] ?? [0,0,0,0,0,0,0];
}

function drawChar(
  pixels: Buffer,
  imgW: number,
  x: number,
  y: number,
  ch: string,
  r: number,
  g: number,
  b: number
): void {
  const rows = getCharPixels(ch);
  for (let row = 0; row < FONT_HEIGHT; row++) {
    const bits = rows[row]!;
    for (let col = 0; col < FONT_WIDTH; col++) {
      if (bits & (1 << (4 - col))) {
        const px = x + col;
        const py = y + row;
        if (px >= 0 && px < imgW && py >= 0) {
          const offset = (py * imgW + px) * 3;
          pixels[offset] = r;
          pixels[offset + 1] = g;
          pixels[offset + 2] = b;
        }
      }
    }
  }
}

export function generatePng(
  w: number,
  h: number,
  bg: number[],
  text: string
): Buffer {
  // Raw image data: each row has filter byte (0) + RGB pixels
  const rawData = Buffer.alloc(h * (1 + w * 3));
  const [r, g, b] = bg;

  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 3);
    rawData[rowStart] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const offset = rowStart + 1 + x * 3;
      rawData[offset] = r!;
      rawData[offset + 1] = g!;
      rawData[offset + 2] = b!;
    }
  }

  // Draw text centered
  const charW = FONT_WIDTH + 1;
  const totalW = text.length * charW - 1;
  const startX = Math.floor((w - totalW) / 2);
  const startY = Math.floor((h - FONT_HEIGHT) / 2);

  // Text color: dark on light bg, light on dark bg
  const brightness = (r! + g! + b!) / 3;
  const textColor = brightness > 128 ? [20, 20, 20] : [235, 235, 235];

  for (let i = 0; i < text.length; i++) {
    drawChar(
      rawData,
      w,
      startX + i * charW,
      startY,
      text[i]!,
      textColor[0]!,
      textColor[1]!,
      textColor[2]!
    );
  }

  // PNG signature
  const signature = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);

  // Deflate raw image data (simple uncompressed — zlib level 0)
  const zlib = require("zlib");
  const compressed = zlib.deflateSync(rawData);

  // Build IDAT chunk
  const idat = makeChunk("IDAT", compressed);
  const iend = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, makeIHDR(w, h), idat, iend]);
}