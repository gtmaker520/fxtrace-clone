// SPDX-License-Identifier: Apache-2.0
// audio/wh-capture.ts — 多电平扫频采集器：W-H 模型的数据采集入口
// 用 3 档输入电平重复扫频，采集每档下的增益-输出曲线（用于反解 WH 非线性）
// 声明：本文件为作者本人（GTMaker）原创实现，非第三方开源代码。

import { getAudioContext, playAndCapturePeaks, renderSweepBuffer, captureBaseline } from './io';
import { extractValidBins, calibrateResponse, SWEEP_GAIN } from '../engine/measurement';
import type { SweepPeaks } from '../engine/measurement';
import { computeThdFromPeaks } from '../engine/analysis';

/** 多电平扫频采集结果 */
export interface WHCaptureResult {
  /** 各档输入电平对应的频响（基线校准后） */
  sweeps: Array<{ level: number; freqs: Float32Array; response: Float32Array }>;
  /** 基线（不接设备直通扫频） */
  baseline: SweepPeaks;
  /** 各档 THD（用于辅助判断非线性强度） */
  thdLevels: number[];
}

/** P3② 多电平扫频采集：3 档输入电平重复扫频 → 基线校准后的频响曲线 */
export async function captureWHSweeps(
  levels: number[] = [SWEEP_GAIN * 0.3, SWEEP_GAIN, SWEEP_GAIN * 2] // 约 -10dB, 0dB, +6dB 相对基准
): Promise<WHCaptureResult> {
  const ctx = getAudioContext();
  if (!ctx) throw new Error('音频上下文不可用');

  // 1. 先采集基线（不接设备直通）
  const baseline = await captureBaseline(ctx);

  // 2. 接上设备后，对每档电平重复扫频
  const sweeps: WHCaptureResult['sweeps'] = [];
  for (const amp of levels) {
    const sweepBuf = await renderSweepBuffer(ctx, amp);
    const measured = await captureSweepPeaksWithBuffer(ctx, sweepBuf);
    const calibrated = calibrateResponse(measured, baseline);
    sweeps.push({ level: amp, freqs: calibrated.freqs, response: calibrated.response });
  }

  // 3. 同档位顺带测 THD（用 440Hz 正弦），辅助判断非线性强度
  const thdLevels = await captureTHDPerLevel(ctx, levels);

  return { sweeps, baseline, thdLevels };
}

/** 捕获单次扫频峰值 */
async function captureSweepPeaksWithBuffer(ctx: AudioContext, sweepBuf: AudioBuffer) {
  const peak = await playAndCapturePeaks(ctx, sweepBuf, 4096, 0);
  return extractValidBins(peak, ctx.sampleRate, 4096);
}

/** 每档电平下测 440Hz THD */
async function captureTHDPerLevel(ctx: AudioContext, levels: number[]): Promise<number[]> {
  const thds: number[] = [];
  for (const amp of levels) {
    const sr = ctx.sampleRate;
    const dur = 1;
    const freq = 440;
    const len = Math.floor(sr * dur);
    const offline = new OfflineAudioContext(1, len, sr);
    const osc = offline.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = offline.createGain();
    g.gain.value = amp;
    osc.connect(g);
    g.connect(offline.destination);
    osc.start(0);
    osc.stop(dur);
    const buf = await offline.startRendering();

    const peak = await playAndCapturePeaks(ctx, buf, 4096, 0);
    thds.push(computeThdFromPeaks(peak, sr, 4096, freq));
  }
  return thds;
}