// SPDX-License-Identifier: Apache-2.0
// tests/file-clone.test.ts — 路径 B（音频文件克隆）引擎层精度验证
// 核心验收：合成"清音 vs 失真"两段信号，analyzeAudioSelection 必须能区分——
// 失真段应被判 hard/soft 削波且 THD 显著高于清音段（9 号改进项的引擎层回归防线）
import { describe, it, expect } from 'vitest';
import { analyzeAudioSelection, estimateDistortion } from '../src/io/file-clone';

const SR = 44100;

/** 合成"清音"：纯和弦衰减（无削波，类指弹尾音） */
function makeCleanSignal(): Float32Array {
  const len = Math.floor(SR * 2);
  const out = new Float32Array(len);
  const notes = [82.4, 123.5, 164.8, 207.7]; // E2 A2 E3 G#3
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 1.5);
    let v = 0;
    for (const f of notes) v += Math.sin(2 * Math.PI * f * t) / notes.length;
    out[i] = v * env * 0.6;
  }
  return out;
}

/** 合成"失真"：同样的和弦过高增益 tanh 削波（大量奇次谐波） */
function makeDistortedSignal(): Float32Array {
  const clean = makeCleanSignal();
  const out = new Float32Array(clean.length);
  const drive = 12; // 深度过驱动
  for (let i = 0; i < clean.length; i++) {
    out[i] = Math.tanh(clean[i] * drive) * 0.8;
  }
  return out;
}

describe('路径 B：失真 vs 清音可区分性（引擎层验收）', () => {
  it('estimateDistortion：失真段 THD 显著高于清音段（≥3 倍）', () => {
    const thdClean = estimateDistortion(makeCleanSignal(), SR);
    const thdDist = estimateDistortion(makeDistortedSignal(), SR);
    expect(thdDist).toBeGreaterThan(thdClean * 3);
  });

  it('analyzeAudioSelection(dist 模式)：失真段判为削波类、清音段不判失真', () => {
    const dist = analyzeAudioSelection(makeDistortedSignal(), SR, { mode: 'dist' });
    const clean = analyzeAudioSelection(makeCleanSignal(), SR, { mode: 'dist' });
    // 失真段：应识别出削波类型
    expect(dist.distortionType).not.toBe('none');
    // 清音段：低 THD（缩放后 < 0.1 阈值 → 不判 hard）
    expect(clean.distortionType).not.toBe('hard');
    expect(dist.thd).toBeGreaterThan(clean.thd * 2);
  });

  it('analyzeAudioSelection：两段都产出有效音色文件要素（频响/选型/匹配度）', () => {
    for (const sig of [makeCleanSignal(), makeDistortedSignal()]) {
      const r = analyzeAudioSelection(sig, SR, { mode: 'full' });
      expect(r.matchPct).toBeGreaterThanOrEqual(0);
      expect(r.matchPct).toBeLessThanOrEqual(100);
      expect(r.rawResponse?.freqs.length).toBeGreaterThan(0);
      expect(r.matchedAmp).not.toBeNull();
      expect(r.matchedCab).not.toBeNull();
    }
  });
});
