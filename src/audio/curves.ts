// SPDX-License-Identifier: Apache-2.0
// audio/curves.ts — WaveShaper 削波曲线子集（提取自原 Guitar-X js/dsp/curves.ts）
// 声明：原实现为作者本人（GTMaker）自研项目 Guitar-X 中的自有代码，非第三方开源代码，本文件为作者自主改编。
// 每种曲线对应真实电路的非对称/对称削波特性。只保留克隆选型会用到的 7 种。
// 注：sr 参数保留以匹配统一构建器签名（CURVE_BUILDERS）。

/** WaveShaper 曲线长度：固定 4097（奇数，符合 Web Audio 规范） */
export const WS_CURVE_LENGTH = 4097;

// 对称软削波：两个反并联硅二极管（1N4148）在运放反馈环路中，
// 正负半周阈值相同 → 纯奇次谐波 = TS 风格"温暖中频推升"。
export function makeOverdriveCurve(amount: number, _sr: number) {
  const n = WS_CURVE_LENGTH;
  const curve = new Float32Array(n);
  const a = Math.max(0.01, amount);
  const k = a * 4.0;  // 对称：正负半周相同增益
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k);
  }
  return curve;
}

// 干净线性区 + 高阈值非对称软膝削波：小信号段完全线性直通（保留触弦瞬态与动态），
// 越过阈值后进入软膝 tanh 压缩；正负阈值微不对称 → 少量 2 次谐波。
export function makeBluesDriverCurve(amount: number, _sr: number) {
  const n = WS_CURVE_LENGTH;
  const curve = new Float32Array(n);
  const a = Math.max(0, Math.min(1, amount));
  const tP = 0.65 - a * 0.4;  // 正半周阈值 0.65→0.25
  const tN = tP - 0.07;       // 负半周稍早饱和
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    if (x >= 0) {
      curve[i] = x <= tP ? x : tP + (1 - tP) * Math.tanh((x - tP) / (1 - tP));
    } else {
      const ax = -x;
      curve[i] = ax <= tN ? x : -(tN + (1 - tN) * Math.tanh((ax - tN) / (1 - tN)));
    }
  }
  return curve;
}

// 锗二极管对 + 高余量：阈值高、硬边、基本对称。
// 驱动旋钮通过"前级增益 + 干湿平行混合"产生透明感。
export function makeKlonCurve(amount: number, _sr: number) {
  const n = WS_CURVE_LENGTH;
  const curve = new Float32Array(n);
  const a = Math.max(0, Math.min(1, amount));
  const thP = 0.5 - a * 0.02;
  const thN = thP * 1.04;
  const k = 10 + a * 14;
  const mk = 1 + a * 0.3;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const th = x >= 0 ? thP : thN;
    const y = ax <= th ? x : Math.sign(x) * (th + (1 - th) * Math.tanh((ax - th) * k));
    curve[i] = Math.max(-1, Math.min(1, y * mk));
  }
  return curve;
}

// 硬二极管削波：两个反并联硅二极管到地。内建增益驱动 → 越过阈值后快速饱和 → 密集谐波。
export function makeDistortionCurve(amount: number, _sr: number) {
  const n = WS_CURVE_LENGTH;
  const curve = new Float32Array(n);
  const a = Math.max(0, Math.min(1, amount));
  const g = 4 + a * 8;
  const th = 0.35 - a * 0.1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const boosted = x * g;
    const ax = Math.abs(boosted);
    curve[i] = ax <= th ? boosted : Math.sign(boosted) * (th + (1 - th) * Math.tanh((ax - th) * 5));
  }
  return curve;
}

// 硬削波 + 软膝：硅二极管硬削波 + 串联电阻软化膝部。
// 曲线不含增益 — 增益由链路中的独立 GainNode 控制。
// amount 控制膝部软度: 0=软(轻微过载), 1=硬(重金属硬削波)。
export function makeMetalCurve(amount: number, _sr: number) {
  const n = WS_CURVE_LENGTH;
  const curve = new Float32Array(n);
  const a = Math.max(0, Math.min(1, amount));
  const th = 0.65;
  const knee = 0.12 * (1 - a * 0.7);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    if (ax <= th - knee) {
      curve[i] = x;
    } else if (ax <= th + knee) {
      const t = (ax - (th - knee)) / (2 * knee);
      curve[i] = Math.sign(x) * ((th - knee) + knee * t * t * (3 - 2 * t));
    } else {
      const sign = x >= 0 ? 1 : -1;
      const over = (ax - th - knee) / (1 - th - knee);
      curve[i] = sign * ((th + knee) + (1 - th - knee) * (1 - Math.exp(-over * 8)));
    }
  }
  return curve;
}

// 运放硬削波：tanh 前级 + 硬阈值二次削波。
export function makeRatCurve(amount: number, _sr: number) {
  const n = WS_CURVE_LENGTH;
  const curve = new Float32Array(n);
  const a = Math.max(0, Math.min(1, amount));
  const th = 0.34 - a * 0.16;
  const k = 14 + a * 8;
  const g = 1 + a * 3.5;
  const OUT = 0.55; // 默认电平校准因子
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const b = Math.tanh(x * g);
    const ax = Math.abs(b);
    curve[i] = (ax <= th ? b : Math.sign(b) * (th + (1 - th) * Math.tanh((ax - th) * k))) * OUT;
  }
  return curve;
}

// 三重削波：不对称软削波 + 对称硬削波 + 交叉失真。
// 交叉失真是"电锯"音色的灵魂——零交叉点附近的死区产生刺耳的锯齿状谐波。
export function makeChainsawCurve(amount: number, _sr: number) {
  const n = WS_CURVE_LENGTH;
  const curve = new Float32Array(n);
  const a = Math.max(0, Math.min(1, amount));
  // 主削波：硬阈值 tanh
  const th = 0.3 - a * 0.15;
  const k = 12;
  const s = 2.5 + a * 8;
  const satLow = th * Math.tanh(s);
  // 轻微交叉压缩：零交叉点附近压缩，保留连续性不钳零
  const crossoverKnee = 0.06;
  const OUT = 0.45; // 默认电平校准因子
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    let y;
    // 阶段1：主削波
    if (ax <= th) y = Math.sign(x) * (th * Math.tanh((ax / th) * s));
    else y = Math.sign(x) * (satLow + (1 - satLow) * Math.tanh((ax - th) * k));
    // 阶段2：零交叉点附近软压缩，不钳零
    const ay = Math.abs(y);
    if (ay < crossoverKnee) {
      const t = ay / crossoverKnee;
      y = Math.sign(y) * crossoverKnee * t * t;
    }
    curve[i] = y * OUT;
  }
  return curve;
}

// 恒等曲线（直通）
export function makeIdentityCurve(_sr: number) {
  const n = WS_CURVE_LENGTH;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    curve[i] = (i / (n - 1)) * 2 - 1;
  }
  return curve;
}

/** 选型 presetId → 曲线构建器（chain.ts 加载单块时使用） */
export const CURVE_BUILDERS: Record<string, (amount: number, sr: number) => Float32Array> = {
  overdrive: makeOverdriveCurve,
  bd2: makeBluesDriverCurve,
  klon: makeKlonCurve,
  distortion: makeDistortionCurve,
  metal: makeMetalCurve,
  rat: makeRatCurve,
  chainsaw: makeChainsawCurve,
};
