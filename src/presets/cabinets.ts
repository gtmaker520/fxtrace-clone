// SPDX-License-Identifier: Apache-2.0
// presets/cabinets.ts — 箱体 IR 程序生成（最小相位合成 + 基2 FFT）
// 声明：本文件为作者本人（GTMaker）原创实现，非第三方开源代码。

export const CAB_VARIANTS = [
  { id: 0, short: 'V30', name: '英式经典', cab: '4x12 闭背', note: '2-3kHz 临场鼻音峰' },
  { id: 1, short: 'GB', name: '暖暗平滑', cab: '4x12 闭背', note: '5kHz 起自然滚降' },
  { id: 2, short: 'T75', name: '中频凹陷', cab: '4x12 闭背', note: '低音深紧' },
  { id: 3, short: 'H30', name: '中性均衡', cab: '4x12 闭背', note: '上中频略亮' },
  { id: 4, short: 'FDR', name: '美式单扬', cab: '开背', note: '低频薄、人声中频削减、高频亮' },
  { id: 5, short: 'AC30', name: '英式清亮', cab: '2x12 开背', note: '清亮 chime、高频延展' },
];

interface CabPreset {
  dur: number; bodyDb: number; bodyF: number; bodyW: number;
  body2Db?: number; body2F?: number; body2W?: number;
  scoopDb: number; scoopF?: number;
  presDb: number; presF: number; rollF: number; rollSlope: number;
}

// 基2 FFT（原地、迭代蝶形）。用于箱体 IR 的最小相位合成。
function _cabFFT(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// 箱体目标幅度（英式 4x12 近场麦克风风格）
function _cabTargetMag(f: number, p: CabPreset) {
  const loCut = 55;
  let g = 1 / (1 + Math.exp(-(f - loCut) / 20));
  g *= 1 + (p.bodyDb - 1) * Math.exp(-Math.pow(Math.log(f / p.bodyF) / Math.log(p.bodyW), 2));
  if (p.body2Db) g *= 1 + (p.body2Db - 1) * Math.exp(-Math.pow(Math.log(f / (p.body2F || p.bodyF)) / Math.log(p.body2W || p.bodyW), 2));
  g *= 1 - p.scoopDb * Math.exp(-Math.pow(Math.log(f / (p.scoopF || 480)) / 0.55, 2));
  g *= 1 + (p.presDb - 1) * Math.exp(-Math.pow(Math.log(f / p.presF) / 0.5, 2));
  if (f > p.rollF) g *= Math.pow(p.rollF / f, p.rollSlope);
  return g;
}

// 最小相位合成（倒谱法）
function _makeMinPhaseCabIR(sr: number, N: number, p: CabPreset) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 0; k <= N / 2; k++) {
    const f = k * sr / N;
    re[k] = Math.log(Math.max(_cabTargetMag(f, p), 1e-12));
  }
  for (let k = 1; k < N / 2; k++) re[N - k] = re[k];
  _cabFFT(re, im, true);
  for (let i = 0; i < N; i++) {
    if (i > 0 && i < N / 2) re[i] *= 2; else if (i > N / 2) re[i] = 0;
    im[i] = 0;
  }
  _cabFFT(re, im, false);
  for (let i = 0; i < N; i++) {
    const m = Math.exp(re[i]), ph = im[i];
    re[i] = m * Math.cos(ph); im[i] = m * Math.sin(ph);
  }
  _cabFFT(re, im, true);
  const ir = new Float32Array(N);
  let energy = 0;
  for (let i = 0; i < N; i++) {
    const v = re[i] * Math.exp(-i / sr * 30);
    ir[i] = v; energy += v * v;
  }
  if (energy > 0) { const s = Math.sqrt(0.6 / energy); for (let i = 0; i < N; i++) ir[i] *= s; }
  return ir;
}

const CAB_PRESETS: CabPreset[] = [
  { dur: 0.09, bodyDb: 1.85, bodyF: 130, bodyW: 2.0, body2Db: 1.3, body2F: 300, body2W: 1.9, scoopDb: 0.32, scoopF: 700, presDb: 1.5, presF: 3500, rollF: 4200, rollSlope: 3.0 },
  { dur: 0.11, bodyDb: 1.7, bodyF: 90, bodyW: 1.9, body2Db: 1.15, body2F: 280, body2W: 1.7, scoopDb: 0.26, scoopF: 450, presDb: 1.18, presF: 3200, rollF: 3800, rollSlope: 3.6 },
  { dur: 0.10, bodyDb: 1.95, bodyF: 115, bodyW: 1.9, body2Db: 1.3, body2F: 250, body2W: 1.8, scoopDb: 0.44, scoopF: 600, presDb: 1.25, presF: 3800, rollF: 5000, rollSlope: 2.5 },
  { dur: 0.10, bodyDb: 1.5, bodyF: 110, bodyW: 1.9, body2Db: 1.25, body2F: 320, body2W: 1.8, scoopDb: 0.22, scoopF: 550, presDb: 1.45, presF: 3400, rollF: 5500, rollSlope: 2.3 },
  { dur: 0.06, bodyDb: 1.15, bodyF: 80, bodyW: 2.2, body2Db: 1.05, body2F: 250, body2W: 2.1, scoopDb: 0.3, scoopF: 650, presDb: 1.3, presF: 3000, rollF: 6500, rollSlope: 2.2 },
  { dur: 0.07, bodyDb: 1.4, bodyF: 95, bodyW: 2.0, body2Db: 1.15, body2F: 360, body2W: 1.9, scoopDb: 0.24, scoopF: 550, presDb: 1.5, presF: 3200, rollF: 8000, rollSlope: 1.7 }
];

// 程序生成箱体+麦克风 IR：纯线性响应，永远放在链路最后。
export function makeCabIR(ctx: AudioContext, variant: number): AudioBuffer {
  const p = CAB_PRESETS[variant % CAB_PRESETS.length];
  const sr = ctx.sampleRate;
  const N = Math.max(4096, 1 << Math.ceil(Math.log2(sr * p.dur)));
  const buf = ctx.createBuffer(2, N, sr);
  const ir = _makeMinPhaseCabIR(sr, N, p);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const k = ch === 1 ? 0.96 : 1;
    for (let i = 0; i < N; i++) d[i] = ir[i] * k;
  }
  return buf;
}

const _cabIrCache = new Map<string, AudioBuffer>();
function _cabCacheKey(ctx: AudioContext, variant: number): string {
  return ctx.sampleRate + ':' + (variant % CAB_PRESETS.length);
}
export function getCabIRCached(ctx: AudioContext, variant: number): AudioBuffer | null {
  return _cabIrCache.get(_cabCacheKey(ctx, variant)) || null;
}
export function setCabIRCached(ctx: AudioContext, variant: number, buf: AudioBuffer): void {
  _cabIrCache.set(_cabCacheKey(ctx, variant), buf);
}
export function getCabIR(ctx: AudioContext, variant: number): AudioBuffer {
  let buf = getCabIRCached(ctx, variant);
  if (!buf) {
    buf = makeCabIR(ctx, variant);
    setCabIRCached(ctx, variant, buf);
  }
  return buf;
}
