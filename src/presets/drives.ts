// SPDX-License-Identifier: Apache-2.0
// presets/drives.ts — 单块定义（中性风格名，无商标）
// 声明：本文件为作者本人（GTMaker）原创实现，非第三方开源代码。

export interface DrivePreset {
  presetId: string;
  name: string;
  /** [paramId, 默认值, min, max] */
  params: Array<[string, number, number, number]>;
}

export const DRIVE_PRESETS: DrivePreset[] = [
  ['overdrive', { presetId: 'overdrive', name: '过载', params: [['drive', 0.35, 0, 1], ['tone', 0.5, 0, 1], ['level', 0.85, 0, 2]] }],
  ['bd2', { presetId: 'bd2', name: '蓝色过载', params: [['drive', 0.4, 0, 1], ['tone', 0.5, 0, 1], ['level', 0.85, 0, 2]] }],
  ['klon', { presetId: 'klon', name: '黄色过载', params: [['gain', 0.3, 0, 1], ['treble', 0.5, 0, 1], ['output', 0.85, 0, 2]] }],
  ['distortion', { presetId: 'distortion', name: '失真', params: [['dist', 0.35, 0, 1], ['tone', 0.5, 0, 1], ['level', 0.85, 0, 2]] }],
  ['rat', { presetId: 'rat', name: '运放失真', params: [['dist', 0.45, 0, 1], ['filter', 0.5, 0, 1], ['level', 0.85, 0, 2]] }],
  ['metal', { presetId: 'metal', name: '重金属', params: [['dist', 50, 0, 100], ['low', 0, -15, 15], ['mid', 0, -15, 15], ['mid_freq', 800, 200, 5000], ['high', 0, -15, 15], ['presence', 0, -15, 15], ['level', 0.3, 0, 2]] }],
  ['chainsaw', { presetId: 'chainsaw', name: '电锯', params: [['dist', 0.7, 0, 1], ['low', 0, 0, 1], ['high', 0, 0, 1], ['mode', 0, 0, 1], ['presence', 0, -15, 15], ['level', 0.35, 0, 2]] }],
] as unknown as DrivePreset[];

export const DRIVE_IDS = DRIVE_PRESETS.map(d => d.presetId);

export function getDrivePreset(presetId: string): DrivePreset | undefined {
  return DRIVE_PRESETS.find(d => d.presetId === presetId);
}
