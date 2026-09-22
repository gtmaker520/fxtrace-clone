// SPDX-License-Identifier: Apache-2.0
// tests/fitting.test.ts — 合成数据单测：给已知 EQ 造频响，验证拟合恢复
import { describe, it, expect } from 'vitest';
import { fitEqBands, computeMatchPct, predictResponse } from '../src/engine/fitting';
import { classifyDistortion, decomposeHarmonics, computeDynamicRatio, solveDriveFromLevels } from '../src/engine/analysis';
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
  // 实际测量频响较平滑，误差远小于此。
  // 同样 ~1dB 平滑误差会按比例扣更多分，93% 即为该曲线的合理值。
  it('已知 EQ 曲线拟合后曲线重建误差 < 2dB，匹配度 > 90%（相对误差度量）', () => {
    const truth = [3, -2, 0, 5, -4, 1, -1];
    const { freqs, response } = syntheticResponse(truth);
    const bands = fitEqBands(freqs, response);
    let maxCurveErr = 0;
    for (let i = 0; i < freqs.length; i++) {
      maxCurveErr = Math.max(maxCurveErr, Math.abs(response[i] - predictResponse(freqs[i], bands)));
    }
    expect(maxCurveErr).toBeLessThan(2.0);
    const pct = computeMatchPct(freqs, response, bands);
    expect(pct).toBeGreaterThan(90);
  });

  it('P2③ 相对误差：平缓频响小误差高分，尖锐频响同等误差分数更低（有区分度）', () => {
    // 平缓曲线（±1dB 内）：拟合几乎无损 → 匹配度应接近 100
    const smooth = syntheticResponse([1, -0.5, 0.3, 0.8, -0.7, 0.4, -0.2]);
    const smoothBands = fitEqBands(smooth.freqs, smooth.response);
    const smoothPct = computeMatchPct(smooth.freqs, smooth.response, smoothBands);
    expect(smoothPct).toBeGreaterThan(95);

    // 尖锐曲线（±5dB 反差）经同等平滑后 → 分数应低于平缓曲线（分母变小）
    const sharp = syntheticResponse([5, -5, 5, -5, 5, -5, 5]);
    const sharpBands = fitEqBands(sharp.freqs, sharp.response);
    const sharpPct = computeMatchPct(sharp.freqs, sharp.response, sharpBands);
    expect(sharpPct).toBeLessThan(smoothPct);
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

describe('P2① 谐波阶次分解', () => {
  const sr = 48000, fftSize = 4096, freq = 440;
  const freqStep = sr / fftSize;
  const fp: FreqProfile = { bass: 1, mid: 3, treble: 2, presence: 1 };

  // 构造峰值谱（dB）：基波 0dB，谐波按幅度数组给定
  function makePeaks(harmonics: Record<number, number>): Float32Array {
    const peak = new Float32Array(fftSize / 2).fill(-120);
    peak[Math.round(freq / freqStep)] = 0;
    for (const [h, amp] of Object.entries(harmonics)) {
      peak[Math.round((freq * Number(h)) / freqStep)] = 20 * Math.log10(amp);
    }
    return peak;
  }

  it('偶次主导 → even 拓扑（2f 强 = 非对称削波）', () => {
    const hd = decomposeHarmonics(makePeaks({ 2: 0.2, 3: 0.03, 4: 0.05 }), sr, fftSize, freq);
    expect(hd.topology).toBe('even');
    expect(hd.evenRatio).toBeGreaterThan(0.6);
  });

  it('奇次主导 → odd 拓扑（3f 强 = 对称削波）', () => {
    const hd = decomposeHarmonics(makePeaks({ 2: 0.02, 3: 0.25, 5: 0.1 }), sr, fftSize, freq);
    expect(hd.topology).toBe('odd');
    expect(hd.evenRatio).toBeLessThan(0.4);
  });

  it('无失真 → none；THD 与传统公式一致', () => {
    const hd = decomposeHarmonics(makePeaks({}), sr, fftSize, freq);
    expect(hd.topology).toBe('none');
    // 2f=0.2, 3f=0.03 → THD ≈ sqrt(0.2²+0.03²) ≈ 0.202
    const hd2 = decomposeHarmonics(makePeaks({ 2: 0.2, 3: 0.03 }), sr, fftSize, freq);
    expect(hd2.thd).toBeCloseTo(Math.sqrt(0.2 * 0.2 + 0.03 * 0.03), 2);
  });

  it('拓扑接入选型：偶次软削波 → 非对称单块（过载），奇次 → 对称单块（黄色过载）', () => {
    const even = selectDriveEffect(0.05, 'soft', 0, fp, 'even');
    expect(even?.presetId).toBe('overdrive');
    const odd = selectDriveEffect(0.15, 'soft', 0, fp, 'odd');
    expect(odd?.presetId).toBe('klon');
    // 奇次硬削波 → 运放失真；偶次硬削波 → 二极管失真
    expect(selectDriveEffect(0.25, 'hard', 0, fp, 'odd')?.presetId).toBe('rat');
    expect(selectDriveEffect(0.25, 'hard', 0, fp, 'even')?.presetId).toBe('distortion');
  });
});

describe('P2④ 动态压缩比物理映射', () => {
  // 两档稳态电平（方波调制）：20 帧高、20 帧低，
  // top10/bot10 均值即真实高/低电平，测得范围无统计偏置
  function twoLevels(hi: number, lo: number): number[] {
    return Array.from({ length: 40 }, (_, i) => (i < 20 ? hi : lo));
  }

  it('直通设备（输出范围≈输入 19dB）→ 压缩比 ≈1', () => {
    // 输入调制 0.2→1.8 倍增益（0.06→0.54 RMS），直通输出同样范围
    const { ratio } = computeDynamicRatio(twoLevels(0.54, 0.06));
    expect(ratio).toBeLessThan(1.2);
  });

  it('4:1 压缩器（输出范围压到 ~1/4）→ 压缩比 ≈4', () => {
    // 输出范围 = 19.1dB / 4 ≈ 4.8dB
    const hi = 0.4, lo = hi / Math.pow(10, 19.08 / 4 / 20);
    const { ratio } = computeDynamicRatio(twoLevels(hi, lo));
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(4.5);
  });
});

describe('P2② 多电平扫频反解 drive', () => {
  it('线性设备（各档 THD 不变）→ 无法反解（ok=false）', () => {
    const rev = solveDriveFromLevels([0.08, 0.16, 0.32], [0.02, 0.02, 0.02]);
    expect(rev.ok).toBe(false);
    expect(rev.drive).toBe(0);
  });

  it('高增益设备（THD 随电平 16 倍增长）→ drive=1', () => {
    const rev = solveDriveFromLevels([0.08, 0.16, 0.32], [0.01, 0.05, 0.16]);
    expect(rev.ok).toBe(true);
    expect(rev.drive).toBeCloseTo(1, 1);
  });

  it('4 倍增长 → drive≈0.5', () => {
    const rev = solveDriveFromLevels([0.08, 0.16, 0.32], [0.015, 0.04, 0.06]);
    expect(rev.ok).toBe(true);
    // growth = 0.06/0.015 = 4 → log2(4)/4 = 0.5
    expect(rev.drive).toBeCloseTo(0.5, 1);
  });

  it('最高档 THD < 1% → ok=false', () => {
    const rev = solveDriveFromLevels([0.08, 0.16, 0.32], [0.002, 0.005, 0.008]);
    expect(rev.ok).toBe(false);
  });

  it('数据不足 2 档 → ok=false', () => {
    expect(solveDriveFromLevels([0.16], [0.05]).ok).toBe(false);
  });
});
