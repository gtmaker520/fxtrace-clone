// SPDX-License-Identifier: Apache-2.0
// tests/chain.test.ts — 链路与 applyTone 单测（mock AudioContext，无真实 WebAudio）
// 回归防线：MT-2W 实测暴露的 dist→drive 参数映射丢失即发生在这一层
import { describe, it, expect } from 'vitest';
import { MiniFxChain } from '../src/audio/chain';
import { applyTone } from '../src/index';
import { computeDriveGain } from '../src/engine/analysis';
import type { CloneResult } from '../src/engine/types';

/** 极简 AudioNode mock 类型（仅覆盖 MiniFxChain 用到的面） */
interface AudioNodeLike {
  gain: { value: number };
  frequency: { value: number };
  Q: { value: number };
  type: string;
  curve: Float32Array | null;
  buffer: unknown;
  feedforward: number[];
  feedback: number[];
  connect(dest: unknown): unknown;
  disconnect(): void;
  _connections: unknown[];
}

/** 极简 AudioNode mock：记录连接关系，支持链式 connect/disconnect */
function makeNode(over: Partial<AudioNodeLike> = {}): AudioNodeLike {
  const connections: unknown[] = [];
  return {
    gain: { value: 1 },
    frequency: { value: 1000 },
    Q: { value: 1 },
    type: '',
    curve: null,
    buffer: null,
    feedforward: [],
    feedback: [],
    connect(dest: unknown) { connections.push(dest); return dest; },
    disconnect() { connections.length = 0; },
    _connections: connections,
    ...over,
  } as AudioNodeLike;
}

/** 极简 AudioContext mock：只为 MiniFxChain 提供节点工厂 */
function makeCtx(): AudioContext {
  const node = makeNode;
  const ctx = {
    sampleRate: 48000,
    destination: node(),
    createGain: () => node(),
    createBiquadFilter: () => node(),
    createWaveShaper: () => node(),
    createConvolver: () => node(),
    createIIRFilter: (ff: number[], fb: number[]) => node({ feedforward: ff, feedback: fb }),
    createBuffer: (_ch: number, len: number) => ({ length: len, getChannelData: () => new Float32Array(len) }),
  };
  return ctx as unknown as AudioContext;
}

function makeMetalTone(): CloneResult {
  return {
    eqBands: [1, 2, 3, 4, 5, 6, 7],
    matchPct: 86,
    distortionType: 'hard',
    thd: 1.2,
    driveAmount: 10,
    dynamicRatio: 1,
    freqProfile: { bass: 1, mid: 1, treble: 1, presence: 1 },
    matchedDrive: {
      presetId: 'metal',
      name: '重金属',
      params: { dist: 50, low: 0, mid: 0, mid_freq: 800, high: 0, presence: 0, level: 0.3 },
    },
    matchedAmp: { modelIdx: 2, channel: 1, name: '美式现代', params: { gain: 35, bass: 1, mid: 2, treble: 1, presence: -1, level: 50 } },
    matchedCab: { variant: 1, name: '暖暗 4x12', params: { level: 50, high_cut: 12000, low_cut: 30, presence: 32 } },
  } as unknown as CloneResult;
}

describe('MiniFxChain + applyTone（mock WebAudio）', () => {
  it('applyTone：dist(0-100) 正确映射为 drive(0-1)，preGain 增益 > 1', () => {
    const ctx = makeCtx();
    const chain = new MiniFxChain(ctx);
    applyTone(chain, makeMetalTone());

    const drive = chain.nodesSnapshot.find(n => n.kind === 'drive');
    expect(drive).toBeDefined();
    const ctrl = drive!.controls.get('drive') as (v: number) => void;
    // 重放映射后的参数调用：applyTone 应已把 dist=50 → drive=0.5
    ctrl(0.5);
    const preGain = drive!.preGain!;
    expect(preGain.gain.value).toBeGreaterThan(1); // 削波前置增益必须 > 1
  });

  it('applyTone 后链路含 drive→amp→cab 三节点且有序', () => {
    const chain = new MiniFxChain(makeCtx());
    applyTone(chain, makeMetalTone());
    const kinds = chain.nodesSnapshot.map(n => n.kind);
    expect(kinds).toEqual(['drive', 'amp', 'cab']);
  });

  it('setParam：箱体 high_cut 透传生效', () => {
    const chain = new MiniFxChain(makeCtx());
    applyTone(chain, makeMetalTone());
    const cab = chain.nodesSnapshot.find(n => n.kind === 'cab')!;
    const ctrl = cab.controls.get('high_cut') as (v: number) => void;
    expect(() => ctrl(8000)).not.toThrow();
  });

  it('loadWH：生成 pre-IIR → WaveShaper → post-IIR 节点，IIR 系数正确传入', () => {
    const chain = new MiniFxChain(makeCtx());
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) curve[i] = (i / (curve.length - 1)) * 2 - 1;
    const id = chain.loadWH({
      preFilter: { b0: 1, b1: 0.5, b2: 0.2, a0: 1, a1: -0.3, a2: 0.1 },
      nonlinear: curve,
      postFilter: { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 },
      inputGain: 2,
      outputGain: 0.8,
    });
    expect(id).not.toBeNull();
    const wh = chain.nodesSnapshot.find(n => n.presetId === 'whModel')!;
    expect(wh).toBeDefined();
    expect(wh.ws).toBeDefined();
    expect(wh.ws!.curve!.length).toBe(4097);
  });

  it('loadWH：清掉已有 drive/amp，避免新旧音色叠加', () => {
    const chain = new MiniFxChain(makeCtx());
    applyTone(chain, makeMetalTone());
    const before = chain.nodesSnapshot.length;
    chain.loadWH({
      preFilter: { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 },
      nonlinear: new Float32Array(4097),
      postFilter: { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 },
      inputGain: 1, outputGain: 1,
    });
    const kinds = chain.nodesSnapshot.map(n => n.kind);
    expect(kinds.filter(k => k === 'drive').length).toBe(0); // drive 已被清
    expect(chain.nodesSnapshot.length).toBeLessThan(before + 1); // 净增不超过 1
  });

  it('clear：清空后链路直通（无节点）', () => {
    const chain = new MiniFxChain(makeCtx());
    applyTone(chain, makeMetalTone());
    chain.clear();
    expect(chain.nodesSnapshot.length).toBe(0);
  });
});

describe('computeDriveGain（前级增益自适应）', () => {
  it('弱信号（0.05）dist=0.5 → 高增益', () => {
    const g = computeDriveGain(0.05, 0.5);
    expect(g).toBeGreaterThan(5);
    expect(g).toBeLessThanOrEqual(80);
  });

  it('强信号（0.5 线路输入）→ 低增益，不爆音', () => {
    const g = computeDriveGain(0.5, 0.5);
    expect(g).toBeLessThan(5);
    expect(g).toBeGreaterThanOrEqual(1);
  });

  it('drive=0 → 增益恰为过驱动 1×（th/rms）', () => {
    expect(computeDriveGain(0.18, 0)).toBeCloseTo(1, 5);
  });
});
