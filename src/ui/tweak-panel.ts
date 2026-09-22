// SPDX-License-Identifier: Apache-2.0
// ui/tweak-panel.ts — 音色微调面板（从 demo/main.ts 下沉，参数归一化单点化）
// 职责：导入/应用音色后提供实时微调 UI（换箱体/失真度/箱头增益/单块电平）。
// 归一化约定与 applyTone 一致：面板统一使用链路控制键（drive 0-1），预设键（dist 0-100）
// 的换算只发生在 tone-file/applyTone 边界，本面板不接触预设键。
// 声明：本文件为作者本人（GTMaker）原创实现，非第三方开源代码。

import type { CloneResult } from '../engine/types';
import { CAB_VARIANTS } from '../presets/cabinets';
import type { MiniFxChain } from '../audio/chain';

export interface TweakPanelHandles {
  root: HTMLElement;
  /** 应用/导入音色后同步显示并展开面板 */
  sync: (result: CloneResult) => void;
}

/** 在给定宿主元素上创建微调面板（demo 与未来宿主共用） */
export function createTweakPanel(host: HTMLElement, getChain: () => MiniFxChain | null): TweakPanelHandles {
  const root = document.createElement('div');
  root.className = 'section-hidden';
  root.style.cssText = 'margin-top:12px; border-top:1px solid #2a2f4a; padding-top:10px';
  root.innerHTML = `
    <p class="hint" style="margin-bottom:6px"><b>音色微调</b>（导入/应用后可实时调整，不影响已保存的音色文件）</p>
    <div class="row" style="align-items:center">
      <span class="hint" style="min-width:64px">箱体</span>
      <select data-tk="cab" style="flex:1; max-width:260px; padding:5px; background:#161a2e; color:#ccc; border:1px solid #2a2f4a; border-radius:6px; font-size:13px"></select>
    </div>
    <div class="row" style="align-items:center; margin-top:6px">
      <span class="hint" style="min-width:64px">失真度</span>
      <input type="range" data-tk="dist" min="0" max="100" value="50" style="flex:1; max-width:260px">
      <span class="hint" data-tk="distVal" style="min-width:36px">50</span>
    </div>
    <div class="row" style="align-items:center; margin-top:6px">
      <span class="hint" style="min-width:64px">箱头增益</span>
      <input type="range" data-tk="gain" min="0" max="100" value="35" style="flex:1; max-width:260px">
      <span class="hint" data-tk="gainVal" style="min-width:36px">35</span>
    </div>
    <div class="row" style="align-items:center; margin-top:6px">
      <span class="hint" style="min-width:64px">单块电平</span>
      <input type="range" data-tk="level" min="0" max="100" value="30" style="flex:1; max-width:260px">
      <span class="hint" data-tk="levelVal" style="min-width:36px">30</span>
    </div>`;
  host.appendChild(root);

  const q = <T extends HTMLElement>(name: string) => root.querySelector(`[data-tk="${name}"]`) as T;
  const cab = q<HTMLSelectElement>('cab');
  const dist = q<HTMLInputElement>('dist');
  const gain = q<HTMLInputElement>('gain');
  const level = q<HTMLInputElement>('level');
  const distVal = q<HTMLElement>('distVal');
  const gainVal = q<HTMLElement>('gainVal');
  const levelVal = q<HTMLElement>('levelVal');

  for (const v of CAB_VARIANTS) {
    const opt = document.createElement('option');
    opt.value = String(v.id);
    opt.textContent = `${v.name} (${v.short})`;
    cab.appendChild(opt);
  }

  function findNodeId(kind: 'drive' | 'amp' | 'cab'): string | null {
    return getChain()?.nodesSnapshot.find(n => n.kind === kind)?.id ?? null;
  }
  function setParam(kind: 'drive' | 'amp' | 'cab', key: string, value: number): void {
    const chain = getChain();
    const id = findNodeId(kind);
    if (id && chain) chain.setParam(id, key, value);
  }

  cab.addEventListener('change', () => setParam('cab', 'variant', Number(cab.value)));
  dist.addEventListener('input', () => {
    distVal.textContent = dist.value;
    // 归一化单点：面板持有链路控制键 drive(0-1)；dist(0-100) 只在 sync 从音色文件读入时换算一次
    setParam('drive', 'drive', Number(dist.value) / 100);
  });
  gain.addEventListener('input', () => {
    gainVal.textContent = gain.value;
    setParam('amp', 'gain', Number(gain.value));
  });
  level.addEventListener('input', () => {
    levelVal.textContent = level.value;
    setParam('drive', 'level', Number(level.value) / 100);
  });

  return {
    root,
    sync(result: CloneResult): void {
      root.classList.remove('section-hidden');
      if (result.matchedCab) cab.value = String(result.matchedCab.variant);
      if (result.matchedDrive) {
        // 预设键 dist(0-100) → 面板显示同一 0-100 刻度；写链路时归一化
        const dist100 = Math.round(Number(result.matchedDrive.params.dist ?? 50));
        dist.value = String(dist100);
        distVal.textContent = dist.value;
        const lvl = Math.round((Number(result.matchedDrive.params.level ?? 0.3)) * 100);
        level.value = String(lvl);
        levelVal.textContent = level.value;
      }
      if (result.matchedAmp) {
        const g = Math.round(Number(result.matchedAmp.params.gain ?? 35));
        gain.value = String(g);
        gainVal.textContent = gain.value;
      }
    },
  };
}
