// SPDX-License-Identifier: Apache-2.0
// io/tone-file.ts — 音色 JSON 的导入/导出（文件即存储，替代 localStorage）
// （提取自原 clone-pedal.ts 的 exportCloneTone/importCloneTone；新格式含原始频响 rawResponse）
// 声明：原实现为作者本人（GTMaker）自研项目 Guitar-X 中的自有代码，非第三方开源代码，本文件为作者自主改编。

import type { SavedCloneTone, CloneResult } from '../engine/types';

/** 音色文件版本：v2 起包含 rawResponse（原始频响），可用新算法重算 */
export const TONE_FILE_VERSION = 2;

export function toneToJSON(tone: SavedCloneTone): string {
  return JSON.stringify({ ...tone, _version: TONE_FILE_VERSION }, null, 2);
}

export function toneFilename(name: string): string {
  return 'tone_' + name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_') + '.json';
}

/** 浏览器下载导出 */
export function downloadTone(tone: SavedCloneTone): void {
  const json = toneToJSON(tone);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = toneFilename(tone.name);
  a.click();
  URL.revokeObjectURL(url);
}

/** 从 CloneResult 生成可保存/导出的音色对象 */
export function cloneResultToTone(name: string, result: CloneResult, source: 'device' | 'audio' = 'device'): SavedCloneTone {
  return {
    id: 'clone_' + Date.now().toString(36),
    name,
    date: new Date().toLocaleDateString('zh-CN'),
    source,
    mode: result.mode,
    // 导出 clamp 保持与导入对称 [-15, 15]
    eqBands: result.eqBands.map(v => Math.max(-15, Math.min(15, v))),
    matchPct: result.matchPct,
    distortionType: result.distortionType,
    thd: result.thd,
    driveAmount: result.driveAmount,
    dynamicRatio: result.dynamicRatio,
    freqProfile: { ...result.freqProfile },
    matchedDrive: result.matchedDrive ? { ...result.matchedDrive, params: { ...result.matchedDrive.params } } : null,
    matchedAmp: result.matchedAmp ? { ...result.matchedAmp, params: { ...result.matchedAmp.params } } : null,
    matchedCab: result.matchedCab ? { ...result.matchedCab, params: { ...result.matchedCab.params } } : null,
    rawResponse: result.rawResponse ? { freqs: [...result.rawResponse.freqs], response: [...result.rawResponse.response] } : undefined,
  };
}

export interface ParsedTone {
  tone: SavedCloneTone;
  /** 是否为旧格式（v1，无 rawResponse） */
  legacy: boolean;
}

/**
 * 解析音色 JSON（浏览器 File）。
 * 兼容旧项目 v1 格式（无 rawResponse），留迁移路径（brief 开源注意事项 #4）。
 */
export function parseToneFile(text: string, fallbackName = 'imported'): ParsedTone {
  const data = JSON.parse(text);
  if (!data.eqBands || !Array.isArray(data.eqBands) || data.eqBands.length < 7) {
    throw new Error('音色文件格式不正确：缺少 eqBands 数据');
  }
  const tone: SavedCloneTone = {
    id: 'clone_' + Date.now().toString(36),
    name: data.name || fallbackName,
    date: data.date || new Date().toLocaleDateString('zh-CN'),
    source: data.source || 'device',
    mode: data.mode || 'eq',
    eqBands: data.eqBands.map((v: unknown) => Math.max(-15, Math.min(15, Number(v) || 0))),
    matchPct: data.matchPct || 0,
    distortionType: data.distortionType || 'none',
    thd: data.thd || 0,
    driveAmount: data.driveAmount || 0,
    dynamicRatio: data.dynamicRatio || 1,
    freqProfile: data.freqProfile || { bass: 0, mid: 0, treble: 0, presence: 0 },
    matchedDrive: data.matchedDrive || null,
    matchedAmp: data.matchedAmp || null,
    matchedCab: data.matchedCab || null,
  };
  // v2 新字段：原始频响（旧格式没有 → legacy=true，P1 起可重算）
  if (data.rawResponse && Array.isArray(data.rawResponse.freqs) && Array.isArray(data.rawResponse.response)) {
    tone.rawResponse = { freqs: data.rawResponse.freqs, response: data.rawResponse.response };
    return { tone, legacy: false };
  }
  return { tone, legacy: true };
}
