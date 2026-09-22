// SPDX-License-Identifier: Apache-2.0
// engine/matching.ts — 选型引擎：单块/箱头/箱体规则打分匹配
// 声明：本文件为作者本人（GTMaker）原创实现，非第三方开源代码。

import type { FreqProfile, MatchedEffect, MatchedAmp, MatchedCab } from './types';
import type { ClipTopology } from './analysis';

/**
 * ── 失真效果器匹配：根据 THD、削波类型、增益量选择最佳单块 ──
 * P2①：可选传入削波拓扑（谐波阶次分解结果）——
 *   even（偶次/非对称削波）优先选非对称电路单块（过载/蓝色过载）；
 *   odd（奇次/对称削波）优先选对称电路单块（透明过载/运放失真）。
 * 不传时保持原有行为（向后兼容）。
 */
export function selectDriveEffect(thd: number, type: 'soft' | 'hard' | 'none', _driveDb: number, fp: FreqProfile, topology: ClipTopology = 'none'): MatchedEffect | null {
  if (thd < 0.01 || type === 'none') return null;

  if (type === 'soft') {
    // 拓扑已知时按电路对称性选型；未知时按原 THD 查表
    if (topology === 'even') {
      // 非对称削波（2f 强）：TS 风格软削波
      if (thd < 0.08) return { presetId: 'overdrive', name: '过载', params: { drive: Math.min(0.5, thd * 6), tone: 0.5, level: 0.35 } };
      return { presetId: 'bd2', name: '蓝色过载', params: { drive: Math.min(0.6, 0.35 + thd), tone: 0.5, level: 0.35 } };
    }
    if (topology === 'odd') {
      // 对称削波（3f 强）：对称二极管/运放，中频透明
      const gain = Math.min(0.6, 0.35 + (thd - 0.1) * 2);
      return { presetId: 'klon', name: '黄色过载', params: { gain: Math.max(0.15, gain), treble: 0.5, output: 0.35 } };
    }
    if (thd < 0.04) {
      return { presetId: 'overdrive', name: '过载', params: { drive: 0.15, tone: 0.5, level: 0.35 } };
    }
    if (thd < 0.08) {
      return { presetId: 'overdrive', name: '过载', params: { drive: 0.3, tone: 0.5, level: 0.35 } };
    }
    if (thd < 0.12) {
      return { presetId: 'bd2', name: '蓝色过载', params: { drive: 0.35, tone: 0.5, level: 0.35 } };
    }
    const gain = Math.min(0.6, 0.35 + (thd - 0.1) * 2);
    if (fp.mid > 2) {
      return { presetId: 'klon', name: '黄色过载', params: { gain, treble: 0.5, output: 0.35 } };
    }
    return { presetId: 'bd2', name: '蓝色过载', params: { drive: gain, tone: 0.5, level: 0.35 } };
  }

  // hard clip — EQ 全部归箱头管，单块只提供失真+音量
  // 拓扑已知时：even 优先二极管对地硬削波（失真/重金属），odd 优先运放对称削波（运放失真/电锯）
  if (topology === 'odd') {
    if (thd < 0.35) return { presetId: 'rat', name: '运放失真', params: { dist: 0.45, filter: 0.5, level: 0.35 } };
    return { presetId: 'chainsaw', name: '电锯', params: { dist: Math.min(0.85, 0.5 + thd * 0.5), low: 0, high: 0, mode: 0, presence: 0, level: 0.3 } };
  }
  if (topology === 'even') {
    if (thd < 0.35) return { presetId: 'distortion', name: '失真', params: { dist: Math.min(0.8, thd * 2), tone: 0.5, level: 0.35 } };
    return { presetId: 'metal', name: '重金属', params: { dist: 50, low: 0, mid: 0, mid_freq: 800, high: 0, presence: 0, level: 0.3 } };
  }
  if (thd < 0.2) {
    return { presetId: 'distortion', name: '失真', params: { dist: 0.35, tone: 0.5, level: 0.35 } };
  }
  if (thd < 0.35) {
    return { presetId: 'rat', name: '运放失真', params: { dist: 0.45, filter: 0.5, level: 0.35 } };
  }
  if (thd < 0.5) {
    return { presetId: 'metal', name: '重金属', params: { dist: 50, low: 0, mid: 0, mid_freq: 800, high: 0, presence: 0, level: 0.3 } };
  }
  if (thd < 0.7) {
    return { presetId: 'chainsaw', name: '电锯', params: { dist: 0.7, low: 0, high: 0, mode: 0, presence: 0, level: 0.35 } };
  }
  return { presetId: 'chainsaw', name: '电锯', params: { dist: 0.75, low: 0, high: 0, mode: 0, presence: 0, level: 0.3 } };
}

// ── 箱头匹配：根据频响特征和失真度打分选择箱头型号 ──
const AMP_CANDIDATES: Array<{ key: string; modelIdx: number; name: string; bias: (fp: FreqProfile, thd: number) => number }> = [
  { key: 'fender', modelIdx: 1, name: '美式 60s', bias: (fp, thd) => {
    let s = 0;
    if (thd < 0.05) s += 4; else if (thd > 0.15) s -= 3;
    if (fp.mid < -1) s += 3;
    if (fp.bass > 1) s += 1;
    if (fp.treble > 2) s += 2;
    return s;
  }},
  { key: 'marshall', modelIdx: 0, name: '英式 80s', bias: (fp, thd) => {
    let s = 0;
    if (thd > 0.05 && thd < 0.4) s += 3;
    if (fp.mid > 1) s += 3;
    if (fp.treble > 1 && fp.treble < 5) s += 2;
    return s;
  }},
  { key: 'vox', modelIdx: 3, name: '英式 Chime', bias: (fp, thd) => {
    let s = 0;
    if (fp.treble > 3) s += 4;
    if (fp.presence > 2) s += 3;
    if (fp.mid > 2) s += 2;
    if (thd < 0.15) s += 2;
    return s;
  }},
  { key: 'mesa', modelIdx: 2, name: '美式现代', bias: (fp, thd) => {
    let s = 0;
    if (thd > 0.2) s += 3;
    if (fp.bass > 2) s += 2;
    if (fp.mid > 0 && fp.mid < 3) s += 2;
    if (fp.presence > 1) s += 1;
    return s;
  }},
  { key: 'peavey', modelIdx: 4, name: '美式高增益', bias: (fp, thd) => {
    let s = 0;
    if (thd > 0.35) s += 4;
    if (fp.mid < -2) s += 3;
    if (fp.bass > 3) s += 2;
    if (fp.treble > 2) s += 1;
    return s;
  }},
  { key: 'soldano', modelIdx: 5, name: '美式主音', bias: (fp, thd) => {
    let s = 0;
    if (thd > 0.1 && thd < 0.5) s += 3;
    if (fp.mid > 0) s += 2;
    if (fp.treble > 1 && fp.treble < 5) s += 2;
    if (fp.presence > 2) s += 1;
    return s;
  }},
  { key: 'orange', modelIdx: 6, name: '英式原始', bias: (fp, thd) => {
    let s = 0;
    if (fp.bass > 2 && fp.mid > 0) s += 3;
    if (thd > 0.1 && thd < 0.4) s += 2;
    if (fp.treble < 3) s += 1;
    return s;
  }},
  { key: 'mesa2c', modelIdx: 7, name: '美式级联', bias: (fp, thd) => {
    let s = 0;
    if (thd > 0.25) s += 3;
    if (fp.mid < -1 && fp.bass > 2) s += 4;
    if (fp.presence > 2) s += 2;
    return s;
  }},
];

export function selectAmpModel(fp: FreqProfile, thd: number): MatchedAmp | null {
  let best: MatchedAmp | null = null;
  let bestScore = -Infinity;
  const channel = thd > 0.05 ? 1 : 0;

  for (const c of AMP_CANDIDATES) {
    const score = c.bias(fp, thd);
    if (score > bestScore) {
      bestScore = score;
      const gain = channel === 1
        ? Math.min(35, Math.max(12, 15 + thd * 20))
        : Math.min(18, Math.max(5, 6 + fp.bass * 0.3));
      best = {
        modelIdx: c.modelIdx,
        channel,
        name: c.name,
        params: {
          gain,
          bass: Math.max(-8, Math.min(8, fp.bass * 0.8)),
          mid: Math.max(-8, Math.min(8, fp.mid * 0.7)),
          treble: Math.max(-8, Math.min(8, fp.treble * 1.0)),
          presence: Math.max(-6, Math.min(6, fp.presence * 0.8)),
          level: 50,
        },
      };
    }
  }
  return best;
}

// ── 箱体匹配：根据高频衰减特征选择箱体 IR ──
const CAB_CANDIDATES: Array<{ variant: number; name: string; bias: (fp: FreqProfile) => number }> = [
  { variant: 0, name: '英式 4x12', bias: (fp) => {
    let s = 3;
    if (fp.presence > 1 && fp.presence < 5) s += 3;
    if (fp.treble > 1) s += 2;
    return s;
  }},
  { variant: 1, name: '暖暗 4x12', bias: (fp) => {
    let s = 2;
    if (fp.treble < 2) s += 3;
    if (fp.presence < 1) s += 2;
    if (fp.bass > 2) s += 1;
    return s;
  }},
  { variant: 2, name: '中凹 4x12', bias: (fp) => {
    let s = 2;
    if (fp.mid < -1) s += 3;
    if (fp.bass > 3) s += 2;
    if (fp.presence > 2) s += 1;
    return s;
  }},
  { variant: 3, name: '中性 4x12', bias: (fp) => {
    let s = 2;
    if (fp.treble > 0 && fp.treble < 4) s += 3;
    if (fp.presence > 0 && fp.presence < 4) s += 2;
    return s;
  }},
  { variant: 4, name: '美式 1x12', bias: (fp) => {
    let s = 1;
    if (fp.presence > 4) s += 3;
    if (fp.treble > 4) s += 3;
    if (fp.bass < 1) s += 1;
    return s;
  }},
  { variant: 5, name: '英式 2x12', bias: (fp) => {
    let s = 1;
    if (fp.presence > 3) s += 4;
    if (fp.treble > 3) s += 3;
    if (fp.mid > 1) s += 1;
    return s;
  }},
];

export function selectCabinet(fp: FreqProfile): MatchedCab | null {
  let best: MatchedCab | null = null;
  let bestScore = -Infinity;

  for (const c of CAB_CANDIDATES) {
    const score = c.bias(fp);
    if (score > bestScore) {
      bestScore = score;
      const highCut = fp.presence > 3 ? 18000 : fp.presence > 0 ? 16000 : 12000;
      best = {
        variant: c.variant,
        name: c.name,
        params: {
          level: 50,
          high_cut: highCut,
          low_cut: 30,
          presence: Math.max(20, Math.min(60, 35 + fp.presence * 3)),
        },
      };
    }
  }
  return best;
}
