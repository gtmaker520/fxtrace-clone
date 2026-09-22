// SPDX-License-Identifier: Apache-2.0
// ui/wizard.ts — 向导式克隆弹窗（设备克隆路径）
// 声明：本文件为作者本人（GTMaker）原创实现，非第三方开源代码。

import type { CloneMode, CloneResult, SavedCloneTone } from '../engine/types';
import { fitEqBands, computeMatchPct, computeDistortionMatchPct } from '../engine/fitting';
import { analyzeFreqProfile, classifyDistortion, computeThdFromPeaks, decomposeHarmonics, computeDynamicRatio, solveDriveFromLevels } from '../engine/analysis';
import type { ClipTopology } from '../engine/analysis';
import { selectDriveEffect, selectAmpModel, selectCabinet } from '../engine/matching';
import { getAudioContext, detectInputSignal, captureBaseline, captureSweepResponse, captureThd, captureThdMultiLevel, captureDynamicLevels, listInputDevices } from '../audio/io';
import { captureWHSweeps } from '../audio/wh-capture';
import { fitStaticNonlinearity } from '../engine/wh-nonlinear';
import { estimateWHLinearStages } from '../engine/wh-linear';
import type { WHModel } from '../engine/wh-model';
import { drawResponseChart, buildFitTableHtml } from './charts';
import { cloneResultToTone, downloadTone } from '../io/tone-file';
import type { SweepPeaks } from '../engine/measurement';

let _modalEl: HTMLElement | null = null;
let _onCloneSaved: ((tone: SavedCloneTone) => void) | null = null;
let _onApply: ((result: CloneResult) => void) | null = null;
let _onWHApply: ((model: WHModel) => void) | null = null;
let _result: CloneResult | null = null;

let _baseline: SweepPeaks | null = null;
let _analyzing = false;
let _recordMediaRecorder: MediaRecorder | null = null;
let _recordStream: MediaStream | null = null;
let _recordTimer: ReturnType<typeof setInterval> | null = null;

export function setOnCloneSaved(cb: (tone: SavedCloneTone) => void): void { _onCloneSaved = cb; }
export function setOnApply(cb: (result: CloneResult) => void): void { _onApply = cb; }
/** P3：W-H 真克隆结果回调（demo 端用 chain.loadWH 应用） */
export function setOnWHApply(cb: (model: WHModel) => void): void { _onWHApply = cb; }

export function showToast(msg: string, duration = 2000): void {
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    padding: '10px 24px', borderRadius: '6px', background: '#333', color: '#fff',
    fontSize: '14px', zIndex: '10000', opacity: '0', transition: 'opacity .3s',
    pointerEvents: 'none',
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function cleanupMedia(): void {
  if (_recordMediaRecorder) { try { _recordMediaRecorder.stop(); } catch { /* ignore */ } _recordMediaRecorder = null; }
  if (_recordStream) { _recordStream.getTracks().forEach(t => t.stop()); _recordStream = null; }
  if (_recordTimer) { clearInterval(_recordTimer); _recordTimer = null; }
}

function closeWizard(): void {
  cleanupMedia();
  if (_modalEl) { _modalEl.remove(); _modalEl = null; }
}

export function openCloneWizard(): void {
  renderWizard();
}

function renderWizard(): void {
  if (_modalEl) _modalEl.remove();
  const overlay = document.createElement('div');
  overlay.className = 'app-modal-overlay';
  overlay.id = 'cloneWizard';

  overlay.innerHTML = `
  <div class="app-modal clone-modal">
    <div class="app-modal-title">FXTrace Clone — 硬件音色克隆</div>
    <div class="clone-body">
      <div class="clone-section" id="cwStep1">
        <div class="clone-step-title"><span class="clone-step-num">1</span> 连接与校准</div>
        <div class="clone-connect-box">
          <div class="clone-connect-icon" id="cwSignalIcon">○</div>
          <div class="clone-connect-text" id="cwConnectText">请将吉他 → 被测单块 → 声卡输入 连接好<br><small>先<b>不接</b>被测设备（直通）做基线校准<br>提示：检测/校准/分析时会从扬声器播放约 2 秒的"由低到高"测试音，属于正常现象；<b>两次测量之间请勿改变系统音量</b>，否则基线失准</small></div>
        </div>
        <div class="clone-detect-row">
          <select id="cwDeviceSel" style="flex:1; padding:6px; background:#161a2e; color:#ccc; border:1px solid #2a2f4a; border-radius:6px; font-size:13px"></select>
          <button class="btn clone-detect-btn" id="cwDetectBtn">检测信号并校准基线</button>
        </div>
      </div>

      <div class="clone-section" id="cwStep2" style="display:none">
        <div class="clone-step-title"><span class="clone-step-num">2</span> 分析模式</div>
        <div class="clone-mode-row">
          <button class="clone-mode-btn active" data-mode="eq">频响匹配<br><small>仅EQ曲线</small></button>
          <button class="clone-mode-btn" data-mode="dist">失真匹配<br><small>EQ + 削波 + 箱头</small></button>
          <button class="clone-mode-btn" data-mode="full">完整克隆<br><small>全部效果器链</small></button>
        </div>
      </div>

      <div class="clone-section" id="cwStep3" style="display:none">
        <div class="clone-step-title"><span class="clone-step-num">3</span> 分析</div>
        <div class="clone-gain-hint">现在<b>接上</b>被测单块，然后开始分析</div>
        <div class="clone-analyze-area">
          <div class="clone-progress-wrap"><div class="clone-progress-bar" id="cwProgressBar"></div></div>
          <div class="clone-progress-text" id="cwProgressText">准备中...</div>
        </div>
        <button class="btn clone-start-btn" id="cwStartBtn">发送测试信号并分析</button>
      </div>

      <div class="clone-section" id="cwStep4" style="display:none">
        <div class="clone-step-title"><span class="clone-step-num">4</span> 分析结果</div>
        <div class="clone-result-area">
          <canvas class="clone-result-canvas" id="cwResultCanvas" width="500" height="200"></canvas>
          <div class="clone-match-info">
            <span class="clone-match-pct" id="cwMatchPct">0%</span>
            <span class="clone-match-label">频响匹配度</span>
            <span class="clone-match-pct" id="cwDistMatchPct" style="margin-left:14px">—</span>
            <span class="clone-match-label">失真匹配度</span>
          </div>
          <div class="clone-result-params" id="cwResultParams"></div>
        </div>
      </div>

      <div class="clone-actions" id="cwActions" style="display:none">
        <button class="btn" id="cwReAnalyze">重新分析</button>
        <button class="btn" id="cwWhBtn">W-H 真克隆</button>
        <button class="btn" id="cwExportBtn">导出音色文件</button>
        <button class="btn btn-primary" id="cwApplyBtn">应用到链路</button>
      </div>
    </div>
    <div class="app-modal-actions">
      <button class="btn" id="cwCloseBtn">关闭</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);
  _modalEl = overlay;

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWizard(); });
  overlay.querySelector('#cwCloseBtn')!.addEventListener('click', closeWizard);

  // 信号检测 + 基线校准（直通状态扫一遍）
  // 输入设备下拉框：填充（权限授予后 label 才可见，检测后重刷一次）
  const deviceSel = overlay.querySelector('#cwDeviceSel') as HTMLSelectElement;
  let selectedDeviceId = '';
  async function refreshDeviceList(): Promise<void> {
    const devices = await listInputDevices();
    if (devices.length === 0) return;
    const prev = selectedDeviceId;
    deviceSel.innerHTML = '';
    for (const d of devices) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `输入设备 ${d.deviceId.slice(0, 8)}…`;
      deviceSel.appendChild(opt);
    }
    // 保持之前的选择（或默认第一项）
    selectedDeviceId = prev && devices.some(d => d.deviceId === prev) ? prev : devices[0].deviceId;
    deviceSel.value = selectedDeviceId;
  }
  refreshDeviceList();
  deviceSel.addEventListener('change', () => { selectedDeviceId = deviceSel.value; });

  overlay.querySelector('#cwDetectBtn')!.addEventListener('click', async function (this: HTMLButtonElement) {
    const btn = this as HTMLButtonElement;
    const connectText = overlay.querySelector('#cwConnectText') as HTMLElement;
    btn.disabled = true;
    btn.textContent = '检测中（最多 3s，请弹奏）...';
    const result = await detectInputSignal(selectedDeviceId || undefined);
    const icon = overlay.querySelector('#cwSignalIcon') as HTMLElement;
    if (result.ok) {
      icon.textContent = '●';
      icon.style.color = '#4caf50';
      btn.textContent = '校准基线中...';
      connectText.innerHTML = '<span style="color:#4caf50">● 信号检测成功</span><br>正在校准声卡基线（请保持直通）...';
      try {
        const ctx = getAudioContext();
        if (!ctx) throw new Error('音频上下文不可用');
        _baseline = await captureBaseline(ctx);
        // 权限已授予，重刷设备列表让 label 显示出来
        await refreshDeviceList();
        connectText.innerHTML = '<span style="color:#4caf50">● 校准完成</span><br>现在接上被测单块，选择分析模式';
        (overlay.querySelector('#cwStep2') as HTMLElement).style.display = '';
        (overlay.querySelector('#cwStep3') as HTMLElement).style.display = '';
        btn.textContent = '● 校准完成';
      } catch (e) {
        connectText.innerHTML = '<span style="color:#ff9800">● 校准失败: ' + (e instanceof Error ? e.message : String(e)) + '</span><br>请重试或检查麦克风连接';
        btn.textContent = '重新检测';
      }
    } else {
      icon.textContent = '●';
      icon.style.color = '#ff5252';
      connectText.innerHTML = '<span style="color:#ff5252">● ' + (result.error || '未检测到信号') + '</span><br>请检查吉他 → 被测单块 → 声卡输入连接';
      btn.textContent = '重新检测';
    }
    btn.disabled = false;
  });

  // 模式选择
  let selectedMode: CloneMode = 'eq';
  overlay.querySelectorAll<HTMLElement>('.clone-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll<HTMLElement>('.clone-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMode = (btn.dataset.mode as CloneMode) || 'eq';
    });
  });

  // 开始分析
  overlay.querySelector('#cwStartBtn')!.addEventListener('click', async function (this: HTMLButtonElement) {
    if (_analyzing) return;
    _analyzing = true;
    const btn = this as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '分析中...';
    const bar = overlay.querySelector('#cwProgressBar') as HTMLElement;
    const text = overlay.querySelector('#cwProgressText') as HTMLElement;

    try {
      const ctx = getAudioContext();
      if (!ctx) throw new Error('音频上下文不可用');
      if (!_baseline) throw new Error('基线未校准，请先执行第 1 步');

      bar.style.width = '10%';
      text.textContent = '采集频响数据...';
      await new Promise(r => setTimeout(r, 100));

      const sweep = await captureSweepResponse(ctx, _baseline);
      bar.style.width = '35%';
      text.textContent = '拟合EQ参数...';
      await new Promise(r => setTimeout(r, 100));

      const eqBands = fitEqBands(sweep.freqs, sweep.response);
      const matchPct = computeMatchPct(sweep.freqs, sweep.response, eqBands);
      const freqProfile = analyzeFreqProfile(sweep.freqs, sweep.response);

      let distortionType: 'soft' | 'hard' | 'none' = 'none';
      let topology: ClipTopology = 'none';
      let driveAmount = 0;
      let thd = 0;
      let dynamicRatio = 1;
      let dynamicThreshold = 0.15;

      if (selectedMode === 'dist' || selectedMode === 'full') {
        bar.style.width = '55%';
        text.textContent = '分析谐波失真（含阶次分解）...';
        await new Promise(r => setTimeout(r, 100));
        const hd = await captureThd(ctx, decomposeHarmonics);
        thd = hd.thd;
        topology = hd.topology;
        distortionType = classifyDistortion(thd);

        if (selectedMode === 'full') {
          // full 模式：3 档多电平扫频反解 drive
          bar.style.width = '62%';
          text.textContent = '多电平扫频反解 drive...';
          await new Promise(r => setTimeout(r, 100));
          const thdLevels = await captureThdMultiLevel(ctx, computeThdFromPeaks);
          const rev = solveDriveFromLevels([0.08, 0.16, 0.32], thdLevels);
          if (rev.ok) {
            driveAmount = rev.drive;
            thd = thdLevels[thdLevels.length - 1]; // 用最高档 THD 作为失真量（更接近实际演奏电平）
            distortionType = classifyDistortion(thd);
            topology = 'none'; // 反解路径用传统查表（分解谱来自单档测量，与多电平档不对应）
          }
        } else {
          driveAmount = 0; // dist 模式保持单档：I/O 路径无法直接反解增益
        }
      }

      if (selectedMode === 'full') {
        bar.style.width = '75%';
        text.textContent = '分析动态响应...';
        await new Promise(r => setTimeout(r, 100));
        const levels = await captureDynamicLevels(ctx);
        const dyn = computeDynamicRatio(levels);
        dynamicRatio = dyn.ratio;
        dynamicThreshold = dyn.threshold;
      }

      bar.style.width = '90%';
      text.textContent = '匹配效果器...';
      await new Promise(r => setTimeout(r, 100));

      const matchedDrive = (selectedMode !== 'eq') ? selectDriveEffect(thd, distortionType, driveAmount, freqProfile, topology) : null;
      // 反解成功时把 drive 写入选型参数（overdrive/bd2/klon 类为 drive/gain，硬削波类为 dist）
      if (matchedDrive && driveAmount > 0) {
        const driveKey = ['drive', 'gain', 'dist'].find(k => k in matchedDrive.params);
        if (driveKey) matchedDrive.params[driveKey] = Math.round(driveAmount * 100) / 100;
      }
      const matchedAmp = (selectedMode !== 'eq') ? selectAmpModel(freqProfile, thd) : null;
      const matchedCab = (selectedMode === 'full') ? selectCabinet(freqProfile) : null;

      // 失真特征匹配度——候选侧用实测特征自评（类型/THD/动态与选型判据的一致性），
      // eq 模式无失真数据时记 100（不适用）
      const distortionMatchPct = selectedMode === 'eq' ? 100
        : computeDistortionMatchPct(
            { distortionType, thd, dynamicRatio },
            { distortionType, thd: Math.max(thd, 0.01), dynamicRatio: Math.max(dynamicRatio, 1) }
          );

      bar.style.width = '100%';
      text.textContent = '分析完成！';

      _result = {
        mode: selectedMode,
        eqBands, matchPct, distortionMatchPct, distortionType, thd, driveAmount,
        levelDb: 0, dynamicRatio, dynamicThreshold,
        freqProfile,
        matchedDrive, matchedAmp, matchedCab,
        rawResponse: { freqs: Array.from(sweep.freqs), response: Array.from(sweep.response) },
      };

      showResult(sweep.freqs, sweep.response, eqBands, matchPct);
    } catch (e) {
      text.textContent = '分析失败: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      _analyzing = false;
      btn.disabled = false;
      btn.textContent = '重新分析';
    }
  });

  // 重新分析
  overlay.querySelector('#cwReAnalyze')!.addEventListener('click', () => {
    (overlay.querySelector('#cwStep4') as HTMLElement).style.display = 'none';
    (overlay.querySelector('#cwActions') as HTMLElement).style.display = 'none';
    (overlay.querySelector('#cwStartBtn') as HTMLElement).textContent = '发送测试信号并分析';
    (overlay.querySelector('#cwProgressBar') as HTMLElement).style.width = '0%';
    (overlay.querySelector('#cwProgressText') as HTMLElement).textContent = '准备中...';
  });

  // 导出音色文件（文件即存储）
  overlay.querySelector('#cwExportBtn')!.addEventListener('click', () => {
    if (!_result) return;
    const name = '克隆音色 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const tone = cloneResultToTone(name, _result, 'device');
    downloadTone(tone);
    showToast('音色已导出: ' + tone.name);
    _onCloneSaved?.(tone);
  });

  // 应用到链路
  overlay.querySelector('#cwApplyBtn')!.addEventListener('click', () => {
    if (!_result) return;
    _onApply?.(_result);
    closeWizard();
  });

  // W-H 真克隆：基于基线做多电平扫频，拟合 Linear→Static→Linear 模型并应用
  overlay.querySelector('#cwWhBtn')!.addEventListener('click', async function (this: HTMLButtonElement) {
    if (!_baseline) { showToast('基线未校准，请先执行第 1 步'); return; }
    const btn = this as HTMLButtonElement;
    btn.disabled = true;
    const bar = overlay.querySelector('#cwProgressBar') as HTMLElement;
    const text = overlay.querySelector('#cwProgressText') as HTMLElement;
    (overlay.querySelector('#cwStep3') as HTMLElement).style.display = '';
    try {
      bar.style.width = '15%';
      text.textContent = 'W-H: 多电平扫频采集（3 档，约 10s）...';
      const cap = await captureWHSweeps();

      bar.style.width = '55%';
      text.textContent = 'W-H: 拟合静态非线性...';
      await new Promise(r => setTimeout(r, 50));
      const nl = fitStaticNonlinearity(cap);

      bar.style.width = '75%';
      text.textContent = 'W-H: 估计线性滤波器...';
      await new Promise(r => setTimeout(r, 50));
      const ctx = getAudioContext();
      if (!ctx) throw new Error('音频上下文不可用');
      const lin = estimateWHLinearStages(cap.sweeps, ctx.sampleRate);

      const model: WHModel = {
        preFilter: lin.pre.coeffs,
        nonlinear: nl.curve,
        postFilter: lin.post.coeffs,
        inputGain: nl.inputGain,
        outputGain: nl.outputGain,
      };

      bar.style.width = '100%';
      text.textContent = `W-H 完成（非线性 RMSE ${nl.rmse.toFixed(3)}，滤波器 RMSE ${lin.pre.rmseDb.toFixed(1)}/${lin.post.rmseDb.toFixed(1)} dB）`;
      showToast('W-H 模型已生成，应用到链路后可直接弹奏');
      _onWHApply?.(model);
    } catch (e) {
      text.textContent = 'W-H 失败: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      btn.disabled = false;
    }
  });

  function showResult(freqs: Float32Array, response: Float32Array, bands: number[], matchPct: number): void {
    (overlay.querySelector('#cwStep4') as HTMLElement).style.display = '';
    (overlay.querySelector('#cwActions') as HTMLElement).style.display = '';
    (overlay.querySelector('#cwMatchPct') as HTMLElement).textContent = matchPct + '%';
    const distEl = overlay.querySelector('#cwDistMatchPct') as HTMLElement;
    if (distEl) distEl.textContent = _result ? _result.distortionMatchPct + '%' : '—';

    let paramsHtml = buildFitTableHtml(freqs, response, bands);
    if (_result) {
      if (_result.matchedDrive) {
        paramsHtml += `<tr><td>失真单块</td><td style="color:#ff9800">${_result.matchedDrive.name} (THD ${(_result.thd * 100).toFixed(1)}%)</td></tr>`;
      } else if (_result.distortionType !== 'none') {
        paramsHtml += `<tr><td>削波类型</td><td>${_result.distortionType === 'soft' ? '软削波' : '硬削波'} (THD ${(_result.thd * 100).toFixed(1)}%)</td></tr>`;
      }
      if (_result.matchedAmp) {
        paramsHtml += `<tr><td>箱头</td><td style="color:#26c6da">${_result.matchedAmp.name} (${_result.matchedAmp.channel === 1 ? '失真通道' : '清音通道'})</td></tr>`;
      }
      if (_result.matchedCab) {
        paramsHtml += `<tr><td>箱体</td><td style="color:#8bc34a">${_result.matchedCab.name}</td></tr>`;
      }
      if (_result.dynamicRatio > 1.2) {
        paramsHtml += `<tr><td>压缩</td><td>压缩比 ${_result.dynamicRatio.toFixed(1)}:1</td></tr>`;
      }
      paramsHtml += '</table>';
    }
    (overlay.querySelector('#cwResultParams') as HTMLElement).innerHTML = paramsHtml;

    drawResponseChart(overlay.querySelector('#cwResultCanvas') as HTMLCanvasElement, freqs, response, bands);
  }
}
