# FXTrace Clone 算法文档

> Clone 的核心价值：整套"测量 → 拟合 → 选型"管线是确定性的、可解释的、可单测的。
> 本文按数据流顺序说明每一步的原理、参数与已知局限。

## 1. 扫频测量（engine/measurement.ts + audio/io.ts）

### 1.1 信号生成

- 20Hz → 20kHz **指数扫频**（正弦），时长 2s，幅度 0.3，由 `OfflineAudioContext` 离线渲染。
- 指数扫频保证在对数频率轴上每倍频程耗时相同——后续所有拟合都在 log-f 空间进行。

### 1.2 峰值采集

- 播放扫频到声卡输出的同时，以 `AnalyserNode`（fftSize=4096，smoothing=0）按 8ms 间隔采样输入。
- 每个频点取**多次采样的最大值（峰值保持）**——扫频是慢速经过每个 bin 的，峰值包络即该频率的增益。
- 只保留 20Hz–20kHz 且峰值 > −100dB 的频点。

### 1.3 基线校准（正经测量仪器的做法）

声卡自身有频响（输入高通、输出滚降、驱动增益），直接测量会把它算进被测设备头上：

1. **不接被测设备**（直通）扫一遍 → 记录基线 `baseline(freq)`；
2. **接上被测设备**再扫一遍 → `measured(freq)`；
3. 设备真实频响 = `measured − baseline`（dB 域相减），频率对齐容差 15%，结果 clamp 到 ±40dB。

## 2. THD 谐波失真分析（engine/analysis.ts）

- 激励：440Hz 正弦，1s，幅度 0.15。
- 采集输入峰值谱后：

```
THD = sqrt(Σ_{h=2..10} A(h·440)²) / A(440)
```

- 分类（标量阈值）：
  - THD > 0.1 → **硬削波**
  - THD > 0.01 → **软削波**
  - 否则 → 无失真

### 2.1 谐波阶次分解

THD 是标量，无法区分削波拓扑——`decomposeHarmonics` 按 2f/3f/4f… 分解峰值谱：

```
evenRatio = Σ偶次能量 / Σ全部谐波能量（2-10 次）
topology  = evenRatio > 0.6 → even（非对称削波，2f 强 → TS/Fender 风）
            evenRatio < 0.4 → odd（对称削波，3f 强 → RAT/Mesa 风）
            中间带 → even（单块更常见的拓扑）
```

`selectDriveEffect` 接受可选 `topology` 参数：已知拓扑时按电路对称性选型
（even 软削波→过载/蓝色过载，odd 软削波→透明过载；odd 硬削波→运放失真/电锯，
even 硬削波→失真/重金属），未知时保持原 THD 查表。谐波 bin 提取取容差内
**幅度最大**的 bin，对邻 bin 噪声底健壮。

### 2.2 多电平扫频反解 drive

单档 THD 无法反解前级增益（"drive 真实反解"曾是硬编码 driveDb=0 的放弃路径）。
`captureThdMultiLevel`（audio/io.ts）用 3 档递增电平（0.08/0.16/0.32，约 ±12dB）
各测一次 THD，`solveDriveFromLevels`（纯逻辑）用增长曲线反解：

```
growth = thd(最高档) / max(thd(最低档), 1e-4)
drive  = clamp(log2(growth) / 4, 0, 1)
```

物理依据：线性系统的 THD 与激励电平无关（growth≈1 → 无法反解，ok=false）；
高 drive 设备电平翻倍时更快进入削波区，THD 大幅上升——growth=4 → drive≈0.5，
growth=16 → drive=1。growth<1.5 视为电平无关，不反解。
wizard 在 full 模式下启用：反解成功时把 drive 写入选型参数
（drive/gain/dist 键），并用最高档 THD 作为失真量（更接近实际演奏电平）。

## 3. 动态分析（engine/analysis.ts `computeDynamicRatio`）

- 激励：变幅噪声（幅度按 0.5Hz 正弦起伏），2s。
- 分 40 帧采集 RMS，取最高 10 帧与最低 10 帧的均值比得到**输出**动态范围。
- 压缩比采用物理映射：输入激励的调制范围是已知的（幅度 0.3×(1±0.8)，约 19dB），压缩比 = 输入范围 / 输出范围：

```
INPUT_RANGE_DB = 20·log10(1.8/0.2) ≈ 19.1dB
outRange(dB)   = 20·log10(avgTop / avgBot)
压缩比         = clamp(INPUT_RANGE_DB / outRange, 1, 20)
```

直通设备输出范围≈输入范围 → 压缩比≈1；输出被压到 1/4 → 压缩比≈4。
替代了原 "1 + range/6" 经验线性映射（单测覆盖直通与 4:1 两个标定点）。

## 4. EQ 拟合（engine/fitting.ts）

### 4.1 7 频段高斯加权拟合

- 目标频点：`[100, 200, 400, 800, 1600, 3200, 6400] Hz`。
- 拟合前先**减去全频段均值**（归一化）——EQ 只负责频率整形，整体电平交给 level。
- 每个频段的值 = 对数频率轴上以该频点为中心、σ=0.25 的高斯加权平均：

```
bands[b] = Σ w_i · normResp_i / Σ w_i,   w_i = exp(−½·((ln f_i − ln f_b)/σ)²)
```

- 结果 clamp 到 ±15dB（与导入 clamp 对称）。

**已知局限**：σ=0.25 的高斯核相邻频段互相重叠，拟合本质是**平滑算子**——相邻频段大反差的锐利频响会有约 2dB 的固有平滑误差（单测已量化）。

### 4.2 匹配度

用拟合出的 bands 重建每个频点的预测值，与实际响应比较。分母采用**相对误差**——用响应自身的动态范围（2%-98% 分位峰-峰）归一化，替代原硬编码 36dB：

```
avgErr = mean(|normResp_i − predict(f_i)|)
denom   = max(6, p98(normResp) − p2(normResp))   // dB
matchPct = clamp(100 − avgErr/denom × 100, 0, 100)
```

频响越平缓（动态范围小），同样的绝对误差扣分越多——匹配度在不同设备间可比。
下限 6dB 防止近似平坦的响应把微小误差放大成 0 分。

## 5. 选型引擎（engine/matching.ts）

规则打分查表，无学习、无闭环校验——但每条规则的物理含义是明确的：

### 5.1 失真单块（THD 驱动）

| 条件 | 选型 |
|---|---|
| 软削波 THD<0.04 / <0.08 | 过载（drive 0.15 / 0.3） |
| 软削波 THD<0.12 | 蓝色过载 |
| 软削波 THD≥0.12 且 mid>2 | 黄色过载（透明过载） |
| 硬削波 THD<0.2 / <0.35 / <0.5 / <0.7 / ≥0.7 | 失真 → 运放失真 → 重金属 → 电锯 → 电锯(0.75) |

### 5.2 箱头（频响特征 + THD 驱动）

四维特征 `fp`（由 `analyzeFreqProfile` 分段平均得到）：

| 特征 | 频段 |
|---|---|
| bass | < 200Hz |
| mid | 200Hz–3kHz |
| treble | 3k–8kHz |
| presence | > 8kHz |

8 个候选型号各有一组加分规则，例：

- **美式 60s**：清音（THD<0.05 +4）、mid<−1 +3、treble>2 +2；
- **英式 80s**：中增益（0.05<THD<0.4 +3）、mid>1 +3；
- **美式高增益**：THD>0.35 +4、mid<−2 +3。

通道选择：THD>0.05 → 失真通道。箱头参数（gain/bass/mid/treble/presence）直接由 `fp` 线性映射。

### 5.3 箱体 IR

6 个候选按 presence/treble/bass 特征打分（如 presence>3 且 <5 → 英式 4x12 +3）。中性的程序生成 IR 见 `presets/cabinets.ts`（最小相位合成，倒谱法 + 基2 FFT）。

## 6. 音频文件克隆（io/file-clone.ts）

无声卡 I/O 时，从录音直接估计：

1. **频谱**：Hann 窗 + 50% 重叠分段 FFT（4096），平均幅度谱在对数频率轴上高斯平滑到 128 点 → 复用第 4 节拟合。
2. **失真度估计**（三指标加权）：

```
hfRatio = E(2k–8k) / E_total        // 高频能量占比：干净~0.1，失真~0.35+
tilt     = ln(E(2k–8k) / E(100–500)) // 频谱斜率：干净~−4，高增益~0
crest    = peak / rms                // 波峰因数：干净~6-8，压缩~2-3
thd ≈ 0.5·S(hfRatio) + 0.3·S(tilt) + 0.2·S(crest)
```

3. **混音修正**：混音中镲片/Hi-hat 会大幅抬高 hfRatio，默认乘 0.45 缩放（纯吉他录音可传 `distortionScale: 1.0`）。

**已知局限**：这是"失真度估计"而非真实 THD；混音素材本质上是病态问题（无法分离乐器）。

## 7. 克隆产物与文件格式

产物四层：效果器链（立即可弹）/ 导出 JSON / 分析报告（匹配度 + 7 段拟合表 + 曲线图）/ 选型清单。

音色文件（v2）：

```jsonc
{
  "name": "...", "mode": "full", "eqBands": [7 个 dB 值],
  "matchPct": 82, "distortionType": "soft", "thd": 0.07,
  "freqProfile": { "bass": 1.2, "mid": 3.1, "treble": 0.4, "presence": -0.8 },
  "matchedDrive": { "presetId": "overdrive", "params": { ... } },
  "matchedAmp":   { "modelIdx": 0, "channel": 1, "params": { ... } },
  "matchedCab":   { "variant": 2, "params": { ... } },
  "rawResponse":  { "freqs": [...], "response": [...] },  // v2 新增：原始频响
  "_version": 2
}
```

`rawResponse` 的意义：旧格式只留 7 个拟合值，算法升级后旧音色**无法重算**；v2 起保存原始频响，任何新算法都可以离线重算全部产物。导入函数兼容无 `rawResponse` 的旧 v1 文件。

## 8. Wiener-Hammerstein 真克隆（engine/wh-model.ts + wh-nonlinear.ts + wh-linear.ts）

W-H 模型把设备拆为三段：**线性 → 静态非线性 → 线性**，对标 ToneX/NAM 的简化版。产物不再是"风格归类"，而是可直接弹奏的波形级模型。

### 8.1 数据采集（audio/wh-capture.ts）

`captureWHSweeps`：3 档输入电平（约 -10/0/+6dB）各做一次扫频（共用同一条基线校准），同时测各档 440Hz THD。低电平档 ≈ 设备线性区响应，高电平档 ≈ 非线性工作区响应。

### 8.2 静态非线性拟合（engine/wh-nonlinear.ts）

核心物理关系：**输出幅度 = 增益(u) × 输入幅度**（y(u)=gain(u)·u，零输入零输出）。

1. 取 1kHz 频点，从各档频响读出增益（dB）→ 线性幅度；
2. 输入电平归一化到 [0,1]，构造数据点 `(u, gain(u)·u)`；
3. 分段三次 Hermite 插值（奇对称：f(-x) = -f(x)）生成 4097 点 WaveShaper 曲线；
4. 归一化到 [-1,1]，RMSE 按同一尺度报告。

### 8.3 线性部分估计（engine/wh-linear.ts）

- **pre-filter**：最低电平档频响（线性区），用贪心三点法拟合单个 peaking Biquad（RBJ cookbook）——峰/谷频率与增益直接读出，Q 由半峰宽估计；
- **post-filter**：高电平频响 − 低电平频响（dB 域差），同法拟合——捕获非线性工作区引起的音调偏移；
- 每级报告 RMSE（dB）。

### 8.4 链路应用（audio/chain.ts `loadWH`）

```
input → inputGain → IIRFilter(pre) → WaveShaper(拟合曲线) → IIRFilter(post) → outputGain
```

Web Audio 的 `BiquadFilterNode` 不接受自定义系数，用 `IIRFilterNode` 承载。WH 节点占据 drive+amp 的位置（cab 可保留），应用后立即可弹。wizard 的"W-H 真克隆"按钮在基线校准后可用。

**已知局限**：静态非线性是**无记忆**模型——捕获不了扬声器的时域暂态、变压器磁滞、管级动态偏置；单 peaking Biquad 对复杂频响（多峰）拟合精度有限。这些是 W-H 模型类方法的共同边界，继续提升需要 Volterra 级或神经建模。

## 9. 单元测试策略（tests/）

全部用合成数据，不需要音频硬件：

- 用已知 bands **正向生成**频响曲线，验证拟合能以平滑误差内恢复（相对误差度量下 >90%）；
- 平坦曲线匹配度 ≈100%；相对误差区分度：平缓频响与尖锐频响同等误差下分数不同；
- 基线校准：构造已知基线/测量对，验证差值精确；
- THD 分类阈值、削波拓扑分解（偶次/奇次合成谱）、选型引擎分支覆盖；
- 压缩比物理映射：直通（≈1）与 4:1 压缩（≈4）两个标定点；
- 多电平反解：线性设备 ok=false、4 倍增长→0.5、16 倍→1、数据不足→false。
