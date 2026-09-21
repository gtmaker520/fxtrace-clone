// SPDX-License-Identifier: Apache-2.0
// engine/measurement.ts — 扫频生成与基线校准的纯逻辑部分
// （提取自原 clone-pedal.ts；WebAudio I/O 部分见 audio/io.ts）
// 声明：原实现为作者本人（GTMaker）自研项目 Guitar-X 中的自有代码，非第三方开源代码，本文件为作者自主改编。

export const SWEEP_DURATION = 2;
export const SWEEP_FFT = 4096;
export const SWEEP_GAIN = 0.3;
export const FREQ_MIN = 20;
export const FREQ_MAX = 20000;

export interface SweepPeaks {
  freqs: Float32Array;
  peak: Float32Array;
}

/**
 * 从分析器峰值采集中提取 20Hz-20kHz、有效（> -100dB）的频点。
 * binHz = sampleRate / fftSize。
 */
export function extractValidBins(
  peak: Float32Array,
  sampleRate: number,
  fftSize: number
): SweepPeaks {
  const freqStep = sampleRate / fftSize;
  const freqs: number[] = [];
  const vals: number[] = [];
  for (let i = 2; i < peak.length - 1; i++) {
    const f = i * freqStep;
    if (f < FREQ_MIN || f > FREQ_MAX) continue;
    if (peak[i] <= -100) continue;
    freqs.push(f);
    vals.push(peak[i]);
  }
  return { freqs: new Float32Array(freqs), peak: new Float32Array(vals) };
}

/**
 * 基线校准：测量值减去声卡 I/O 自身频响，得到被测设备的真实频响。
 * 频率对齐容差 15%（基线与测量的 FFT bin 可能略有不同），结果 clamp 到 ±40dB。
 */
export function calibrateResponse(measured: SweepPeaks, baseline: SweepPeaks): { freqs: Float32Array; response: Float32Array } {
  const freqs: number[] = [];
  const response: number[] = [];
  let bIdx = 0;
  for (let i = 0; i < measured.freqs.length; i++) {
    const f = measured.freqs[i];
    while (bIdx < baseline.freqs.length - 1 && Math.abs(baseline.freqs[bIdx + 1] - f) < Math.abs(baseline.freqs[bIdx] - f)) {
      bIdx++;
    }
    if (Math.abs(baseline.freqs[bIdx] - f) > f * 0.15) continue;
    const diff = measured.peak[i] - baseline.peak[bIdx];
    freqs.push(f);
    response.push(Math.max(-40, Math.min(40, diff)));
  }
  return { freqs: new Float32Array(freqs), response: new Float32Array(response) };
}
