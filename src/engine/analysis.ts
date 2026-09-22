// SPDX-License-Identifier: Apache-2.0
// engine/analysis.ts — THD 分类与频响特征剖面
// 声明：本文件为作者本人（GTMaker）原创实现，非第三方开源代码。

import type { FreqProfile } from './types';

export type DistortionType = 'soft' | 'hard' | 'none';

/** 削波拓扑：偶次为主（非对称电路） / 奇次为主（对称电路） / 无失真 */
export type ClipTopology = 'even' | 'odd' | 'none';

export interface HarmonicDecomposition {
  /** THD（2-10 次谐波 / 基波） */
  thd: number;
  /** 偶次谐波能量占比 (0..1)，thd=0 时为 0.5 */
  evenRatio: number;
  /** 削波拓扑分类 */
  topology: ClipTopology;
}

/**
 * 谐波阶次分解（P2①）：按 2f/3f/4f… 分解峰值谱，
 * 偶次能量占比区分非对称削波（2f 强 → TS/Fender 风）与对称削波（3f 强 → RAT/Mesa 风）。
 * 分类阈值 0.6/0.4：偶次占比 >60% 判偶次拓扑，<40% 判奇次拓扑。
 */
export function decomposeHarmonics(
  peak: Float32Array,
  sampleRate: number,
  fftSize: number,
  freq: number
): HarmonicDecomposition {
  const freqStep = sampleRate / fftSize;
  let fundAmp = 0;
  let evenE = 0, oddE = 0;

  const binAt = (f: number): number => {
    // 取容差范围内幅度最大的 bin（扫到邻 bin 时噪声底远低于谐波，取 max 才稳）
    let best = 0;
    for (let i = 1; i < peak.length; i++) {
      if (Math.abs(i * freqStep - f) < freqStep * 1.5) {
        const a = Math.pow(10, peak[i] / 20);
        if (a > best) best = a;
      }
    }
    return best;
  };

  fundAmp = binAt(freq);
  for (let h = 2; h <= 10; h++) {
    const a = binAt(freq * h);
    if (h % 2 === 0) evenE += a * a; else oddE += a * a;
  }

  const thd = fundAmp > 0 ? Math.sqrt(evenE + oddE) / fundAmp : 0;
  const total = evenE + oddE;
  const evenRatio = total > 0 ? evenE / total : 0.5;

  let topology: ClipTopology = 'none';
  if (thd > 0.01) {
    topology = evenRatio > 0.6 ? 'even' : evenRatio < 0.4 ? 'odd' : 'even'; // 中间带默认偶次（更常见的单块拓扑）
  }
  return { thd, evenRatio, topology };
}

/** THD 分类阈值：>1% 软削波，>10% 硬削波 */
export function classifyDistortion(thd: number): DistortionType {
  if (thd > 0.1) return 'hard';
  if (thd > 0.01) return 'soft';
  return 'none';
}

/**
 * P2② 多电平扫频反解 drive（纯逻辑）：
 * 对同一设备用 3 档递增电平（如 0.1/0.2/0.4）测量 THD。
 * 失真度随激励电平的增长率反映前级增益（drive）：
 *   - 直通/低增益：各档 THD 基本不变（线性系统 THD 与电平无关）
 *   - 高 drive：电平翻倍 → THD 大幅上升（更快进入削波区）
 * 用最低档与最高档的 THD 比值估计增益系数，映射到 drive 0..1：
 *   growth = thdHigh / max(thdLow, 1e-4)
 *   drive  = clamp(log2(growth) / 4, 0, 1)   （growth=1→0，16 倍→1）
 * 同时返回各档电平下的 THD 供 UI 展示。thdLevels 与 levels 一一对应。
 */
export interface DriveReversal {
  /** 反解出的 drive 0..1（0=无法反解或无失真） */
  drive: number;
  /** 是否成功反解（需要至少 2 档有效数据且最高档 THD>1%） */
  ok: boolean;
  /** growth = thdHigh/thdLow（≥1） */
  growth: number;
}

export function solveDriveFromLevels(levels: number[], thdLevels: number[]): DriveReversal {
  const n = Math.min(levels.length, thdLevels.length);
  if (n < 2) return { drive: 0, ok: false, growth: 1 };

  // levels 升序排列假设由调用方保证；取最低/最高两档
  const thdLow = thdLevels[0];
  const thdHigh = thdLevels[n - 1];

  if (thdHigh < 0.01) return { drive: 0, ok: false, growth: 1 };
  const growth = thdHigh / Math.max(thdLow, 1e-4);
  // growth≈1（THD 不随电平增长）= 线性或与电平无关的失真，无法反解 drive
  if (growth < 1.5) return { drive: 0, ok: false, growth };
  const drive = Math.max(0, Math.min(1, Math.log2(growth) / 4));
  return { drive, ok: true, growth };
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

/**
 * 变幅噪声动态分析（P2④ 物理映射）：
 * 激励的输入调制范围是已知的——幅度 0.3×(1±0.8)，即 0.06→0.54（约 19dB）。
 * 压缩比 = 输入动态范围 / 实测输出动态范围（dB 相除）：
 *   直通设备输出范围≈输入范围 → ratio≈1（无压缩）；
 *   压缩器把输出压到 1/4 → ratio≈4。
 * 替代原 "1 + range/6" 经验线性映射。levels 为输出端分段 RMS。
 */
export function computeDynamicRatio(levels: number[]): { ratio: number; threshold: number } {
  // 输入激励的调制范围（与 audio/io.ts captureDynamicLevels 的生成公式保持一致）
  const INPUT_RANGE_DB = 20 * Math.log10(1.8 / 0.2); // ≈ 19.1dB

  let ratio = 1;
  let threshold = 0.15;
  const sorted = levels.slice().sort((a, b) => a - b);
  const top = sorted.slice(-10);
  const bot = sorted.slice(0, 10);
  const avgTop = top.reduce((s, v) => s + v, 0) / top.length;
  const avgBot = bot.reduce((s, v) => s + v, 0) / bot.length;

  if (avgTop > 0.01 && avgBot > 0.01) {
    const outRange = 20 * Math.log10(avgTop / avgBot);
    if (outRange > 1) {
      // 输出范围被压得越小，压缩比越大；上限 20（常见压缩器极限）
      ratio = Math.max(1, Math.min(20, INPUT_RANGE_DB / outRange));
      threshold = avgBot * 1.5;
    }
  }
  return { ratio, threshold };
}

/**
 * 前级增益自适应（P2 补强）：根据实测输入电平计算单块前级增益。
 * 目标：dist=1 时信号达削波阈值 th 的 2.5 倍过驱动（真实高增益单块量级），
 * dist 线性缩小过驱动倍数；输入越弱增益越高，替代固定系数标定。
 * @param inputRms 实测输入电平（线性 RMS，来自 detectInputSignal）
 * @param drive 失真度 0-1
 * @param th 削波阈值（与曲线 builder 一致，如 metal 满驱动 0.18）
 * @returns 前级增益（倍数），限制在 [1, 80] 防爆音
 */
export function computeDriveGain(inputRms: number, drive: number, th = 0.18): number {
  const rms = Math.max(inputRms, 1e-4); // 防除零
  const overdrive = 1 + drive * 1.5; // dist=1 → 2.5×过驱动
  const gain = (overdrive * th) / rms;
  return Math.min(80, Math.max(1, gain));
}
