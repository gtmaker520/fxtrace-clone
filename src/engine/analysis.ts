// SPDX-License-Identifier: Apache-2.0
// engine/analysis.ts — THD 分类与频响特征剖面
// （提取自原 clone-pedal.ts；谐波阶次分解为 P2 方向）
// 声明：原实现为作者本人（GTMaker）自研项目 Guitar-X 中的自有代码，非第三方开源代码，本文件为作者自主改编。

import type { FreqProfile } from './types';

export type DistortionType = 'soft' | 'hard' | 'none';

/** THD 分类阈值：>1% 软削波，>10% 硬削波 */
export function classifyDistortion(thd: number): DistortionType {
  if (thd > 0.1) return 'hard';
  if (thd > 0.01) return 'soft';
  return 'none';
}

/** 从 FFT 峰值谱计算 THD（2-10 次谐波 / 基波），freq = 激励频率 */
export function computeThdFromPeaks(
  peak: Float32Array,
  sampleRate: number,
  fftSize: number,
  freq: number
): number {
  const freqStep = sampleRate / fftSize;
  let fundAmp = 0;
  let thdNum = 0;

  for (let i = 1; i < peak.length; i++) {
    const f = i * freqStep;
    if (Math.abs(f - freq) < freqStep) {
      fundAmp = Math.pow(10, peak[i] / 20);
    }
  }
  for (let h = 2; h <= 10; h++) {
    const hf = freq * h;
    for (let i = 1; i < peak.length; i++) {
      const f = i * freqStep;
      if (Math.abs(f - hf) < freqStep * 1.5) {
        const harmonic = Math.pow(10, peak[i] / 20);
        thdNum += harmonic * harmonic;
      }
    }
  }
  return fundAmp > 0 ? Math.sqrt(thdNum) / fundAmp : 0;
}

/**
 * 频响特征剖面：把频响按 bass(<200Hz)/mid(<3kHz)/treble(<8kHz)/presence(>8kHz)
 * 四段取平均，作为选型引擎的输入特征。
 */
export function analyzeFreqProfile(freqs: Float32Array, response: Float32Array): FreqProfile {
  let bass = 0, bassN = 0;
  let mid = 0, midN = 0;
  let treble = 0, trebleN = 0;
  let presence = 0, presenceN = 0;

  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    const db = response[i];
    if (f < 200) { bass += db; bassN++; }
    else if (f < 3000) { mid += db; midN++; }
    else if (f < 8000) { treble += db; trebleN++; }
    else { presence += db; presenceN++; }
  }

  return {
    bass: bassN > 0 ? bass / bassN : 0,
    mid: midN > 0 ? mid / midN : 0,
    treble: trebleN > 0 ? treble / trebleN : 0,
    presence: presenceN > 0 ? presence / presenceN : 0,
  };
}

/** 变幅噪声动态分析：levels 为分段 RMS，映射到压缩比 1..10（原实现粗糙，P2 改进） */
export function computeDynamicRatio(levels: number[]): { ratio: number; threshold: number } {
  let ratio = 1;
  let threshold = 0.15;
  const sorted = levels.slice().sort((a, b) => a - b);
  const top = sorted.slice(-10);
  const bot = sorted.slice(0, 10);
  const avgTop = top.reduce((s, v) => s + v, 0) / top.length;
  const avgBot = bot.reduce((s, v) => s + v, 0) / bot.length;

  if (avgTop > 0.01 && avgBot > 0.01) {
    const range = 20 * Math.log10(avgTop / avgBot);
    if (range > 1) {
      ratio = Math.max(1, Math.min(10, 1 + range / 6));
      threshold = avgBot * 1.5;
    }
  }
  return { ratio, threshold };
}
