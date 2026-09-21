// SPDX-License-Identifier: Apache-2.0
// audio/io.ts — WebAudio I/O 胶水：getUserMedia、扫频采集、基线校准
// （提取自原 clone-pedal.ts 的声卡 I/O 路径）
// 声明：原实现为作者本人（GTMaker）自研项目 Guitar-X 中的自有代码，非第三方开源代码，本文件为作者自主改编。

import { SWEEP_DURATION, SWEEP_FFT, SWEEP_GAIN, FREQ_MIN, FREQ_MAX, extractValidBins, calibrateResponse } from '../engine/measurement';
import type { SweepPeaks } from '../engine/measurement';

/**
 * 离线渲染 20Hz→20kHz 指数扫频缓冲（供回放经被测设备采集）。
 * amplitude 控制扫频电平（P2② 多电平扫频用）。
 * WebAudio 依赖位于 audio 层，engine 只保留参数与纯逻辑。
 */
export async function renderSweepBuffer(ctx: BaseAudioContext, amplitude: number = SWEEP_GAIN): Promise<AudioBuffer> {
  const sr = ctx.sampleRate;
  const bufLen = Math.floor(sr * SWEEP_DURATION);
  const offline = new OfflineAudioContext(1, bufLen + SWEEP_FFT, sr);
  const osc = offline.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(FREQ_MIN, 0);
  osc.frequency.exponentialRampToValueAtTime(FREQ_MAX, SWEEP_DURATION);
  const gain = offline.createGain();
  gain.gain.setValueAtTime(amplitude, 0);
  osc.connect(gain);
  gain.connect(offline.destination);
  osc.start(0);
  osc.stop(SWEEP_DURATION);
  return offline.startRendering();
}

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/** 共享 AudioContext（惰性创建，浏览器需用户手势后 resume） */
let _ctx: AudioContext | null = null;
export function getAudioContext(): AudioContext | null {
  try {
    if (!_ctx || _ctx.state === 'closed') {
      _ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    if (_ctx.state === 'suspended') { try { _ctx.resume(); } catch { /* ignore */ } }
    return _ctx;
  } catch {
    return null;
  }
}

export function closeAudioContext(): void {
  if (_ctx && _ctx.state !== 'closed') { try { _ctx.close(); } catch { /* ignore */ } }
  _ctx = null;
}

/** 信号检测：打开输入 200ms，测 RMS，判断是否有信号进入声卡 */
export async function detectInputSignal(): Promise<{ ok: boolean; error?: string }> {
  const ctx = getAudioContext();
  if (!ctx) return { ok: false, error: '音频上下文不可用' };
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
    const src = ctx.createMediaStreamSource(stream);
    const anl = ctx.createAnalyser();
    anl.fftSize = 2048;
    src.connect(anl);
    const buf = new Uint8Array(anl.frequencyBinCount);
    await new Promise(r => setTimeout(r, 200));
    anl.getByteTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; rms += v * v; }
    rms = Math.sqrt(rms / buf.length);
    src.disconnect();
    anl.disconnect();
    return rms > 0.005 ? { ok: true } : { ok: false, error: '未检测到输入信号，请检查吉他和声卡连接' };
  } catch (e) {
    const msg = e instanceof DOMException && e.name === 'NotAllowedError'
      ? '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风'
      : e instanceof DOMException && e.name === 'NotFoundError'
        ? '未找到音频输入设备，请连接声卡'
        : '信号检测失败: ' + (e instanceof Error ? e.message : String(e));
    return { ok: false, error: msg };
  } finally {
    stream?.getTracks().forEach(t => t.stop());
  }
}

async function openMic(ctx: AudioContext): Promise<{ src: MediaStreamAudioSourceNode; stream: MediaStream }> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
  } catch (e) {
    throw new Error('无法访问音频输入，请检查声卡连接和麦克风权限：' + (e instanceof Error ? e.message : String(e)));
  }
  return { src: ctx.createMediaStreamSource(stream), stream };
}

async function closeMic(stream: MediaStream, ...nodes: Array<AudioNode | null>): Promise<void> {
  for (const n of nodes) { if (n) { try { n.disconnect(); } catch { /* ignore */ } } }
  stream.getTracks().forEach(t => t.stop());
}

/** 播放缓冲到输出，同时用分析器峰值采集输入（每次采样取各 bin 峰值） */
async function playAndCapturePeaks(ctx: AudioContext, buf: AudioBuffer, fftSize: number, smoothing: number): Promise<Float32Array> {
  const { src: micSrc, stream } = await openMic(ctx);
  const anl = ctx.createAnalyser();
  anl.fftSize = fftSize;
  anl.smoothingTimeConstant = smoothing;
  micSrc.connect(anl);

  const binCount = anl.frequencyBinCount;
  const peak = new Float32Array(binCount).fill(-Infinity);
  const tmp = new Float32Array(binCount);

  const player = ctx.createBufferSource();
  player.buffer = buf;
  player.connect(ctx.destination);

  const iv = setInterval(() => {
    anl.getFloatFrequencyData(tmp);
    for (let i = 0; i < binCount; i++) {
      if (tmp[i] > peak[i]) peak[i] = tmp[i];
    }
  }, 8);

  player.start(0);
  await new Promise<void>(r => { player.onended = () => r(); });
  clearInterval(iv);
  player.disconnect();
  await closeMic(stream, micSrc, anl);
  return peak;
}

/** 扫频测量：播放扫频 → 采集输入峰值 → 提取有效频点 */
export async function captureSweepPeaks(ctx: AudioContext, sweepBuf: AudioBuffer): Promise<SweepPeaks> {
  const peak = await playAndCapturePeaks(ctx, sweepBuf, SWEEP_FFT, 0);
  return extractValidBins(peak, ctx.sampleRate, SWEEP_FFT);
}

/** 基线校准：不接被测设备时扫一遍，记录声卡 I/O 自身频响 */
export async function captureBaseline(ctx: AudioContext): Promise<SweepPeaks> {
  const sweepBuf = await renderSweepBuffer(ctx);
  return captureSweepPeaks(ctx, sweepBuf);
}

/** 测量：接上被测设备后扫一遍，减去基线得到设备频响 */
export async function captureSweepResponse(ctx: AudioContext, baseline: SweepPeaks): Promise<{ freqs: Float32Array; response: Float32Array }> {
  const sweepBuf = await renderSweepBuffer(ctx);
  const measured = await captureSweepPeaks(ctx, sweepBuf);
  return calibrateResponse(measured, baseline);
}

/** THD 测量：播放 440Hz 正弦（1s），采集输入，回调解析峰值谱（THD 或谐波分解） */
export async function captureThd<T>(
  ctx: AudioContext,
  analyze: (peak: Float32Array, sampleRate: number, fftSize: number, freq: number) => T
): Promise<T> {
  const sr = ctx.sampleRate;
  const dur = 1;
  const freq = 440;
  const len = Math.floor(sr * dur);

  const offline = new OfflineAudioContext(1, len, sr);
  const osc = offline.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const g = offline.createGain();
  g.gain.value = 0.15;
  osc.connect(g);
  g.connect(offline.destination);
  osc.start(0);
  osc.stop(dur);
  const buf = await offline.startRendering();

  const peak = await playAndCapturePeaks(ctx, buf, 4096, 0);
  return analyze(peak, sr, 4096, freq);
}

/** 多电平 THD 采集的默认激励电平档位（P2②） */
export const DRIVE_LEVELS = [0.08, 0.16, 0.32];

/**
 * P2② 多电平扫频 THD 采集：对每档电平播放 440Hz 正弦并测量 THD，
 * 返回与 DRIVE_LEVELS 一一对应的 THD 数组，供 solveDriveFromLevels 反解 drive。
 */
export async function captureThdMultiLevel(
  ctx: AudioContext,
  computeThd: (peak: Float32Array, sampleRate: number, fftSize: number, freq: number) => number,
  levels: number[] = DRIVE_LEVELS
): Promise<number[]> {
  const sr = ctx.sampleRate;
  const dur = 1;
  const freq = 440;
  const len = Math.floor(sr * dur);
  const thds: number[] = [];

  for (const amp of levels) {
    const offline = new OfflineAudioContext(1, len, sr);
    const osc = offline.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = offline.createGain();
    g.gain.value = amp;
    osc.connect(g);
    g.connect(offline.destination);
    osc.start(0);
    osc.stop(dur);
    const buf = await offline.startRendering();
    const peak = await playAndCapturePeaks(ctx, buf, 4096, 0);
    thds.push(computeThd(peak, sr, 4096, freq));
  }
  return thds;
}

/** 动态分析：生成变幅噪声播放 2s，分段采集 RMS，交给纯逻辑计算压缩比 */
export async function captureDynamicLevels(ctx: AudioContext, frames = 40): Promise<number[]> {
  const sr = ctx.sampleRate;
  const dur = 2;
  const len = Math.floor(sr * dur);

  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    d[i] = (Math.random() * 2 - 1) * 0.3 * (1 + 0.8 * Math.sin(i / sr * 0.5 * Math.PI * 2));
  }

  const { src: micSrc, stream } = await openMic(ctx);
  const anl = ctx.createAnalyser();
  anl.fftSize = 1024;
  anl.smoothingTimeConstant = 0.1;
  micSrc.connect(anl);

  const player = ctx.createBufferSource();
  player.buffer = buf;
  player.connect(ctx.destination);
  player.start(0);

  const levels: number[] = [];
  const frameDur = (dur * 1000) / frames;
  try {
    for (let f = 0; f < frames; f++) {
      await new Promise(r => setTimeout(r, frameDur));
      const tbuf = new Uint8Array(anl.frequencyBinCount);
      anl.getByteTimeDomainData(tbuf);
      let rms = 0;
      for (let i = 0; i < tbuf.length; i++) {
        const a = (tbuf[i] - 128) / 128;
        rms += a * a;
      }
      levels.push(Math.sqrt(rms / tbuf.length));
    }
  } finally {
    player.disconnect();
    await closeMic(stream, micSrc, anl);
  }
  return levels;
}
