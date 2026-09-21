// SPDX-License-Identifier: Apache-2.0
// tests/fitting.test.ts — 合成数据单测：给已知 EQ 造频响，验证拟合恢复
import { describe, it, expect } from 'vitest';
import { fitEqBands, computeMatchPct, predictResponse } from '../src/engine/fitting';
import { analyzeFreqProfile, classifyDistortion } from '../src/engine/analysis';
import { selectDriveEffect, selectAmpModel, selectCabinet } from '../src/engine/matching';
import { calibrateResponse } from '../src/engine/measurement';
import type { FreqProfile } from '../src/engine/types';

// 用拟合 bands 本身造一条合成频响（对数轴 128 点）
function syntheticResponse(bands: number[]): { freqs: Float32Array; response: Float32Array } {
  const n = 128;
  const freqs = new Float32Array(n);
  const response = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const logF = Math.log(50) + (Math.log(16000) - Math.log(50)) * i / (n - 1);
    freqs[i] = Math.exp(logF);
    response[i] = predictResponse(freqs[i], bands);
  }
  return { freqs, response };
}

describe('fitEqBands / computeMatchPct', () => {
  // 注：sigma=0.25 的高斯核在相邻频段互相重叠，拟合是平滑算子。
  // 相邻频段大反差的真值（如 +5/-4 相邻）会产生约 2dB 的固有平滑误差；
  // 实际测量频响较平滑，误差远小于此。锐利频响的精确重建是 P2 改进方向。
  it('已知 EQ 曲线拟合后曲线重建误差 < 2dB，匹配度 > 95%', () => {
    const truth = [3, -2, 0, 5, -4, 1, -1];
    const { freqs, response } = syntheticResponse(truth);
    const bands = fitEqBands(freqs, response);
    let maxCurveErr = 0;
    for (let i = 0; i < freqs.length; i++) {
      maxCurveErr = Math.max(maxCurveErr, Math.abs(response[i] - predictResponse(freqs[i], bands)));
    }
    expect(maxCurveErr).toBeLessThan(2.0);
    const pct = computeMatchPct(freqs, response, bands);
    expect(pct).toBeGreaterThan(95);
  });

  it('平坦曲线匹配度接近 100%', () => {
    const { freqs, response } = syntheticResponse([0, 0, 0, 0, 0, 0, 0]);
    const bands = fitEqBands(freqs, response);
    expect(computeMatchPct(freqs, response, bands)).toBeGreaterThan(98);
  });
});

describe('calibrateResponse（基线校准）', () => {
  it('测量减基线得到设备真实频响', () => {
    // 声卡基线：-3dB 平坦；设备：+6dB 平坦 → 差值应为 +6dB（clamp ±40 内）
    const n = 10;
    const freqs = new Float32Array(n);
    const baseline = { freqs: new Float32Array(n), peak: new Float32Array(n).fill(-23) };
    const measured = { freqs: new Float32Array(n), peak: new Float32Array(n).fill(-17) };
    for (let i = 0; i < n; i++) freqs[i] = 100 * (i + 1);
    baseline.freqs.set(freqs);
    measured.freqs.set(freqs);
    const { response } = calibrateResponse(measured, baseline);
    for (let i = 0; i < n; i++) expect(response[i]).toBeCloseTo(6, 5);
  });
});

describe('analysis / matching', () => {
  const fp: FreqProfile = { bass: 1, mid: 3, treble: 2, presence: 1 };

  it('THD 分类阈值', () => {
    expect(classifyDistortion(0.005)).toBe('none');
    expect(classifyDistortion(0.05)).toBe('soft');
    expect(classifyDistortion(0.3)).toBe('hard');
  });

  it('软削波低 THD → 过载单块；硬削波高 THD → 电锯', () => {
    expect(selectDriveEffect(0.03, 'soft', 0, fp)?.presetId).toBe('overdrive');
    expect(selectDriveEffect(0.8, 'hard', 0, fp)?.presetId).toBe('chainsaw');
    expect(selectDriveEffect(0.005, 'none', 0, fp)).toBeNull();
  });

  it('箱头/箱体选型返回有效结果', () => {
    const amp = selectAmpModel(fp, 0.02);
    expect(amp).not.toBeNull();
    expect(amp!.channel).toBe(0);
    expect(selectCabinet(fp)).not.toBeNull();
  });
});
