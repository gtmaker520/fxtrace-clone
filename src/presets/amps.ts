// SPDX-License-Identifier: Apache-2.0
// presets/amps.ts — 箱头定义（中性风格名，无商标）
// （提取自原 Guitar-X fx-registry 的 AMP_MODELS 子集；迷你链用 4 段 EQ 近似，
//   此处保留各型号的 EQ 频点/默认参数供 chain.ts 使用。）
// 声明：原实现为作者本人（GTMaker）自研项目 Guitar-X 中的自有代码，非第三方开源代码，本文件为作者自主改编。

export interface AmpModel {
  key: string;
  name: string;
  era: string;
  /** 音调栈频点（Hz） */
  ts: { bassF: number; trebleF: number; presenceF: number };
  /** 清音/失真两通道默认增益 */
  cleanGain: number;
  driveGain: number;
}

export const AMP_MODELS: AmpModel[] = [
  { key: 'marshall', name: '英式 80s', era: '80s', ts: { bassF: 130, trebleF: 3000, presenceF: 3800 }, cleanGain: 18, driveGain: 30 },
  { key: 'fender', name: '美式 60s', era: '60s', ts: { bassF: 140, trebleF: 3600, presenceF: 4000 }, cleanGain: 12, driveGain: 30 },
  { key: 'mesa', name: '美式现代', era: '90s', ts: { bassF: 180, trebleF: 3200, presenceF: 4800 }, cleanGain: 22, driveGain: 30 },
  { key: 'vox', name: '英式 Chime', era: '60s', ts: { bassF: 160, trebleF: 3500, presenceF: 4400 }, cleanGain: 18, driveGain: 30 },
  { key: 'peavey', name: '美式高增益', era: '90s', ts: { bassF: 200, trebleF: 3100, presenceF: 4600 }, cleanGain: 25, driveGain: 30 },
  { key: 'soldano', name: '美式主音', era: '80s', ts: { bassF: 190, trebleF: 3300, presenceF: 5200 }, cleanGain: 20, driveGain: 30 },
  { key: 'orange', name: '英式原始', era: '00s', ts: { bassF: 210, trebleF: 2800, presenceF: 3800 }, cleanGain: 22, driveGain: 30 },
  { key: 'mesa2c', name: '美式级联', era: '80s', ts: { bassF: 180, trebleF: 3200, presenceF: 5200 }, cleanGain: 18, driveGain: 32 },
];

/** modelIdx → 型号（与 engine/matching.ts 的 AMP_CANDIDATES 对应） */
export function getAmpModel(modelIdx: number): AmpModel {
  return AMP_MODELS[modelIdx % AMP_MODELS.length];
}
