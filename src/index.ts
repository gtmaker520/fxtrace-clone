// SPDX-License-Identifier: Apache-2.0
// index.ts — 公共 API
// 声明：原实现为作者本人（GTMaker）自研项目 Guitar-X 中的自有代码，非第三方开源代码，本文件为作者自主改编。

// 纯逻辑（可单测，无 DOM）
export * from './engine/types';
export * from './engine/measurement';
export * from './engine/analysis';
export * from './engine/fitting';
export * from './engine/matching';

// WebAudio 胶水
export { getAudioContext, closeAudioContext, detectInputSignal, listInputDevices, captureBaseline, captureSweepResponse, captureThd, captureThdMultiLevel, captureDynamicLevels, playAndCapturePeaks, renderSweepBuffer, isMonitoring, startMonitor, stopMonitor } from './audio/io';
export { MiniFxChain } from './audio/chain';
export * from './audio/curves';

// 预设
export { CAB_VARIANTS, makeCabIR, getCabIR } from './presets/cabinets';
export { AMP_MODELS, getAmpModel } from './presets/amps';
export { DRIVE_PRESETS, DRIVE_IDS, getDrivePreset } from './presets/drives';

// 文件 I/O（存储 = 导入/导出文件，无 localStorage）
export {
  TONE_FILE_VERSION, toneToJSON, toneFilename, downloadTone,
  cloneResultToTone, parseToneFile,
} from './io/tone-file';
export { computeSpectrum, estimateDistortion, analyzeAudioSelection } from './io/file-clone';
export { openCloneWizard, setOnCloneSaved, setOnApply, showToast } from './ui/wizard';
export { drawResponseChart, buildFitTableHtml, drawWaveform } from './ui/charts';

import type { CloneResult, SavedCloneTone } from './engine/types';
import { MiniFxChain } from './audio/chain';
import type { CloneMode } from './engine/types';

/**
 * applyTone：把克隆结果应用到一个迷你效果器链。
 * 单块（若有）→ 箱头 4 段 EQ → 箱体 IR（若有）。
 */
export function applyTone(chain: MiniFxChain, result: CloneResult): void {
  chain.clear();
  if (result.matchedDrive) {
    const id = chain.loadDrive(result.matchedDrive.presetId);
    if (id) {
      for (const [k, v] of Object.entries(result.matchedDrive.params)) {
        // 预设参数键 dist(0-100) → 链路控制键 drive(0-1)；其余键透传
        if (k === 'dist') chain.setParam(id, 'drive', Number(v) / 100);
        else chain.setParam(id, k, v);
      }
    }
  }
  if (result.matchedAmp) {
    const id = chain.loadAmp();
    if (id) for (const [k, v] of Object.entries(result.matchedAmp.params)) chain.setParam(id, k, v);
  }
  if (result.matchedCab) {
    const id = chain.loadCab(result.matchedCab.variant);
    if (id) for (const [k, v] of Object.entries(result.matchedCab.params)) chain.setParam(id, k, v);
  }
  chain.rebuild();
}

/** 从音色对象应用（导入文件后复用 applyTone） */
export function applySavedTone(chain: MiniFxChain, tone: SavedCloneTone): void {
  applyTone(chain, tone as unknown as CloneResult);
}

export type { CloneMode };
