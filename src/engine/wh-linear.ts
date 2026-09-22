// SPDX-License-Identifier: Apache-2.0
// engine/wh-linear.ts — 线性部分估计：从多电平扫频频响提取预/后滤波器
// （低电平扫频 ≈ 线性区响应 → pre-filter；高低电平频响差 ≈ 非线性引起的音调变化 → post-filter 近似）
// 声明：本文件为作者本人（GTMaker）原创实现，非第三方开源代码。

import type { BiquadCoeffs } from './wh-model';

/** 简单 Biquad（peaking）频响计算：给定频点 f 与采样率，返回增益（线性） */
export function biquadMagnitudeAt(coeffs: BiquadCoeffs, f: number, sr: number): number {
  const w = 2 * Math.PI * f / sr;
  const { b0, b1, b2, a0, a1, a2 } = coeffs;
  // H(z) = (b0 + b1 z^-1 + b2 z^-2) / (a0 + a1 z^-1 + a2 z^-2), z = e^{jw}
  const reN = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w);
  const imN = -(b1 * Math.sin(w) + b2 * Math.sin(2 * w));
  const reD = a0 + a1 * Math.cos(w) + a2 * Math.cos(2 * w);
  const imD = -(a1 * Math.sin(w) + a2 * Math.sin(2 * w));
  const num = Math.hypot(reN, imN);
  const den = Math.hypot(reD, imD) || 1e-12;
  return num / den;
}

export interface LinearStageFit {
  /** Biquad 系数（Web Audio AudioBufferSourceNode filter 用） */
  coeffs: BiquadCoeffs;
  /** 拟合 RMSE（dB） */
  rmseDb: number;
}

/**
 * 从频响曲线拟合单个 peaking Biquad（贪心三点法）：
 * 1) 找最大峰/谷作为主提升点（freq/gain 直接读出，Q 由峰宽估计）
 * 2) 用频域响应与目标残差验证
 * 适合 WH 的 pre/post 各一个滤波器的精度级别。
 */
export function fitPeakingBiquad(
  freqs: Float32Array,
  responseDb: Float32Array,
  sr: number
): LinearStageFit {
  // 归一化：去掉整体电平，让滤波器只负责形状
  let mean = 0;
  for (let i = 0; i < responseDb.length; i++) mean += responseDb[i];
  mean /= Math.max(1, responseDb.length);
  const norm = new Float32Array(responseDb.length);
  for (let i = 0; i < responseDb.length; i++) norm[i] = responseDb[i] - mean;

  // 找最显著的峰或谷
  let extIdx = 0;
  let extVal = 0;
  for (let i = 1; i < norm.length - 1; i++) {
    if (Math.abs(norm[i]) > Math.abs(extVal)) { extVal = norm[i]; extIdx = i; }
  }

  // 频率轴均匀（log 域）假设：用峰宽估计 Q —— 找幅度降到峰值一半的两点
  const f0 = freqs[extIdx];
  let fLo = freqs[0], fHi = freqs[freqs.length - 1];
  const half = Math.abs(extVal) / 2;
  for (let i = extIdx; i > 0; i--) {
    if (Math.abs(norm[i]) < half) { fLo = freqs[i]; break; }
  }
  for (let i = extIdx; i < freqs.length - 1; i++) {
    if (Math.abs(norm[i]) < half) { fHi = freqs[i]; break; }
  }
  // Q = f0 / (fHi - fLo)，限制在合理范围
  const bw = Math.max(fHi - fLo, f0 * 0.1);
  const Q = Math.min(10, Math.max(0.3, f0 / bw));

  // peaking Biquad（RBJ cookbook）
  const A = Math.pow(10, extVal / 40); // dB → 线性幅度（峰）
  const w0 = 2 * Math.PI * f0 / sr;
  const alpha = Math.sin(w0) / (2 * Q);

  const b0 = 1 + alpha * A;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;

  // RMSE 验证
  const coeffs: BiquadCoeffs = { b0, b1, b2, a0, a1, a2 };
  let sqErr = 0, count = 0;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    if (f <= 0 || f >= sr / 2) continue;
    const mag = biquadMagnitudeAt(coeffs, f, sr);
    const magDb = 20 * Math.log10(Math.max(mag, 1e-6));
    sqErr += (magDb - norm[i]) * (magDb - norm[i]);
    count++;
  }
  const rmseDb = count > 0 ? Math.sqrt(sqErr / count) : 0;

  return { coeffs, rmseDb };
}

/**
 * WH 线性部分估计：
 * - pre-filter：最低电平档频响（设备近似线性区 → 最接近纯线性响应）
 * - post-filter：最高电平与最低电平频响的差（非线性工作区引起的音调偏移，近似为后级滤波）
 */
export function estimateWHLinearStages(
  sweeps: Array<{ level: number; freqs: Float32Array; response: Float32Array }>,
  sr: number
): { pre: LinearStageFit; post: LinearStageFit } {
  if (sweeps.length < 2) {
    return {
      pre: { coeffs: { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 }, rmseDb: 0 },
      post: { coeffs: { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 }, rmseDb: 0 },
    };
  }

  // 按电平排序
  const sorted = sweeps.slice().sort((a, b) => a.level - b.level);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];

  // pre-filter：低电平档（线性区）
  const pre = fitPeakingBiquad(low.freqs, low.response, sr);

  // post-filter：高-低电平频响差（dB 域相减）
  const diffResp = new Float32Array(low.response.length);
  for (let i = 0; i < low.response.length; i++) {
    diffResp[i] = high.response[i] - low.response[i];
  }
  const post = fitPeakingBiquad(low.freqs, diffResp, sr);

  return { pre, post };
}
