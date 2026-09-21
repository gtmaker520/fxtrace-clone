<div align="center">

# FXTrace Clone

**Capture your pedal's tone. Rebuild it in software.**

硬件音色测量仪 + 参数化克隆引擎
Hardware tone measurement + parameterized clone engine for guitar effects.

[中文](#中文) | [English](#english)

</div>

---

## 中文

FXTrace Clone 用真实的**扫频测量 + 谐波分析**，把外接单块/箱头的音色特征提取为可分发的软件效果链 JSON——不是音色建模（Neural Capture），而是**特征匹配式克隆**：测量 → 拟合 → 选型 → 立即可弹。

### 工作原理

```
 吉他 ──→ 被测单块/箱头 ──→ 声卡输入
                ↑                    │
                │（基线校准：不接设备扫一遍，扣除声卡自身频响）
                │                    ↓
        声卡输出 ←── 20Hz→20kHz 指数扫频 (2s)
                                     │
              ┌──────────────────────┤
              ↓                      ↓
        频响剖面拟合            440Hz THD 谐波分析
        （7 段高斯加权 EQ）     （软削波 / 硬削波分类）
              ↓                      ↓
        bass/mid/treble/        失真单块选型
        presence 四维特征       （过载→电锯 7 档）
              ↓                      ↓
              └─────→ 规则打分选型 ←────┘
                 箱头（8 型号）/ 箱体 IR（6 型号）
                          ↓
        单块 → 箱头 EQ → 箱体 IR —— 可立即弹奏的软件效果链
                          ↓
              导出 tone_名字.json（可分发/导入）
```

另有**音频文件克隆**路径：导入一段录音，FFT 频谱 + 三指标（高频占比/频谱斜率/Crest factor）加权估计失真度。

### 快速开始

```bash
npm install
npm run dev     # 打开 http://localhost:5180
```

- **路径 A · 设备克隆**：吉他 → 声卡，先直通校准基线，再接上被测单块，走完向导。
- **路径 B · 音频克隆**：拖入一段录音，在波形上选一段干净的吉他独奏，分析导出。

作为库使用：

```ts
import { getAudioContext, MiniFxChain, applyTone, openCloneWizard, setOnApply } from 'fxtrace-clone';

setOnApply((result) => {
  const chain = new MiniFxChain(getAudioContext()!);
  applyTone(chain, result);   // 单块 → 箱头 EQ → 箱体 IR，立即可弹
});
openCloneWizard();
```

### 能克隆到什么程度

| | |
|---|---|
| ✅ 能捕获 | 静态频响轮廓、失真量级（THD）、大致压缩感 |
| 📊 相似度 | 清音/箱体类约 70-80%；失真类约 50%（同大类） |
| ❌ 捕获不了 | 谐波结构差异、动态触感、时域行为、drive 真实反解 |

升级方向见 [docs/roadmap.md](docs/roadmap.md)（谐波阶次分解、多电平扫频反解、Wiener-Hammerstein 模型）。

### 开发

```bash
npm test        # 合成数据单测（vitest）
npm run build   # 类型检查 + 构建
```

架构：`src/engine`（纯逻辑，可单测）与 `src/audio`（WebAudio 胶水）严格分离。算法细节见 [docs/algorithm.md](docs/algorithm.md)。

### License

[Apache-2.0](LICENSE)。箱头/单块均使用中性风格名（"英式 80s" 等），与任何商标无关。

---

## English

FXTrace Clone uses real **sweep measurement + harmonic analysis** to capture the tone of an external pedal or amp head into a distributable software effects-chain JSON. Not neural capture — **feature-matched cloning**: measure → fit → match → play instantly.

### How it works

```
 Guitar ──→ DUT pedal ──→ audio-in
                ↑                │
                │ (baseline calibration: sweep with no DUT, subtract soundcard response)
                │                ↓
      audio-out ←── 20Hz→20kHz exponential sweep (2s)
                                 │
            ┌────────────────────┤
            ↓                    ↓
      Frequency response     440Hz THD analysis
      fit (7-band gaussian   (soft/hard clipping
      weighted EQ)            classification)
            ↓                    ↓
      bass/mid/treble/       drive pedal matching
      presence features      (7 tiers)
            ↓                    ↓
            └─────→ rule-based matching ←────┘
              amp head (8 models) / cab IR (6 models)
                          ↓
        drive → amp EQ → cab IR — instantly playable chain
                          ↓
              export tone_<name>.json
```

An **audio-file cloning** path is also included: import a recording, FFT spectrum + a 3-metric weighted distortion estimate (HF ratio / spectral tilt / crest factor).

### Quick start

```bash
npm install
npm run dev     # open http://localhost:5180
```

- **Path A · Device clone**: guitar → soundcard; calibrate baseline (no DUT), then connect the pedal and follow the wizard.
- **Path B · Audio clone**: drop in a recording, select a clean guitar passage on the waveform, analyze and export.

As a library:

```ts
import { getAudioContext, MiniFxChain, applyTone, openCloneWizard, setOnApply } from 'fxtrace-clone';

setOnApply((result) => {
  const chain = new MiniFxChain(getAudioContext()!);
  applyTone(chain, result);   // drive → amp EQ → cab IR, instantly playable
});
openCloneWizard();
```

### What to expect

| | |
|---|---|
| ✅ Captured | static frequency response, distortion amount (THD), rough compression |
| 📊 Similarity | clean/cab tones ~70-80%; distorted tones ~50% (same family) |
| ❌ Not captured | harmonic structure, dynamics/touch, time-domain behavior, true drive reversal |

See [docs/roadmap.md](docs/roadmap.md) for the upgrade path (harmonic-order decomposition, multi-level sweeps, Wiener-Hammerstein modeling).

### Development

```bash
npm test        # synthetic-data unit tests (vitest)
npm run build   # type-check + build
```

Architecture: `src/engine` (pure logic, unit-testable) is strictly separated from `src/audio` (WebAudio glue). Algorithm details in [docs/algorithm.md](docs/algorithm.md).

### License

[Apache-2.0](LICENSE). Amp/pedal names are neutral style descriptors ("British 80s" etc.), unrelated to any trademark.
