// SPDX-License-Identifier: Apache-2.0
// io/file-clone.ts — 音频文件克隆：从录音/歌曲选区提取音色特征
// 声明：本文件为作者本人（GTMaker）原创实现，非第三方开源代码。

import type { FreqProfile } from '../engine/types';
import { fitEqBands, computeMatchPct, computeDistortionMatchPct } from '../engine/fitting';
import { analyzeFreqProfile, classifyDistortion } from '../engine/analysis';
import { selectDriveEffect, selectAmpModel, selectCabinet } from '../engine/matching';
import type { CloneMode, CloneResult } from '../engine/types';

// ── 基2 FFT（原地、迭代蝶形） ──
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const uR = re[i + k], uI = im[i + k];
        const vR = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vI = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = uR + vR; im[i + k] = uI + vI;
        re[i + k + len / 2] = uR - vR; im[i + k + len / 2] = uI - vI;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/**
 * 选区频谱：Hann 窗 + 50% 重叠分段平均幅度谱，
 * 再在对数频率轴上高斯平滑到 128 个点。
 */
export function computeSpectrum(data: Float32Array, sr: number): { freqs: Float32Array; response: Float32Array } {
  const fftSize = 4096;
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const sum = new Float32Array(fftSize / 2);
  let count = 0;
  for (let offset = 0; offset + fftSize <= data.length; offset += fftSize / 2) {
    for (let i = 0; i < fftSize; i++) re[i] = (data[offset + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / fftSize));
    for (let i = 0; i < fftSize; i++) im[i] = 0;
    fftInPlace(re, im);
    for (let i = 0; i < fftSize / 2; i++) { sum[i] += Math.sqrt(re[i] * re[i] + im[i] * im[i]); }
    count++;
  }
  const rawDb = new Float32Array(fftSize / 2);
  const binHz = sr / fftSize;
  for (let i = 0; i < fftSize / 2; i++) { rawDb[i] = count > 0 ? 20 * Math.log10(Math.max(1e-10, sum[i] / count)) : -80; }

  const minHz = 50;
  const maxHz = Math.min(sr / 2, 16000);
  const nSmooth = 128;
  const logMin = Math.log(minHz);
  const logMax = Math.log(maxHz);
  const freqs = new Float32Array(nSmooth);
  const response = new Float32Array(nSmooth);
  for (let i = 0; i < nSmooth; i++) {
    const logF = logMin + (logMax - logMin) * i / (nSmooth - 1);
    freqs[i] = Math.exp(logF);
    const centerBin = Math.exp(logF) / binHz;
    const sigmaBins = centerBin * 0.35;
    let wSum = 0, vSum = 0;
    const lo = Math.max(1, Math.floor(centerBin - sigmaBins * 3));
    const hi = Math.min(fftSize / 2 - 1, Math.ceil(centerBin + sigmaBins * 3));
    for (let b = lo; b <= hi; b++) {
      const d = (b - centerBin) / Math.max(1, sigmaBins);
      const w = Math.exp(-0.5 * d * d);
      wSum += w;
      vSum += rawDb[b] * w;
    }
    response[i] = wSum > 0 ? vSum / wSum : -80;
  }
  return { freqs, response };
}

/**
 * 混音素材失真度估计：高频能量占比 / 频谱斜率 / Crest factor 三指标加权。
 * 混音中镲片/Hi-hat 会大幅抬高 hfRatio，调用方需按素材类型再缩放。
 */
export function estimateDistortion(data: Float32Array, sr: number): number {
  const n = Math.min(data.length, sr * 2);
  const fftSize = 4096;
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const mag = new Float32Array(fftSize / 2);
  let count = 0;
  for (let off = 0; off + fftSize <= n; off += fftSize / 2) {
    for (let i = 0; i < fftSize; i++) re[i] = (data[off + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / fftSize));
    for (let i = 0; i < fftSize; i++) im[i] = 0;
    fftInPlace(re, im);
    for (let i = 0; i < fftSize / 2; i++) mag[i] += Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    count++;
  }
  if (count > 0) for (let i = 0; i < fftSize / 2; i++) mag[i] /= count;

  const binHz = sr / fftSize;
  const eBand = (lo: number, hi: number) => {
    let e = 0;
    const loBin = Math.max(1, Math.floor(lo / binHz));
    const hiBin = Math.min(fftSize / 2 - 1, Math.ceil(hi / binHz));
    for (let i = loBin; i <= hiBin; i++) e += mag[i] * mag[i];
    return Math.sqrt(e);
  };
  const eLow = eBand(100, 500);
  const eMid = eBand(500, 2000);
  const eHi = eBand(2000, 8000);
  const eTotal = Math.sqrt(eLow * eLow + eMid * eMid + eHi * eHi) || 1;

  const hfRatio = eHi / eTotal;
  const tilt = eHi > 0 && eLow > 0 ? Math.log(eHi / eLow) : 0;

  let peak = 0, rms = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(data[i]);
    if (v > peak) peak = v;
    rms += data[i] * data[i];
  }
  rms = Math.sqrt(Math.max(1e-10, rms / n));
  const crest = rms > 0 ? peak / rms : 0;

  // hfRatio: 0.1=干净, 0.2=过载, 0.35+=失真
  const s1 = Math.max(0, Math.min(1, (hfRatio - 0.08) / 0.25));
  // tilt: -4=干净, -1.5=过载, 0+=高增益
  const s2 = Math.max(0, Math.min(1, (tilt + 3.5) / 3));
  // crest: 7=干净, 4=过载, 2=高增益
  const s3 = Math.max(0, Math.min(1, (7 - crest) / 4));

  return Math.min(0.95, s1 * 0.5 + s2 * 0.3 + s3 * 0.2);
}

export interface AudioCloneOptions {
  mode: CloneMode;
  /** 素材类型缩放系数（混音 0.45；纯吉他录音 1.0） */
  distortionScale?: number;
}

/**
 * 从音频选区（Float32 单声道）分析并匹配完整克隆结果。
 * 纯逻辑，无 DOM — demo 的 UI 只负责解码与选区。
 */
export function analyzeAudioSelection(sel: Float32Array, sr: number, opts: AudioCloneOptions): CloneResult {
  const { freqs, response } = computeSpectrum(sel, sr);
  const eqBands = fitEqBands(freqs, response);
  const matchPct = computeMatchPct(freqs, response, eqBands);
  const fp: FreqProfile = analyzeFreqProfile(freqs, response);

  let thd = 0;
  let distortionType: 'soft' | 'hard' | 'none' = 'none';
  let driveAmount = 0;
  if (opts.mode !== 'eq') {
    thd = estimateDistortion(sel, sr);
    // 混音中镲片/Hi-hat 大幅抬高 hfRatio，导致重型歌曲 THD 偏高
    // 缩放系数 0.45 使：干净~0.07, 流行~0.15, 摇滚~0.25, 金属~0.35, 极端~0.43
    thd = Math.min(0.7, thd * (opts.distortionScale ?? 0.45));
    distortionType = classifyDistortion(thd);
    driveAmount = thd * 30;
  }

  const matchedDrive = (opts.mode !== 'eq') ? selectDriveEffect(thd, distortionType, driveAmount, fp) : null;
  const matchedAmp = (opts.mode !== 'eq') ? selectAmpModel(fp, thd) : null;
  const matchedCab = (opts.mode === 'full') ? selectCabinet(fp) : null;

  // 失真特征匹配度（eq 模式不适用记 100；候选侧用实测特征自评，与向导路径同口径）
  const distortionMatchPct = opts.mode === 'eq' ? 100
    : computeDistortionMatchPct(
        { distortionType, thd, dynamicRatio: 1 },
        { distortionType, thd: Math.max(thd, 0.01), dynamicRatio: 1 }
      );

  return {
    mode: opts.mode,
    eqBands, matchPct, distortionMatchPct, distortionType, thd, driveAmount,
    levelDb: 0, dynamicRatio: 1, dynamicThreshold: 0.15,
    freqProfile: fp,
    matchedDrive, matchedAmp, matchedCab,
    rawResponse: { freqs: Array.from(freqs), response: Array.from(response) },
  };
}
