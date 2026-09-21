// SPDX-License-Identifier: Apache-2.0
// demo/main.ts — 纯静态 demo（无 Electron）：
//   路径 A 设备克隆 → ui/wizard.ts
//   路径 B 音频文件克隆 → io/file-clone.ts + ui/charts.ts
// 声明：原实现为作者本人（GTMaker）自研项目 Guitar-X 中的自有代码，非第三方开源代码，本文件为作者自主改编。

import { openCloneWizard, setOnApply, showToast } from '../src/ui/wizard';
import { setOnWHApply } from '../src/ui/wizard';
import { analyzeAudioSelection } from '../src/io/file-clone';
import { drawResponseChart, buildFitTableHtml, drawWaveform } from '../src/ui/charts';
import { cloneResultToTone, downloadTone, parseToneFile } from '../src/io/tone-file';
import { MiniFxChain, applyTone } from '../src/index';
import { getAudioContext } from '../src/audio/io';
import type { CloneMode, CloneResult } from '../src/engine/types';

// ── 路径 A：设备克隆向导 ──
let demoChain: MiniFxChain | null = null;
setOnApply((result) => {
  const ctx = getAudioContext();
  if (!ctx) { showToast('音频上下文不可用'); return; }
  if (!demoChain) demoChain = new MiniFxChain(ctx);
  applyTone(demoChain, result);
  showToast(`已应用：${result.matchedDrive?.name ?? '无单块'} + ${result.matchedAmp?.name ?? '无箱头'} + ${result.matchedCab?.name ?? '无箱体'}，现在可以弹奏试听`);
});
document.getElementById('openWizardBtn')!.addEventListener('click', openCloneWizard);

// P3：W-H 真克隆模型 → chain.loadWH 应用（pre-IIR → WaveShaper → post-IIR，立即可弹）
setOnWHApply((model) => {
  const ctx = getAudioContext();
  if (!ctx) { showToast('音频上下文不可用'); return; }
  if (!demoChain) demoChain = new MiniFxChain(ctx);
  demoChain.loadWH(model);
  showToast('W-H 真克隆模型已应用到链路，现在可以弹奏试听');
});

// ── 导入音色文件 → 一键恢复链路 ──
const toneFileInput = document.getElementById('toneFileInput') as HTMLInputElement;
document.getElementById('importToneBtn')!.addEventListener('click', () => toneFileInput.click());
toneFileInput.addEventListener('change', async () => {
  const file = toneFileInput.files?.[0];
  if (!file) return;
  try {
    const { tone, legacy } = parseToneFile(await file.text(), file.name.replace(/\.json$/i, ''));
    const ctx = getAudioContext();
    if (!ctx) { showToast('音频上下文不可用'); return; }
    if (!demoChain) demoChain = new MiniFxChain(ctx);
    applyTone(demoChain, tone as unknown as CloneResult);
    const info = document.getElementById('importToneInfo')!;
    info.textContent = `✓ ${tone.name}（匹配度 ${tone.matchPct}%）${legacy ? ' · 旧格式 v1，无原始频响' : ''}`;
    showToast(`音色「${tone.name}」已应用到链路${legacy ? '（旧格式 v1，可重新克隆升级到 v2）' : ''}`);
  } catch (e) {
    showToast('导入失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    toneFileInput.value = '';
  }
});

// ── 路径 B：音频文件克隆 ──
const dropZone = document.getElementById('dropZone')!;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const waveSection = document.getElementById('waveSection')!;
const waveCanvas = document.getElementById('waveCanvas') as HTMLCanvasElement;
const selInfo = document.getElementById('selInfo')!;
const playSelBtn = document.getElementById('playSelBtn') as HTMLButtonElement;
const exportBtn = document.getElementById('exportAudioToneBtn') as HTMLButtonElement;

let audioBuffer: AudioBuffer | null = null;
let selStart = 0;
let selEnd = 0;
let dragging = false;
let audioResult: CloneResult | null = null;
let playSource: AudioBufferSourceNode | null = null;
let waveCache: HTMLCanvasElement | null = null;

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  const f = e.dataTransfer?.files[0]; if (f) loadFile(f);
});
fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) loadFile(f); });

async function loadFile(file: File): Promise<void> {
  try {
    const ab = await file.arrayBuffer();
    const ctx = getAudioContext();
    if (!ctx) { showToast('音频上下文不可用'); return; }
    audioBuffer = await ctx.decodeAudioData(ab);
    selStart = 0;
    selEnd = audioBuffer.duration;
    waveSection.classList.remove('section-hidden');
    dropZone.innerHTML = `✓ ${file.name} · ${audioBuffer.duration.toFixed(1)}s · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    drawWave();
    updateSelInfo();
  } catch {
    showToast('音频解码失败，请检查文件是否损坏');
  }
}

function drawWave(): void {
  if (!audioBuffer) return;
  const off = document.createElement('canvas');
  off.width = waveCanvas.width; off.height = waveCanvas.height;
  drawWaveform(off, audioBuffer.getChannelData(0), '#0d0f1a', '#26c6da');
  waveCache = off;
  redraw();
}

function redraw(): void {
  const c = waveCanvas.getContext('2d');
  if (!c || !waveCache) return;
  c.drawImage(waveCache, 0, 0);
  if (Math.abs(selEnd - selStart) > 0.001 && audioBuffer) {
    const dur = audioBuffer.duration;
    const x1 = Math.min(selStart, selEnd) / dur * waveCanvas.width;
    const x2 = Math.max(selStart, selEnd) / dur * waveCanvas.width;
    c.fillStyle = 'rgba(38,198,218,0.18)';
    c.fillRect(x1, 0, x2 - x1, waveCanvas.height);
    c.strokeStyle = 'rgba(38,198,218,0.6)';
    c.lineWidth = 1;
    c.strokeRect(x1, 0, x2 - x1, waveCanvas.height);
  }
}

function updateSelInfo(): void {
  if (!audioBuffer) return;
  const s = Math.min(selStart, selEnd), e = Math.max(selStart, selEnd);
  selInfo.textContent = `选区 ${s.toFixed(2)}s — ${e.toFixed(2)}s（${(e - s).toFixed(2)}s），拖拽可调整`;
}

waveCanvas.addEventListener('mousedown', (e) => {
  if (!audioBuffer) return;
  dragging = true;
  const t = (e.offsetX / waveCanvas.width) * audioBuffer.duration;
  selStart = t; selEnd = t;
});
waveCanvas.addEventListener('mousemove', (e) => {
  if (!dragging || !audioBuffer) return;
  selEnd = (e.offsetX / waveCanvas.width) * audioBuffer.duration;
  redraw(); updateSelInfo();
});
window.addEventListener('mouseup', () => { dragging = false; });

// 模式按钮
let audioMode: CloneMode = 'eq';
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    audioMode = (btn.getAttribute('data-mode') as CloneMode) || 'eq';
  });
});

// 播放选区
playSelBtn.addEventListener('click', async () => {
  if (!audioBuffer) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  // 必须在用户手势中显式 resume（浏览器自动播放策略）
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { /* ignore */ }
  }
  if (playSource) { try { playSource.stop(); } catch { /* ignore */ } playSource = null; return; }
  const s = Math.min(selStart, selEnd), e = Math.max(selStart, selEnd);
  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(ctx.destination);
  src.start(0, s, Math.max(e - s, 0.05));
  playSource = src;
  src.onended = () => { playSource = null; };
});

// 分析选区
document.getElementById('analyzeAudioBtn')!.addEventListener('click', async function () {
  if (!audioBuffer) return;
  const btn = this as HTMLButtonElement;
  btn.disabled = true;
  const bar = document.getElementById('aBar')!;
  const text = document.getElementById('aText')!;
  try {
    bar.style.width = '30%'; text.textContent = '频谱分析...';
    await new Promise(r => setTimeout(r, 50));
    const sr = audioBuffer.sampleRate;
    const ch0 = audioBuffer.getChannelData(0);
    const sIdx = Math.floor(Math.min(selStart, selEnd) * sr);
    const eIdx = Math.floor(Math.max(selStart, selEnd) * sr);
    const sel = ch0.slice(sIdx, Math.max(eIdx, sIdx + sr));

    bar.style.width = '70%'; text.textContent = '匹配效果器...';
    await new Promise(r => setTimeout(r, 50));
    audioResult = analyzeAudioSelection(sel, sr, { mode: audioMode });

    bar.style.width = '100%'; text.textContent = '分析完成！';

    const resultCard = document.getElementById('audioResultCard')!;
    resultCard.classList.remove('section-hidden');
    document.getElementById('aMatchPct')!.textContent = audioResult.matchPct + '%';
    let html = buildFitTableHtml(new Float32Array(audioResult.rawResponse?.freqs ?? []), new Float32Array(audioResult.rawResponse?.response ?? []), audioResult.eqBands);
    if (audioResult.matchedDrive) html += `<tr><td>失真单块</td><td style="color:#ff9800">${audioResult.matchedDrive.name} (THD ${(audioResult.thd * 100).toFixed(1)}%)</td></tr>`;
    if (audioResult.matchedAmp) html += `<tr><td>箱头</td><td style="color:#26c6da">${audioResult.matchedAmp.name}</td></tr>`;
    if (audioResult.matchedCab) html += `<tr><td>箱体</td><td style="color:#8bc34a">${audioResult.matchedCab.name}</td></tr>`;
    html += '</table>';
    document.getElementById('aResultParams')!.innerHTML = html;

    if (audioResult.rawResponse) {
      drawResponseChart(
        document.getElementById('aResultCanvas') as HTMLCanvasElement,
        new Float32Array(audioResult.rawResponse.freqs),
        new Float32Array(audioResult.rawResponse.response),
        audioResult.eqBands
      );
    }
    exportBtn.disabled = false;
  } catch (e) {
    text.textContent = '分析失败: ' + (e instanceof Error ? e.message : String(e));
  } finally {
    btn.disabled = false;
  }
});

// 导出音色文件
exportBtn.addEventListener('click', () => {
  if (!audioResult) return;
  const name = '音频克隆 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const tone = cloneResultToTone(name, audioResult, 'audio');
  downloadTone(tone);
  showToast('音色已导出: ' + tone.name);
});
