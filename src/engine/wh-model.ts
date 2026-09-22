// SPDX-License-Identifier: Apache-2.0
// engine/wh-model.ts — Wiener-Hammerstein 模型核心（线性 → 静态非线性 → 线性）
// Linear → Static Nonlinearity → Linear
// 声明：本文件为作者本人（GTMaker）原创实现，非第三方开源代码。

/** WH 模型三段：Pre-filter (线性) -> Nonlinear (波形塑形) -> Post-filter (线性) */
export interface WHModel {
  /** 预滤波器：输入侧线性响应（Biquad 系数） */
  preFilter: BiquadCoeffs;
  /** 非线性传递函数：样本级查表曲线 (4097 点) */
  nonlinear: Float32Array;
  /** 后滤波器：输出侧线性响应（Biquad 系数） */
  postFilter: BiquadCoeffs;
  /** 输入增益补偿（使 nonlinear 入口处信号幅度落在 [-1,1] 主动态区间） */
  inputGain: number;
  /** 输出增益补偿（匹配整体电平） */
  outputGain: number;
}

export interface BiquadCoeffs {
  b0: number; b1: number; b2: number;
  a0: number; a1: number; a2: number;
}

/** 单位增益恒等 Biquad */
export const IDENTITY_BIQUAD: BiquadCoeffs = { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 };

/** 线性恒等非线性曲线（直通） */
export function makeIdentityNonlinear(): Float32Array {
  const n = 4097;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = (i / (n - 1)) * 2 - 1;
  return curve;
}