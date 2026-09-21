# FXTrace Clone — 项目启动档案

> 从 Guitar_XE1.0.0（Guitar-X）中提取"音色克隆"功能独立开源的项目。
> 本文档由 2026-09-21 会话整理，作为新会话/新贡献者的上下文基础。

## 一、项目定位

**硬件音色测量仪 + 参数化克隆引擎**（不是完整效果器宿主）。

一句话标语：**Capture your pedal's tone. Rebuild it in software.**

用真实的扫频测量 + 谐波分析，把外接单块/箱头的音色特征提取为可分发的软件效果链 JSON。

- 仓库名建议：`fxtrace-clone`，显示名 FXTrace Clone
- License：MIT
- 技术栈：TypeScript + Web Audio API，Vite，零运行时依赖

## 二、原功能技术现状评估（会话结论）

原实现在 `Guitar_XE1.0.0/js/ui/clone-pedal.ts`（约 2300 行），**是真实实现，非空壳**：

### 已实现且质量不错的部分
1. **扫频测量管线**：生成 20Hz→20kHz 指数扫频（2s），经 声卡输出→被测单块→声卡输入 录回，
   取各频点峰值；做了**基线校准**（不接单块先扫一遍，测出的响应减去声卡自身频响）——正经测量仪器做法。
2. **THD 分析**：440Hz 正弦激励，测总谐波失真，分软削波（thd>0.01）/硬削波（thd>0.1）。
3. **动态分析**：变幅噪声测压缩感。
4. **EQ 拟合**：高斯加权把频响拟合到 7 个频段（100~6400Hz），用预测误差算匹配度百分比。
5. **选型引擎**：8 箱头 / 6 箱体 / 多个单块的规则打分匹配（AMP_CANDIDATES / CAB_CANDIDATES）。
6. **音频文件克隆路径**：导入录音文件，自写 FFT 算频谱，
   用 高频能量占比/频谱斜率/Crest factor 三指标加权估计失真度。

### 克隆产物（四层）
| 产物 | 形态 |
|---|---|
| 效果器链 | 真实加载：单块 → ampSim(型号+通道+四段EQ) → 箱体IR，参数全由分析算出，立即可弹 |
| 已保存音色 | localStorage JSON（选型+全部参数+匹配度），列表点选整链恢复 |
| 导出文件 | `tone_名字.json`，可导入分发（与导入 clamp 对称 [-15,15]） |
| 分析报告 | 匹配度%、7 段 EQ 拟合表、频响曲线 vs EQ 点图、选中型号清单 |

### 真实水平判断
- **"特征匹配式克隆"，非建模式克隆**。产物是"风格归类"（如 英式80s箱头+中凹箱体+EQ微调）。
- 能捕获：静态频响轮廓、失真量级、大致压缩感。清音/箱体类约 70-80% 相似；失真类约 50%（同大类）。
- 捕获不了：谐波结构差异（THD 只是一个标量）、动态触感、时域行为、drive 真实反解（硬削波路径 driveDb=0 直接放弃）。
- 选型靠硬编码查表规则，无闭环校验。

### 已识别的升级方向（研发价值，写进 roadmap）
1. **谐波阶次分解**（性价比最高）：按 2f/3f/4f… 幅度谱分解，区分偶次（TS/Fender 风）与奇次（RAT/Mesa 风）削波。
2. **多电平扫频**：3-5 档电平重复扫频 → 反解 drive/压缩参数，替代查表。
3. **Wiener-Hammerstein 模型**：拟合非线性传递函数，对标 ToneX/NAM 简化版，"真克隆"路线。
4. 匹配度分母（36dB 硬编码）改为相对误差。

### 已识别的现存缺陷（提取时顺手修）
- 保存音色时**丢掉了原始频响数据**（只留 7 个拟合值），旧音色无法用新算法重算 → 新格式需包含 freqs/response。
- 动态分析 dB 范围线性映射压缩比 1..10，非常粗糙。

## 三、依赖边界（提取范围）

需要搬的最小闭包：
- `js/ui/clone-pedal.ts` — 主体（分析+匹配+UI）
- `js/core/fx-client.ts` — 效果器链管理（提取后简化为迷你链）
- `js/effects/fx-registry.ts` — 效果器定义（只取 overdrive/distortion/ampSim/cabIR 子集）
- `js/dsp/curves.ts` — 削波曲线（waveshaper，纯程序生成）
- `js/dsp/cab-ir.ts` — 程序生成箱体 IR（纯线性响应，无外部资源，直接可用）
- `js/core/storage.ts` — 存储抽象（开源版改为文件导入/导出为主）

**不要搬**：Electron 主进程、telemetry、EULA、looper、其他几十个效果器、worklet 全家桶。

## 四、仓库结构规划

```
fxtrace-clone/
├── LICENSE                  # MIT
├── README.md                # 中英双语 + 原理图（吉他→单块→声卡→扫频→拟合→链路）+ GIF 演示
├── docs/
│   ├── algorithm.md         # 算法文档（扫频/基线校准/THD/EQ拟合）— 开源核心价值
│   └── roadmap.md           # 谐波分解、多电平辨识、W-H 模型
├── src/
│   ├── engine/              # 纯逻辑，无 DOM，可单测
│   │   ├── measurement.ts   #   扫频生成、峰值采集、基线校准
│   │   ├── analysis.ts      #   THD、谐波分解（新）、频响剖面
│   │   ├── fitting.ts       #   EQ 拟合、匹配度
│   │   └── matching.ts      #   单块/箱头/箱体选型
│   ├── audio/               # WebAudio 胶水层
│   │   ├── io.ts            #   getUserMedia、播放/录制路由
│   │   ├── chain.ts         #   迷你效果器链（Waveshaper + BiquadEQ + Convolver）
│   │   └── curves.ts        #   削波曲线子集
│   ├── presets/
│   │   ├── amps.ts          #   8 箱头定义
│   │   ├── cabinets.ts      #   6 箱体 + makeCabIR
│   │   └── drives.ts        #   单块定义
│   ├── ui/
│   │   ├── wizard.ts        #   向导式克隆弹窗
│   │   └── charts.ts        #   频响曲线绘制（从 showResult 抽出）
│   ├── io/
│   │   ├── file-clone.ts    #   音频文件克隆路径
│   │   └── tone-file.ts     #   导入/导出 JSON（含原始频响 ← 新改进）
│   └── index.ts             # 公共 API：captureTone(ctx, io) -> ToneProfile; applyTone(chain, profile)
├── demo/                    # 纯静态 HTML demo（去 Electron）
├── tests/                   # 合成数据单测（给已知 EQ 造扫频，验证拟合恢复）
└── package.json
```

关键架构决定：**engine 层与 audio 层分离**（原代码 2300 行里算法与 WebAudio 混杂）。

## 五、阶段计划

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 提取**（1-2 天） | 按上述结构搬代码；去 Electron/telemetry/EULA 等宿主依赖；存储改为导入/导出文件 | demo 页完成一次完整设备克隆 |
| **P1 重构**（2-3 天) | engine/audio 分层；canvas 绘图抽 charts.ts；保存文件加原始频响 | `npm test` 全绿；产物 JSON 含 freqs/response |
| **P2 算法增强**（3-5 天） | ① 谐波阶次分解接入 selectDriveEffect；② 3 档多电平扫频反解 drive；③ 匹配度改相对误差 | 同一硬件连续两次克隆结果一致；软/硬削波分类准确率提升 |
| **P3 开源包装**（1-2 天） | README/algorithm.md/roadmap.md/LICENSE/CI（Actions 跑 test）/v0.1.0 tag | 发布 |

## 六、开源注意事项

1. **版权**：原 `fx-client.ts` 头部有作者原创声明（自研非第三方代码），提取时保留。
2. **商标**：箱头/单块用中性风格名（原代码已是"英式 80s"这类描述），避免 Marshall/Mesa/TS 等商标。
3. **demo 优先于文档**：打开浏览器就能测的在线 demo 最吸引 star。
4. **兼容**：导入函数兼容旧项目克隆音色 JSON 格式，留迁移路径。
5. 用户已完成命名决策：**FXTrace Clone**，目录 `D:\FXTraceClone`。

## 七、新会话起步指令建议

> "读 D:\FXTraceClone\docs\PROJECT-BRIEF.md，我们从 P0 提取开始：源项目在 D:\Guitar_XE1.0.0，按 brief 里的仓库结构把音色克隆功能提取成独立项目。"
