// Trim WAV samples to reduce file size for web playback
// Piano: 48kHz 24-bit stereo → 44.1kHz 16-bit mono, 4 sec
// Rhodes: 48kHz 32-bit float mono → already mono, trim to 4 sec, convert to 16-bit
const fs = require('fs');
const path = require('path');

const BASE = 'C:/Users/Matan/Documents/Claude Projects (C)/Claude Projects/Appsoluti/assets/audio/keyboard';
const OUT = path.join(BASE, 'trimmed');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
if (!fs.existsSync(path.join(OUT, 'piano'))) fs.mkdirSync(path.join(OUT, 'piano'));
if (!fs.existsSync(path.join(OUT, 'rhodes'))) fs.mkdirSync(path.join(OUT, 'rhodes'));

const TRIM_SEC = 4;
const OUT_SR = 44100;

// Piano samples to keep (sparse set - 8 samples)
const PIANO_FILES = [
  'FSS6_Royers_L1_C0_RR1.wav',
  'FSS6_Royers_L1_D1_RR1.wav',
  'FSS6_Royers_L1_E2_RR1.wav',
  'FSS6_Royers_L1_D#3_RR1.wav',
  'FSS6_Royers_L1_C#4_RR1.wav',
  'FSS6_Royers_L1_B4_RR1.wav',
  'FSS6_Royers_L1_A#5_RR1.wav',
  'FSS6_Royers_L1_A6_RR1.wav',
];

// Rhodes: every 4 semitones from E0(16) to E6(88)
const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const RHODES_MIDIS = [16,20,24,28,32,36,40,44,48,52,56,60,64,68,72,76,80,84,88];
const RHODES_FILES = RHODES_MIDIS.map(midi => {
  const oct = Math.floor(midi/12) - 1;
  const pc = midi % 12;
  return NOTES[pc] + oct + '-mf.wav';
});

function findChunk(buf, tag) {
  for (let i = 12; i < buf.length - 8; i++) {
    if (buf.slice(i, i+4).toString() === tag) {
      return { offset: i + 8, size: buf.readUInt32LE(i + 4), headerOff: i };
    }
  }
  return null;
}

function trimPiano(filename) {
  const src = path.join(BASE, 'piano', filename);
  if (!fs.existsSync(src)) { console.log('SKIP (not found):', filename); return; }
  const buf = fs.readFileSync(src);

  const fmt = findChunk(buf, 'fmt ');
  const data = findChunk(buf, 'data');
  if (!fmt || !data) { console.log('SKIP (bad format):', filename); return; }

  const numCh = buf.readUInt16LE(fmt.offset + 2);
  const sr = buf.readUInt32LE(fmt.offset + 4);
  const bps = buf.readUInt16LE(fmt.offset + 14);
  const bytesPerFrame = numCh * (bps / 8);

  // Read raw samples, convert to mono float
  const totalFrames = data.size / bytesPerFrame;
  const trimFrames = Math.min(Math.floor(sr * TRIM_SEC), totalFrames);
  const mono = new Float32Array(trimFrames);

  for (let i = 0; i < trimFrames; i++) {
    let sum = 0;
    for (let ch = 0; ch < numCh; ch++) {
      const off = data.offset + i * bytesPerFrame + ch * (bps / 8);
      if (bps === 24) {
        let val = (buf[off] | (buf[off+1] << 8) | (buf[off+2] << 16));
        if (val & 0x800000) val |= ~0xFFFFFF; // sign extend
        sum += val / 8388608;
      } else if (bps === 16) {
        sum += buf.readInt16LE(off) / 32768;
      }
    }
    mono[i] = sum / numCh;
  }

  // Simple downsample from sr to OUT_SR
  const outFrames = Math.floor(trimFrames * OUT_SR / sr);
  const out16 = Buffer.alloc(outFrames * 2);
  for (let i = 0; i < outFrames; i++) {
    const srcIdx = (i * sr / OUT_SR);
    const idx = Math.min(Math.floor(srcIdx), trimFrames - 1);
    let val = Math.max(-1, Math.min(1, mono[idx]));
    out16.writeInt16LE(Math.round(val * 32767), i * 2);
  }

  // Write WAV
  writeWav(path.join(OUT, 'piano', filename), out16, OUT_SR, 1, 16);
  const origKB = Math.round(buf.length / 1024);
  const newKB = Math.round((44 + out16.length) / 1024);
  console.log(`Piano: ${filename} ${origKB}KB → ${newKB}KB (${Math.round(newKB/origKB*100)}%)`);
}

function trimRhodes(filename) {
  const src = path.join(BASE, 'rhodes', filename);
  if (!fs.existsSync(src)) { console.log('SKIP (not found):', filename); return; }
  const buf = fs.readFileSync(src);

  const fmt = findChunk(buf, 'fmt ');
  const data = findChunk(buf, 'data');
  if (!fmt || !data) { console.log('SKIP (bad format):', filename); return; }

  const format = buf.readUInt16LE(fmt.offset);
  const numCh = buf.readUInt16LE(fmt.offset + 2);
  const sr = buf.readUInt32LE(fmt.offset + 4);
  const bps = buf.readUInt16LE(fmt.offset + 14);
  const bytesPerFrame = numCh * (bps / 8);

  const totalFrames = data.size / bytesPerFrame;
  const trimFrames = Math.min(Math.floor(sr * TRIM_SEC), totalFrames);
  const mono = new Float32Array(trimFrames);

  for (let i = 0; i < trimFrames; i++) {
    let sum = 0;
    for (let ch = 0; ch < numCh; ch++) {
      const off = data.offset + i * bytesPerFrame + ch * (bps / 8);
      if (format === 3) { // float
        sum += buf.readFloatLE(off);
      } else if (bps === 16) {
        sum += buf.readInt16LE(off) / 32768;
      } else if (bps === 24) {
        let val = (buf[off] | (buf[off+1] << 8) | (buf[off+2] << 16));
        if (val & 0x800000) val |= ~0xFFFFFF;
        sum += val / 8388608;
      }
    }
    mono[i] = sum / numCh;
  }

  // Downsample
  const outFrames = Math.floor(trimFrames * OUT_SR / sr);
  const out16 = Buffer.alloc(outFrames * 2);
  for (let i = 0; i < outFrames; i++) {
    const srcIdx = (i * sr / OUT_SR);
    const idx = Math.min(Math.floor(srcIdx), trimFrames - 1);
    let val = Math.max(-1, Math.min(1, mono[idx]));
    out16.writeInt16LE(Math.round(val * 32767), i * 2);
  }

  writeWav(path.join(OUT, 'rhodes', filename), out16, OUT_SR, 1, 16);
  const origKB = Math.round(buf.length / 1024);
  const newKB = Math.round((44 + out16.length) / 1024);
  console.log(`Rhodes: ${filename} ${origKB}KB → ${newKB}KB (${Math.round(newKB/origKB*100)}%)`);
}

function writeWav(filepath, data, sr, ch, bps) {
  const header = Buffer.alloc(44);
  const dataLen = data.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(ch, 22);
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * ch * (bps/8), 28);
  header.writeUInt16LE(ch * (bps/8), 32);
  header.writeUInt16LE(bps, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  fs.writeFileSync(filepath, Buffer.concat([header, data]));
}

console.log('=== Trimming Piano Samples ===');
PIANO_FILES.forEach(trimPiano);
console.log('\n=== Trimming Rhodes Samples ===');
RHODES_FILES.forEach(trimRhodes);
console.log('\nDone!');
