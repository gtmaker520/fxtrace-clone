// SPDX-License-Identifier: Apache-2.0
// engine/fitting.ts — EQ 拟合与匹配度（提取自原 clone-pedal.ts，纯逻辑可单测）
// 声明：原实现为作者本人（GTMaker）自研项目 Guitar-X 中的自有代码，非第三方开源代码，本文件为作者自主改编。

/** 7 段 EQ 拟合频点（Hz） */
export const EQ_FREQS = [100, 200, 400, 800, 1600, 3200, 6400];
/** 高斯加权带宽（对数频率空间的标准差） */
export const FIT_SIGMA = 0.25;

/**
 * 频响曲线拟合到 7 段 EQ 参数（高斯加权多频段拟合）。
 * 先做归一化去除整体电平偏移，让 EQ 只负责频率整形。
 */
export function fitEqBands(freqs: Float32Array, response: Float32Array): number[] {
  const bands = new Array(7).fill(0);

  let responseSum = 0;
  for (let i = 0; i < response.length; i++) responseSum += response[i];
  const responseMean = response.length > 0 ? responseSum / response.length : 0;
  const normResp = new Float32Array(response.length);
  for (let i = 0; i < response.length; i++) normResp[i] = response[i] - responseMean;

  for (let b = 0; b < EQ_FREQS.length; b++) {
    const logTarget = Math.log(EQ_FREQS[b]);
    let weightedSum = 0;
    let weightSum = 0;
    for (let i = 0; i < freqs.length; i++) {
      const logF = Math.log(freqs[i]);
      const dist = (logF - logTarget) / FIT_SIGMA;
      const w = Math.exp(-0.5 * dist * dist);
      if (w < 0.01) continue;
      weightedSum += normResp[i] * w;
      weightSum += w;
    }
    if (weightSum > 0) {
      bands[b] = Math.max(-15, Math.min(15, weightedSum / weightSum));
    }
  }
  return bands;
}

/**
 * 匹配度：用拟合出的 7 段 EQ 重建每个频点的预测值，与实际响应比较平均误差。
 * 误差映射为 0-100%（原实现分母 36dB 为硬编码，P2 计划改为相对误差）。
 */
export function computeMatchPct(freqs: Float32Array, response: Float32Array, bands: number[]): number {
  if (freqs.length === 0) return 0;

  let responseSum = 0;
  for (let i = 0; i < response.length; i++) responseSum += response[i];
  const responseMean = response.length > 0 ? responseSum / response.length : 0;

  let totalErr = 0;
  let count = 0;
  for (let i = 0; i < freqs.length; i++) {
    const logF = Math.log(freqs[i]);
    let predicted = 0;
    let weightSum = 0;
    for (let b = 0; b < 7; b++) {
      const logB = Math.log(EQ_FREQS[b]);
      const dist = (logF - logB) / FIT_SIGMA;
      const w = Math.exp(-0.5 * dist * dist);
      predicted += bands[b] * w;
      weightSum += w;
    }
    if (weightSum > 0) predicted /= weightSum;
    const normR = response[i] - responseMean;
    const err = Math.abs(normR - predicted);
    totalErr += err;
    count++;
  }
  const avgErr = count > 0 ? totalErr / count : 36;
  return Math.max(0, Math.min(100, Math.round(100 - (avgErr / 36) * 100)));
}

/** 用拟合 bands 重建任意频点的预测响应（绘图用） */
export function predictResponse(f: number, bands: number[]): number {
  const logF = Math.log(f);
  let predicted = 0;
  let weightSum = 0;
  for (let b = 0; b < 7; b++) {
    const logB = Math.log(EQ_FREQS[b]);
    const dist = (logF - logB) / FIT_SIGMA;
    const w = Math.exp(-0.5 * dist * dist);
    predicted += bands[b] * w;
    weightSum += w;
  }
  return weightSum > 0 ? predicted / weightSum : 0;
}
