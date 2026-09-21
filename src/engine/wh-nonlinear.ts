// SPDX-License-Identifier: Apache-2.0
// engine/wh-nonlinear.ts — 非线性拟合器：从多电平扫频数据提取静态传递函数
// 用三次样条拟合增益-输出曲线，生成 4097 点 WaveShaper 曲线
// 声明：原实现为作者本人（GTMaker）自研项目 Guitar-X 中的自有代码，非第三方开源代码，本文件为作者自主改编。

import { WHCaptureResult } from '../audio/wh-capture';

/** 非线性拟合结果 */
export interface NonlinearFitResult {
  /** WaveShaper 曲线 (4097 点，[-1, 1] → [-1, 1]) */
  curve: Float32Array;
  /** 输入增益（使典型信号落在非线性主动态区间） */
  inputGain: number;
  /** 输出增益（整体电平补偿） */
  outputGain: number;
  /** 拟合 RMSE（归一化后） */
  rmse: number;
}

/**
 * 从多电平扫频采集结果拟合静态非线性传递函数
 * 原理：不同输入电平下的频响增益变化，反映了设备的压缩/削波特性
 * 取 1kHz 处的增益随输入电平的变化曲线，作为静态非线性的代理
 */
export function fitStaticNonlinearity(result: WHCaptureResult): NonlinearFitResult {
  // 1. 找 1kHz 最近的频点索引
  const freqArrays = result.sweeps.map(s => s.freqs);
  const respArrays = result.sweeps.map(s => s.response);

  // 假设所有档位频率轴一致（同一 FFT 参数）
  const refFreqs = freqArrays[0];
  let idx1k = 0;
  for (let i = 1; i < refFreqs.length; i++) {
    if (Math.abs(refFreqs[i] - 1000) < Math.abs(refFreqs[idx1k] - 1000)) idx1k = i;
  }

  // 2. 提取各档 1kHz 处的增益 (dB) 与输入电平
  const inputLevels = result.sweeps.map(s => s.level); // 线性电平
  const gainsDb = respArrays.map(r => r[idx1k]); // dB

  // 3. 归一化输入电平到 [0, 1]（假设最小档为阈值附近，最大档为饱和区）
  const minLevel = Math.min(...inputLevels);
  const maxLevel = Math.max(...inputLevels);
  const normInputs = inputLevels.map(l => (l - minLevel) / (maxLevel - minLevel));

  // 4. 增益转线性幅度比
  const gainsLin = gainsDb.map(db => Math.pow(10, db / 20));

  // 5. 构建 (输入归一化幅度, 输出幅度) 数据点
  // 物理关系：输出幅度 = 增益 × 输入幅度（y(u) = gain(u)·u，零输入零输出）
  const points: Array<[number, number]> = [];
  for (let i = 0; i < normInputs.length; i++) {
    points.push([normInputs[i], gainsLin[i] * normInputs[i]]);
  }
  // 补端点：仅当测量点未覆盖 1 时（x=0 已由 y=gain·u 自然给出 0）
  if (points[points.length - 1][0] < 1) points.push([1, gainsLin[gainsLin.length - 1]]);

  // 6. 按输入排序
  points.sort((a, b) => a[0] - b[0]);

  // 7. 三次样条插值生成 4097 点曲线
  const CURVE_LEN = 4097;
  const curve = new Float32Array(CURVE_LEN);

  // 简化：用分段三次 Hermite 插值（单调性保持）
  for (let i = 0; i < CURVE_LEN; i++) {
    const x = (i / (CURVE_LEN - 1)) * 2 - 1; // [-1, 1]
    const absX = Math.abs(x);

    // 在 [0,1] 上插值
    let y = 0;
    if (absX <= points[0][0]) {
      // points[0][0] 可能为 0（补的端点），直接取端点值防除零
      y = points[0][0] > 0 ? points[0][1] * (absX / points[0][0]) : points[0][1];
    } else if (absX >= points[points.length - 1][0]) {
      y = points[points.length - 1][1];
    } else {
      // 找区间
      let k = 0;
      while (k < points.length - 1 && points[k + 1][0] < absX) k++;
      const x0 = points[k][0], y0 = points[k][1];
      const x1 = points[k + 1][0], y1 = points[k + 1][1];
      const t = (absX - x0) / (x1 - x0);
      // 三次 Hermite（单调区间用简单插值）
      y = y0 + (y1 - y0) * (3 * t * t - 2 * t * t * t);
    }
    curve[i] = x >= 0 ? y : -y; // 奇对称
  }

  // 8. 归一化曲线幅度到 [-1, 1]
  let maxAbs = 0;
  for (let i = 0; i < CURVE_LEN; i++) {
    if (Math.abs(curve[i]) > maxAbs) maxAbs = Math.abs(curve[i]);
  }
  if (maxAbs > 0) {
    for (let i = 0; i < CURVE_LEN; i++) curve[i] /= maxAbs;
  }

  // 9. 估算输入/输出增益
  // inputGain: 使典型输入 (-0.3~0.3) 映射到非线性最陡峭区间
  // outputGain: 整体电平补偿
  const inputGain = 1.0;
  const outputGain = 1.0;

  // RMSE（在已知点上；曲线已归一化到 maxAbs，点也按同一尺度归一后比较）
  let sqErr = 0;
  for (const [x, y] of points.slice(1, -1)) {
    const idx = Math.round((x + 1) / 2 * 4096);
    const pred = curve[idx];
    const yNorm = maxAbs > 0 ? y / maxAbs : y;
    sqErr += (pred - yNorm) * (pred - yNorm);
  }
  const rmse = points.length > 2 ? Math.sqrt(sqErr / (points.length - 2)) : 0;

  return { curve, inputGain, outputGain, rmse };
}

/** 奇对称三次样条生成器（通用工具） */
export function makeOddSymmetricSpline(
  points: Array<[number, number]>, // [0,1] 上的单调点
  length = 4097
): Float32Array {
  const curve = new Float32Array(length);
  // 确保端点
  const allPoints = [[0, 0], ...points, [1, points[points.length - 1][1]]];
  allPoints.sort((a, b) => a[0] - b[0]);

  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1;
    const absX = Math.abs(x);
    let y = 0;
    if (absX <= allPoints[0][0]) {
      y = allPoints[0][0] > 0 ? allPoints[0][1] * (absX / allPoints[0][0]) : allPoints[0][1];
    } else if (absX >= allPoints[allPoints.length - 1][0]) {
      y = allPoints[allPoints.length - 1][1];
    } else {
      let k = 0;
      while (k < allPoints.length - 1 && allPoints[k + 1][0] < absX) k++;
      const x0 = allPoints[k][0], y0 = allPoints[k][1];
      const x1 = allPoints[k + 1][0], y1 = allPoints[k + 1][1];
      const t = (absX - x0) / (x1 - x0);
      y = y0 + (y1 - y0) * (3 * t * t - 2 * t * t * t);
    }
    curve[i] = x >= 0 ? y : -y;
  }
  return curve;
}