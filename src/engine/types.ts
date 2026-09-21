// SPDX-License-Identifier: Apache-2.0
// engine/types.ts — 克隆领域类型（提取自原 Guitar-X js/ui/clone-pedal.ts）
// 声明：原实现为作者本人（GTMaker）自研项目 Guitar-X 中的自有代码，非第三方开源代码，本文件为作者自主改编。

export type CloneMode = 'eq' | 'dist' | 'full';

export interface MatchedEffect {
  presetId: string;
  name: string;
  params: Record<string, number>;
}

export interface MatchedAmp {
  modelIdx: number;
  channel: number;
  name: string;
  params: Record<string, number>;
}

export interface MatchedCab {
  variant: number;
  name: string;
  params: Record<string, number>;
}

export interface FreqProfile {
  bass: number;
  mid: number;
  treble: number;
  presence: number;
}

/** 测量得到的原始频响（新格式：保存时包含，供后续用新算法重算） */
export interface ResponseCurve {
  freqs: number[];
  response: number[];
}

export interface CloneResult {
  mode: CloneMode;
  eqBands: number[];
  matchPct: number;
  distortionType: 'soft' | 'hard' | 'none';
  thd: number;
  driveAmount: number;
  levelDb: number;
  dynamicRatio: number;
  dynamicThreshold: number;
  freqProfile: FreqProfile;
  matchedDrive: MatchedEffect | null;
  matchedAmp: MatchedAmp | null;
  matchedCab: MatchedCab | null;
  /** 原始频响数据（新格式 v2；旧格式无此字段） */
  rawResponse?: ResponseCurve;
}

/** 音色文件 / 已保存音色的持久化形态 */
export interface SavedCloneTone {
  id: string;
  name: string;
  date: string;
  source?: 'device' | 'audio';
  mode: CloneMode;
  eqBands: number[];
  matchPct: number;
  distortionType: 'soft' | 'hard' | 'none';
  thd: number;
  driveAmount: number;
  dynamicRatio: number;
  freqProfile: FreqProfile;
  matchedDrive: MatchedEffect | null;
  matchedAmp: MatchedAmp | null;
  matchedCab: MatchedCab | null;
  favorite?: boolean;
  rawResponse?: ResponseCurve;
}
