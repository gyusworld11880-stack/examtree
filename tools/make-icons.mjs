// make-icons.mjs — 앱 아이콘 PNG 생성기. 외부 패키지 없이 Node 내장 zlib 만 쓴다.
//   node tools/make-icons.mjs
// 4배 슈퍼샘플링 후 축소해 가장자리를 부드럽게 만든다.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const BG = [15, 23, 42];      // 남색 배경
const BAR = [237, 240, 246];  // 흰 줄 (스프레드시트 행)
const STAR = [245, 158, 11];  // 금색 별

const SS = 4; // 슈퍼샘플 배율

function makeCanvas(w, h) {
  return { w, h, data: new Uint8Array(w * h * 3) };
}

function fillAll(c, color) {
  for (let i = 0; i < c.w * c.h; i++) {
    c.data[i * 3] = color[0];
    c.data[i * 3 + 1] = color[1];
    c.data[i * 3 + 2] = color[2];
  }
}

function setPx(c, x, y, color) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 3;
  c.data[i] = color[0];
  c.data[i + 1] = color[1];
  c.data[i + 2] = color[2];
}

function fillRoundRect(c, x, y, w, h, r, color) {
  for (let py = Math.floor(y); py < y + h; py++) {
    for (let px = Math.floor(x); px < x + w; px++) {
      const dx = Math.min(px - x, x + w - 1 - px);
      const dy = Math.min(py - y, y + h - 1 - py);
      if (dx < r && dy < r) {
        const cx = dx < r ? x + r : px;
        const cy = dy < r ? y + r : py;
        const ux = px < x + r ? x + r : (px > x + w - r ? x + w - r : px);
        const uy = py < y + r ? y + r : (py > y + h - r ? y + h - r : py);
        if (Math.hypot(px - ux, py - uy) > r) continue;
        void cx; void cy;
      }
      setPx(c, px, py, color);
    }
  }
}

function fillPolygon(c, pts, color) {
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const [x, y] of pts) {
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      if (inside(pts, x + 0.5, y + 0.5)) setPx(c, x, y, color);
    }
  }
}

function inside(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function starPoints(cx, cy, outer, inner, count = 5) {
  const pts = [];
  for (let i = 0; i < count * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / count;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function downscale(src, factor) {
  const w = src.w / factor;
  const h = src.h / factor;
  const out = makeCanvas(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = ((y * factor + sy) * src.w + (x * factor + sx)) * 3;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2];
        }
      }
      const n = factor * factor;
      const i = (y * w + x) * 3;
      out.data[i] = Math.round(r / n);
      out.data[i + 1] = Math.round(g / n);
      out.data[i + 2] = Math.round(b / n);
    }
  }
  return out;
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(c) {
  const raw = Buffer.alloc(c.h * (c.w * 3 + 1));
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 3 + 1)] = 0; // 필터 없음
    for (let x = 0; x < c.w * 3; x++) {
      raw[y * (c.w * 3 + 1) + 1 + x] = c.data[y * c.w * 3 + x];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param size   출력 크기(px)
 * @param inset  내용을 안쪽으로 밀어넣는 비율. maskable 아이콘은 잘려도 되도록 여백을 크게 준다.
 */
function drawIcon(size, inset = 0) {
  const S = size * SS;
  const c = makeCanvas(S, S);
  fillAll(c, BG);

  const pad = S * inset;
  const inner = S - pad * 2;
  const unit = inner / 100;

  // 스프레드시트 행 3줄
  const barX = pad + unit * 18;
  const barW = unit * 64;
  const barH = unit * 9;
  [46, 62, 78].forEach((top, i) => {
    fillRoundRect(c, barX, pad + unit * top, barW * (i === 2 ? 0.68 : 1), barH, barH / 2, BAR);
  });

  // 별
  fillPolygon(c, starPoints(pad + unit * 50, pad + unit * 27, unit * 22, unit * 9.5), STAR);

  return downscale(c, SS);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, 0.06],
  ['icon-512.png', 512, 0.06],
  ['icon-512-maskable.png', 512, 0.16], // 마스크로 잘려도 안전하도록 여백을 더 준다
  ['apple-touch-icon-180.png', 180, 0.06],
];

for (const [name, size, inset] of targets) {
  const png = encodePNG(drawIcon(size, inset));
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)}KB`);
}
