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
  const normVals: number[] = [];
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
    normVals.push(normR);
    const err = Math.abs(normR - predicted);
    totalErr += err;
    count++;
  }
  const avgErr = count > 0 ? totalErr / count : 0;

  // P2③：分母改为相对误差——用响应的实际动态范围（2%-98% 分位峰-峰）归一化，
  // 替代原硬编码 36dB。动态范围过小（<6dB）时钳到 6dB 防止除零放大。
  const sorted = normVals.slice().sort((a, b) => a - b);
  const p2 = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
  const p98 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] ?? 0;
  const denom = Math.max(6, p98 - p2);
  return Math.max(0, Math.min(100, Math.round(100 - (avgErr / denom) * 100)));
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

/**
 * 失真特征匹配度（与 computeMatchPct 的频响匹配度并列展示，二者衡量维度不同）：
 * 频响匹配度只说明静态 EQ 曲线拟合得好，不代表失真特性像。
 * 本函数按 失真类型一致性 + THD 量级 + 动态压缩 三项加权评估失真侧的相似程度。
 *
 * @param ref 参考侧（设备克隆=扫频实测；音频克隆=文件分析结果）
 * @param cand 候选侧（选型引擎给出的预设特征）
 */
export interface DistortionFeatures {
  distortionType: 'soft' | 'hard' | 'none';
  thd: number;        // 百分数
  dynamicRatio: number; // 1=无压缩，>1 压缩比
}

export function computeDistortionMatchPct(ref: DistortionFeatures, cand: DistortionFeatures): number {
  // ① 失真类型一致性（权重 40%）：hard↔hard / soft↔soft 满分，none 与其余为 0
  const typeMatch = ref.distortionType === cand.distortionType ? 1 : 0;

  // ② THD 量级接近度（权重 35%）：log 域相对距离，1 个数量级差 ≈ 0 分
  const thdMatch = (() => {
    const a = Math.max(ref.thd, 1e-4), b = Math.max(cand.thd, 1e-4);
    const ratio = Math.max(a, b) / Math.min(a, b);
    return Math.max(0, 1 - Math.log10(ratio));
  })();

  // ③ 动态压缩接近度（权重 25%）：线性相对误差
  const dynMatch = (() => {
    const a = Math.max(ref.dynamicRatio, 0.01), b = Math.max(cand.dynamicRatio, 0.01);
    return Math.max(0, 1 - Math.abs(a - b) / Math.max(a, b));
  })();

  return Math.round((typeMatch * 0.4 + thdMatch * 0.35 + dynMatch * 0.25) * 100);
}
