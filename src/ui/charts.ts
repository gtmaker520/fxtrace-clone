// SPDX-License-Identifier: Apache-2.0
// ui/charts.ts — 频响曲线 canvas 绘制（从原 clone-pedal.ts showResult 抽出）
// 声明：原实现为作者本人（GTMaker）自研项目 Guitar-X 中的自有代码，非第三方开源代码，本文件为作者自主改编。

import { predictResponse } from '../engine/fitting';

export interface ChartOptions {
  /** 图表整体均值（dB），用于把拟合曲线上下平移到与数据同电平 */
  responseMean?: number;
}

/**
 * 在 canvas 上绘制：橙色目标频响曲线 + 青色 7 段 EQ 拟合曲线。
 */
export function drawResponseChart(
  canvas: HTMLCanvasElement,
  freqs: Float32Array,
  response: Float32Array,
  bands: number[],
  opts: ChartOptions = {}
): void {
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx2d.scale(dpr, dpr);
  ctx2d.clearRect(0, 0, w, h);

  const padL = 40, padR = 10, padT = 10, padB = 24;
  const gw = w - padL - padR;
  const gh = h - padT - padB;
  const minF = 20, maxF = 20000;

  let responseSum = 0;
  for (let i = 0; i < response.length; i++) responseSum += response[i];
  const responseMean = opts.responseMean ?? (response.length > 0 ? responseSum / response.length : 0);

  // 自适应 Y 轴范围：基于实际响应数据
  let dataMin = 0, dataMax = 0;
  for (let i = 0; i < response.length; i++) {
    if (response[i] < dataMin) dataMin = response[i];
    if (response[i] > dataMax) dataMax = response[i];
  }
  const dataPad = Math.max(3, (dataMax - dataMin) * 0.15);
  const minDB = Math.floor((dataMin - dataPad) / 5) * 5;
  const maxDB = Math.ceil((dataMax + dataPad) / 5) * 5;

  const freqToX = (f: number) => padL + (Math.log(f / minF) / Math.log(maxF / minF)) * gw;
  const dbToY = (db: number) => padT + gh - ((db - minDB) / (maxDB - minDB)) * gh;

  // 网格
  ctx2d.strokeStyle = 'rgba(255,255,255,.07)';
  ctx2d.lineWidth = 1;
  const gridStep = (maxDB - minDB) <= 20 ? 5 : 10;
  for (let db = Math.ceil(minDB / gridStep) * gridStep; db <= maxDB; db += gridStep) {
    const y = dbToY(db);
    ctx2d.beginPath(); ctx2d.moveTo(padL, y); ctx2d.lineTo(padL + gw, y); ctx2d.stroke();
  }
  const zeroY = dbToY(0);
  if (zeroY >= padT && zeroY <= padT + gh) {
    ctx2d.strokeStyle = 'rgba(255,255,255,.2)';
    ctx2d.setLineDash([4, 3]);
    ctx2d.beginPath(); ctx2d.moveTo(padL, zeroY); ctx2d.lineTo(padL + gw, zeroY); ctx2d.stroke();
    ctx2d.setLineDash([]);
  }

  // 坐标轴文字
  ctx2d.fillStyle = 'rgba(255,255,255,.35)';
  ctx2d.font = '9px sans-serif';
  ctx2d.textAlign = 'center';
  [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach(f => {
    ctx2d.fillText(f >= 1000 ? (f / 1000) + 'k' : f + '', freqToX(f), padT + gh + 14);
  });
  ctx2d.textAlign = 'right';
  for (let db = Math.ceil(minDB / gridStep) * gridStep; db <= maxDB; db += gridStep) {
    if (db === 0) continue;
    ctx2d.fillText(db > 0 ? '+' + db : db + '', padL - 4, dbToY(db) + 3);
  }

  // 目标曲线（橙色）
  if (freqs.length > 0) {
    ctx2d.strokeStyle = '#ff9800';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      const x = freqToX(freqs[i]);
      const y = dbToY(Math.max(minDB, Math.min(maxDB, response[i])));
      if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
  }

  // 拟合曲线（青色）
  ctx2d.strokeStyle = '#26c6da';
  ctx2d.lineWidth = 2;
  ctx2d.beginPath();
  for (let px = 0; px <= gw; px++) {
    const f = minF * Math.pow(maxF / minF, px / gw);
    const displayVal = predictResponse(f, bands) + responseMean;
    const y = dbToY(Math.max(minDB, Math.min(maxDB, displayVal)));
    const x = padL + px;
    if (px === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
  }
  ctx2d.stroke();

  // 图例
  ctx2d.font = '10px sans-serif';
  ctx2d.textAlign = 'left';
  ctx2d.fillStyle = '#ff9800';
  ctx2d.fillRect(padL + 8, padT + 4, 14, 3);
  ctx2d.fillText('目标曲线', padL + 28, padT + 10);
  ctx2d.fillStyle = '#26c6da';
  ctx2d.fillRect(padL + 8, padT + 18, 14, 3);
  ctx2d.fillText('拟合曲线', padL + 28, padT + 24);
}

/** 生成 7 段 EQ 拟合表 HTML（频段/实际响应/拟合值/偏差） */
export function buildFitTableHtml(freqs: Float32Array, response: Float32Array, bands: number[]): string {
  const labels = ['100', '200', '400', '800', '1.6k', '3.2k', '6.4k'];
  const eqFreqs = [100, 200, 400, 800, 1600, 3200, 6400];

  let responseSum = 0;
  for (let i = 0; i < response.length; i++) responseSum += response[i];
  const responseMean = response.length > 0 ? responseSum / response.length : 0;
  const normResponse = new Float32Array(response.length);
  for (let i = 0; i < response.length; i++) normResponse[i] = response[i] - responseMean;

  const actualAvg = new Array(7).fill(0);
  for (let b = 0; b < 7; b++) {
    const logTarget = Math.log(eqFreqs[b]);
    let wSum = 0, rSum = 0;
    for (let i = 0; i < freqs.length; i++) {
      const logF = Math.log(freqs[i]);
      const dist = (logF - logTarget) / 0.25;
      const w = Math.exp(-0.5 * dist * dist);
      if (w < 0.01) continue;
      rSum += normResponse[i] * w;
      wSum += w;
    }
    if (wSum > 0) actualAvg[b] = rSum / wSum;
  }

  let html = '<table class="clone-params-table"><tr><th>频段</th><th>实际响应</th><th>拟合值</th><th>偏差</th></tr>';
  for (let i = 0; i < 7; i++) {
    const v = bands[i];
    const a = actualAvg[i];
    const dev = a - v;
    const devColor = Math.abs(dev) > 6 ? '#ff5252' : Math.abs(dev) > 3 ? '#ff9800' : '#4caf50';
    html += `<tr><td>${labels[i]}</td><td>${a > 0 ? '+' : ''}${a.toFixed(1)} dB</td><td>${v > 0 ? '+' : ''}${v.toFixed(1)} dB</td><td style="color:${devColor}">${dev > 0 ? '+' : ''}${dev.toFixed(1)} dB</td></tr>`;
  }
  return html;
}

/** 波形绘制（录音回放/选区用） */
export function drawWaveform(canvas: HTMLCanvasElement, data: Float32Array, bg = 'rgba(38,198,218,.15)', fg = '#26c6da'): void {
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;
  const w = canvas.width, h = canvas.height;
  const step = Math.max(1, Math.ceil(data.length / w));
  const amp = h / 2;
  ctx2d.fillStyle = bg;
  ctx2d.fillRect(0, 0, w, h);
  ctx2d.strokeStyle = fg;
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  for (let i = 0; i < w; i++) {
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const idx = i * step + j;
      if (idx < data.length) {
        if (data[idx] < min) min = data[idx];
        if (data[idx] > max) max = data[idx];
      }
    }
    ctx2d.moveTo(i, (1 + min) * amp);
    ctx2d.lineTo(i, (1 + max) * amp);
  }
  ctx2d.stroke();
}
