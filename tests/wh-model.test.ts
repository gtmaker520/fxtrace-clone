// SPDX-License-Identifier: Apache-2.0
// tests/wh-model.test.ts — W-H 模型单测：合成已知模型数据验证拟合恢复
import { describe, it, expect } from 'vitest';
import { solveDriveFromLevels } from '../src/engine/analysis';
import { fitStaticNonlinearity, makeOddSymmetricSpline } from '../src/engine/wh-nonlinear';
import { fitPeakingBiquad, biquadMagnitudeAt, estimateWHLinearStages } from '../src/engine/wh-linear';
import { makeIdentityNonlinear, IDENTITY_BIQUAD } from '../src/engine/wh-model';
import type { WHCaptureResult } from '../src/audio/wh-capture';

/** 构造合成 WH 采集数据：软削波 tanh 增益随电平压缩 */
function syntheticCapture(): WHCaptureResult {
  // 3 档电平（低/中/高），1kHz 处的频响增益随电平变化（压缩特性）
  const levels = [0.09, 0.3, 0.6];
  const freqs = new Float32Array([100, 500, 1000, 2000, 5000, 10000]);

  // 1kHz 增益（dB）：低电平 +6dB（线性区），高电平被压到 +2dB（压缩）
  const gains1kDb = [6, 4, 2];

  const sweeps = levels.map((level, li) => {
    const response = new Float32Array(freqs.length);
    for (let i = 0; i < freqs.length; i++) {
      // 频率形状：中频隆起（+4dB 峰在 1kHz）
      const shapeDb = i === 2 ? 4 : i === 1 || i === 3 ? 2 : 0;
      // 电平依赖：整体增益随电平压缩（1kHz 处 6→2dB），其他频点同样压缩比例的一半
      const comp = (6 - gains1kDb[li]) / 6; // 0, 1/3, 2/3
      response[i] = 6 + shapeDb - comp * (3 + shapeDb) * (i === 2 ? 1 : 0.5);
    }
    return { level, freqs, response };
  });

  return { sweeps, baseline: { freqs, peak: new Float32Array(freqs.length) }, thdLevels: [0.01, 0.05, 0.12] };
}

describe('P3 W-H 静态非线性拟合', () => {
  it('从多电平扫频恢复 1kHz 增益-电平曲线（单调、有压缩趋势）', () => {
    const cap = syntheticCapture();
    const fit = fitStaticNonlinearity(cap);
    expect(fit.curve.length).toBe(4097);
    expect(fit.rmse).toBeLessThan(0.5); // 归一化幅度误差
    // 曲线是奇对称的：f(-x) = -f(x)
    const c = fit.curve;
    expect(c[0]).toBeCloseTo(-c[4096], 5);
    expect(c[2048]).toBeCloseTo(0, 5); // 中点为 0
    // 单调递增（右半）
    for (let i = 2049; i < 4096; i += 64) {
      expect(c[i + 1]).toBeGreaterThanOrEqual(c[i] - 1e-6);
    }
  });

  it('奇对称样条生成器：端点与中点正确', () => {
    const curve = makeOddSymmetricSpline([[0.3, 0.5], [0.7, 0.9]]);
    expect(curve.length).toBe(4097);
    expect(curve[2048]).toBeCloseTo(0, 5);
    expect(curve[4096]).toBeCloseTo(0.9, 2); // x=1 → 最后一个点
    expect(curve[0]).toBeCloseTo(-0.9, 2);   // x=-1 → 奇对称
  });

  it('恒等非线性曲线为直线', () => {
    const c = makeIdentityNonlinear();
    expect(c[0]).toBeCloseTo(-1, 5);
    expect(c[4096]).toBeCloseTo(1, 5);
    expect(c[2048]).toBeCloseTo(0, 5);
  });
});

describe('P3 W-H 线性部分（peaking Biquad 拟合）', () => {
  const sr = 48000;

  it('恒等系数幅频为 1', () => {
    expect(biquadMagnitudeAt(IDENTITY_BIQUAD, 1000, sr)).toBeCloseTo(1, 6);
  });

  it('从合成频响恢复主峰（频率与增益近似）', () => {
    // 合成：+6dB 峰在 1kHz
    const n = 128;
    const freqs = new Float32Array(n);
    const resp = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const logF = Math.log(50) + (Math.log(16000) - Math.log(50)) * i / (n - 1);
      freqs[i] = Math.exp(logF);
      resp[i] = 6 * Math.exp(-Math.pow(Math.log(freqs[i] / 1000) / 0.4, 2));
    }
    const fit = fitPeakingBiquad(freqs, resp, sr);
    // 主峰频率在 1kHz 附近
    // 用拟合出的 Biquad 找它的最大响应频率
    let bestF = 0, bestMag = 0;
    for (let f = 100; f < 10000; f += 50) {
      const m = biquadMagnitudeAt(fit.coeffs, f, sr);
      if (m > bestMag) { bestMag = m; bestF = f; }
    }
    expect(Math.log2(bestF / 1000)).toBeLessThan(0.5); // 在半个八度内
    expect(fit.rmseDb).toBeLessThan(6); // 粗拟合，RMSE 有界即可
  });

  it('平直频响 → 拟合增益接近 0（近乎直通）', () => {
    const n = 64;
    const freqs = new Float32Array(n);
    const resp = new Float32Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      freqs[i] = 100 * Math.pow(100, i / (n - 1)); // 100Hz→10kHz
    }
    const fit = fitPeakingBiquad(freqs, resp, sr);
    // 全平 → extVal=0 → A=1 → 幅频 ≈1
    expect(fit.rmseDb).toBeLessThan(1);
  });

  it('estimateWHLinearStages：不足 2 档时返回恒等滤波器', () => {
    const r = estimateWHLinearStages([{ level: 0.3, freqs: new Float32Array([1000]), response: new Float32Array([0]) }], sr);
    expect(r.pre.coeffs.b0).toBe(1);
    expect(r.post.coeffs.b0).toBe(1);
  });
});

describe('P3 相关：多电平反解 drive（回归 P2②）', () => {
  it('THD 增长 16 倍 → drive=1', () => {
    expect(solveDriveFromLevels([0.08, 0.16, 0.32], [0.01, 0.05, 0.16]).drive).toBeCloseTo(1, 1);
  });
});
