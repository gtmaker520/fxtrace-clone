# Changelog

所有显著变更记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- **前级增益自适应**：信号检测记录实测输入 RMS，单块前级增益按目标 2.5× 过驱动计算（`computeDriveGain`），弱麦克风信号与线路输入都能正确进入削波区，替代固定系数标定。
- **失真特征匹配度**：与频响匹配度并列展示（wizard + 路径 B），按失真类型一致性 40% / THD 量级 35% / 动态压缩 25% 加权（`computeDistortionMatchPct`）。频响匹配度高不再掩盖失真特性差异。
- **链路层单测**（`tests/chain.test.ts`，mock AudioContext）：applyTone 参数映射（dist→drive）、链序（drive→amp→cab）、loadWH 节点图与 IIR 系数、clear 直通、增益自适应边界——覆盖 MT-2W 实测暴露问题的回归防线。
- **微调面板组件化**（`src/ui/tweak-panel.ts`）：从 demo 下沉到 ui 层，参数归一化单点化（面板只持链路控制键，预设键换算收敛在 sync 边界）。

### Changed
- 微调面板 HTML 由 demo/index.html 静态标记改为组件注入（宿主 `#tweakHost`）。

### Removed
- 删除 `applyWHModel` TODO 空壳（公共 API 中的死代码；实际路径为 `chain.loadWH`）。

## [0.1.0] - 2026-09-21

### Added（P0-P3 初版）
- 扫频测量管线：20Hz→20kHz 指数扫频、峰值采集、基线校准。
- THD 分析 + 谐波阶次分解（偶/奇次削波拓扑识别）、多电平扫频反解 drive。
- EQ 拟合（7 频段高斯核）+ 相对误差匹配度（2%-98% 分位动态范围归一化）。
- 选型引擎：单块/箱头/箱体规则匹配；压缩比物理映射。
- 音频文件克隆路径（自写 FFT，混音 THD 缩放）。
- Wiener-Hammerstein 真克隆（P3）：3 档电平扫频采集、奇对称 Hermite 插值非线性拟合、
  peaking Biquad 线性估计、`chain.loadWH`（IIR→WaveShaper→IIR）。
- 迷你效果器链 + 6 款程序生成箱体 IR + 7 种削波曲线。
- 实时监听（麦克风→链路→扬声器）、输入设备选择、音色微调面板。
- 音色文件 v2 格式（含原始频响，兼容 v1 导入）。
- demo（静态页）、CI（tsc + vitest + build）、双语 README、算法文档、路线图。

### Fixed
- 输入信号检测：suspended 上下文、固定 200ms 采样时序、设备选择三缺陷。
- 应用音色后单块失真不生效（dist 0-100 → drive 0-1 参数键映射丢失）。
- 前级增益标定不足导致削波不可闻；metal 曲线阈值随 dist 下调。
- 播放选区 AudioContext 未 resume；demo 脚本路径。

[Unreleased]: https://github.com/gtmaker520/fxtrace-clone/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gtmaker520/fxtrace-clone/releases/tag/v0.1.0
