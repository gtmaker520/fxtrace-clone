// SPDX-License-Identifier: Apache-2.0
// audio/chain.ts — 迷你效果器链：单块(Waveshaper) → 箱头 EQ(BiquadFilter) → 箱体 IR(Convolver)
// 声明：本文件为作者本人（GTMaker）原创实现，非第三方开源代码。

import { CURVE_BUILDERS, makeIdentityCurve } from './curves';
import { getCabIR } from '../presets/cabinets';
import { computeDriveGain } from '../engine/analysis';
import { getLastInputRms } from './io';
import type { WHModel } from '../engine/wh-model';

/** 链上节点：一个单块 / 箱头 / 箱体 */
export interface ChainNode {
  id: string;
  kind: 'drive' | 'amp' | 'cab';
  presetId: string;
  input: GainNode;
  output: GainNode;
  /** 内部可调节点（按参数名索引） */
  controls: Map<string, AudioNode | ((value: number) => void)>;
  ws?: WaveShaperNode;
  preGain?: GainNode;
  bypassed: boolean;
}

/**
 * 迷你效果器链（单链）：
 *   input → [drive…] → ampEQ(4段) → cabIR(Convolver) → masterGain → destination
 * 与原项目不同，这里没有 AudioWorklet 箱头建模，箱头用 4 段 BiquadEQ 近似，
 * 失真质感全部由单块 Waveshaper 曲线承担。
 */
export class MiniFxChain {
  readonly ctx: AudioContext;
  readonly input: GainNode;
  readonly masterGain: GainNode;
  private nodes: ChainNode[] = [];
  private _amp: ChainNode | null = null;
  private _cab: ChainNode | null = null;
  private idCounter = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.masterGain = ctx.createGain();
    this.input.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);
  }

  get nodesSnapshot(): ReadonlyArray<Readonly<ChainNode>> {
    return this.nodes;
  }

  private nextId(): string {
    return 'node_' + (++this.idCounter) + '_' + Date.now().toString(36);
  }

  private insertNode(node: ChainNode, afterId?: string): void {
    // 找插入点：afterId 节点之后；否则接在链尾（masterGain 之前）
    const tail = this.masterGain;
    let connectTo: AudioNode = tail;
    if (afterId) {
      const idx = this.nodes.findIndex(n => n.id === afterId);
      if (idx >= 0 && idx < this.nodes.length - 1) {
        const nextNode = this.nodes[idx + 1];
        connectTo = nextNode.input;
        nextNode.input.disconnect();
        node.output.connect(nextNode.input);
      }
    }
    node.input.disconnect();
    node.output.connect(connectTo);
    // 前一个节点（或链头）接到新节点
    if (this.nodes.length === 0) {
      this.input.disconnect();
      this.input.connect(node.input);
    } else {
      const prev = afterId
        ? this.nodes[this.nodes.findIndex(n => n.id === afterId)]
        : this.nodes[this.nodes.length - 1];
      if (prev) {
        prev.output.disconnect();
        prev.output.connect(node.input);
      }
    }
    this.nodes.push(node);
    // 维护链序：drive 在 amp 前，cab 永远最后
    this.nodes.sort((a, b) => chainRank(a) - chainRank(b));
  }

  /** 加载失真单块（presetId ∈ overdrive/bd2/klon/distortion/metal/rat/chainsaw） */
  loadDrive(presetId: string): string | null {
    const builder = CURVE_BUILDERS[presetId];
    if (!builder) return null;
    const ctx = this.ctx;
    const input = ctx.createGain();
    const preGain = ctx.createGain();
    const ws = ctx.createWaveShaper();
    ws.curve = builder(0.35, ctx.sampleRate) as unknown as Float32Array<ArrayBuffer>;
    const output = ctx.createGain();
    input.connect(preGain);
    preGain.connect(ws);
    ws.connect(output);

    const node: ChainNode = {
      id: this.nextId(),
      kind: 'drive',
      presetId,
      input, output, ws, preGain,
      bypassed: false,
      controls: new Map([
        // 前级增益自适应：按信号检测时实测输入 RMS 计算（目标 2.5×过驱动），
        // 替代固定系数——弱麦克风信号与线路输入都能正确进入削波区
        ['drive', (v: number) => {
          preGain.gain.value = computeDriveGain(getLastInputRms(), v);
          ws.curve = builder(v, ctx.sampleRate) as unknown as Float32Array<ArrayBuffer>;
        }],
        ['level', (v: number) => { output.gain.value = v * 2; }],
      ]),
    };
    this.insertNode(node);
    return node.id;
  }

  /** 加载箱头（4 段 EQ 近似 + 输入增益模拟 gain） */
  loadAmp(): string | null {
    if (this._amp) return this._amp.id;
    const ctx = this.ctx;
    const input = ctx.createGain();
    const gainStage = ctx.createGain();
    const bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 140;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 800;
    mid.Q.value = 1.2;
    const treble = ctx.createBiquadFilter();
    treble.type = 'highshelf';
    treble.frequency.value = 3200;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 4400;
    presence.Q.value = 1.1;
    const output = ctx.createGain();

    input.connect(gainStage);
    gainStage.connect(bass);
    bass.connect(mid);
    mid.connect(treble);
    treble.connect(presence);
    presence.connect(output);

    const node: ChainNode = {
      id: this.nextId(),
      kind: 'amp',
      presetId: 'ampSim',
      input, output,
      bypassed: false,
      controls: new Map([
        ['gain', (v: number) => { gainStage.gain.value = Math.pow(10, v / 20); }],
        ['bass', (v: number) => { bass.gain.value = v; }],
        ['mid', (v: number) => { mid.gain.value = v; }],
        ['treble', (v: number) => { treble.gain.value = v; }],
        ['presence', (v: number) => { presence.gain.value = v; }],
        ['level', (v: number) => { output.gain.value = v / 50; }],
      ]),
    };
    this.insertNode(node);
    this._amp = node;
    return node.id;
  }

  /** 加载箱体 IR（程序生成，纯线性响应，永远在链路最后） */
  loadCab(variant: number): string | null {
    if (this._cab) this.removeNode(this._cab.id);
    const ctx = this.ctx;
    const input = ctx.createGain();
    const lowCut = ctx.createBiquadFilter();
    lowCut.type = 'highpass';
    lowCut.frequency.value = 30;
    const conv = ctx.createConvolver();
    conv.buffer = getCabIR(ctx, variant);
    const highCut = ctx.createBiquadFilter();
    highCut.type = 'lowpass';
    highCut.frequency.value = 16000;
    const output = ctx.createGain();

    input.connect(lowCut);
    lowCut.connect(conv);
    conv.connect(highCut);
    highCut.connect(output);

    const node: ChainNode = {
      id: this.nextId(),
      kind: 'cab',
      presetId: 'cabIR',
      input, output,
      bypassed: false,
      controls: new Map([
        ['variant', (v: number) => { conv.buffer = getCabIR(ctx, Math.round(v)); }],
        ['high_cut', (v: number) => { highCut.frequency.value = v; }],
        ['low_cut', (v: number) => { lowCut.frequency.value = v; }],
        ['level', (v: number) => { output.gain.value = v / 50; }],
      ]),
    };
    // cab 永远接在 masterGain 之前、amp 之后
    this.insertNode(node, this._amp?.id);
    this._cab = node;
    return node.id;
  }

  /**
   * 加载 Wiener-Hammerstein 节点（P3 真克隆）：
   * preFilter(IIR) → inputGain → WaveShaper(拟合曲线) → postFilter(IIR) → outputGain
   * 占据 drive+amp 的位置（清掉已有 drive/amp），cab 可保留。
   */
  loadWH(model: WHModel): string | null {
    // WH 自带完整音色，清掉已有 drive/amp
    for (const n of this.nodes.filter(n => n.kind === 'drive' || n.kind === 'amp')) {
      this.removeNode(n.id);
    }
    const ctx = this.ctx;
    const input = ctx.createGain();
    const inGain = ctx.createGain();
    inGain.gain.value = model.inputGain;

    // IIRFilterNode 承载任意 Biquad 系数（Web Audio 的 BiquadFilterNode 不接受自定义系数）
    const pre = ctx.createIIRFilter([model.preFilter.b0, model.preFilter.b1, model.preFilter.b2], [model.preFilter.a0, model.preFilter.a1, model.preFilter.a2]);
    const ws = ctx.createWaveShaper();
    ws.curve = model.nonlinear as unknown as Float32Array<ArrayBuffer>;
    const post = ctx.createIIRFilter([model.postFilter.b0, model.postFilter.b1, model.postFilter.b2], [model.postFilter.a0, model.postFilter.a1, model.postFilter.a2]);
    const outGain = ctx.createGain();
    outGain.gain.value = model.outputGain;
    const output = ctx.createGain();

    input.connect(inGain);
    inGain.connect(pre);
    pre.connect(ws);
    ws.connect(post);
    post.connect(outGain);
    outGain.connect(output);

    const node: ChainNode = {
      id: this.nextId(),
      kind: 'amp',
      presetId: 'whModel',
      input, output, ws,
      bypassed: false,
      controls: new Map<string, (value: never) => void>([
        ['input_gain', ((v: number) => { inGain.gain.value = v; }) as never],
        ['output_gain', ((v: number) => { outGain.gain.value = v; }) as never],
        ['curve', ((c: Float32Array) => { ws.curve = c as unknown as Float32Array<ArrayBuffer>; }) as never],
      ]) as ChainNode['controls'],
    };
    this.insertNode(node, this.nodes[0]?.id);
    this._amp = node;
    return node.id;
  }

  /** 设置节点参数 */
  setParam(nodeId: string, paramId: string, value: number): boolean {
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) return false;
    const ctrl = node.controls.get(paramId);
    if (typeof ctrl === 'function') { ctrl(value); return true; }
    return false;
  }

  setBypass(nodeId: string, bypassed: boolean): boolean {
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) return false;
    if (node.bypassed === bypassed) return true;
    node.bypassed = bypassed;
    try {
      if (bypassed) node.input.disconnect();
      else node.input.connect(node.ws ?? node.input);
      if (!bypassed && node.ws) node.ws.connect(node.output);
      else if (node.ws) node.ws.disconnect();
      if (!bypassed && !node.ws) node.input.connect(node.output);
    } catch { /* 边缘情况忽略 */ }
    // 直通时保证输出仍接在链上
    return true;
  }

  removeNode(nodeId: string): boolean {
    const idx = this.nodes.findIndex(n => n.id === nodeId);
    if (idx < 0) return false;
    const [node] = this.nodes.splice(idx, 1);
    try {
      node.input.disconnect();
      node.output.disconnect();
      node.ws?.disconnect();
    } catch { /* ignore */ }
    this.rebuild();
    if (this._amp?.id === nodeId) this._amp = null;
    if (this._cab?.id === nodeId) this._cab = null;
    return true;
  }

  /** 清空所有节点 */
  clear(): void {
    for (const n of this.nodes) {
      try { n.input.disconnect(); n.output.disconnect(); n.ws?.disconnect(); } catch { /* ignore */ }
    }
    this.nodes = [];
    this._amp = null;
    this._cab = null;
    try { this.input.disconnect(); } catch { /* ignore */ }
    this.input.connect(this.masterGain);
  }

  /** 按链序重建连接（drive → amp → cab → master） */
  rebuild(): void {
    try { this.input.disconnect(); } catch { /* ignore */ }
    let prev: AudioNode = this.input;
    for (const n of this.nodes) {
      try { n.input.disconnect(); } catch { /* ignore */ }
      prev.connect(n.input);
      if (n.ws) { try { n.ws.disconnect(); } catch { /* ignore */ } n.input.connect(n.ws); n.ws.connect(n.output); }
      else { n.input.connect(n.output); }
      prev = n.output;
    }
    prev.connect(this.masterGain);
  }
}

function chainRank(n: ChainNode): number {
  if (n.kind === 'drive') return 0;
  if (n.kind === 'amp') return 1;
  return 2;
}

export { makeIdentityCurve };
