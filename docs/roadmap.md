# Roadmap

> 当前版本：v0.1.0（P0 提取完成）。
> 排序原则：性价比优先——每项都标注它解决哪个"已知局限"（见 [algorithm.md](algorithm.md) 各节末尾）。

## P1 重构（已完成）

- [x] engine/audio 进一步解耦：measurement 的 WebAudio 依赖下沉到 audio/io（engine 现为纯逻辑，node 环境可单测）
- [x] UI 导入路径打通：导入音色文件 → applyTone 一键恢复（demo 路径 A）
- [x] CI：workflow 已就绪（`.github/workflows/ci.yml`：tsc + vitest + build）；AtomGit Actions 需在仓库设置中启用

## P2 算法增强（已完成）

### ① 谐波阶次分解 ✅ —— 解决"THD 只是一个标量"

已实现 `decomposeHarmonics`：按 2f/3f/4f… 分解谐波幅度谱，evenRatio 区分
偶次（非对称削波，TS/Fender 风）与奇次（对称削波，RAT/Mesa 风）拓扑，
接入 `selectDriveEffect` 按电路对称性选型。详见 [algorithm.md §2.1](algorithm.md)。

### ② 多电平扫频 —— 解决"drive 真实反解" ✅

已实现 3 档多电平 THD（`captureThdMultiLevel`）+ `solveDriveFromLevels`
增长曲线反解：growth=thdHigh/thdLow → drive=log2(growth)/4，替代查表。
wizard full 模式已接入。详见 [algorithm.md §2.2](algorithm.md)。

### ③ 匹配度分母改相对误差 ✅

已实现：36dB 硬编码 → 响应 2%-98% 分位峰-峰动态范围归一化（下限 6dB），
匹配度在不同设备间可比。详见 [algorithm.md §4.2](algorithm.md)。

### ④ 动态分析改进 ✅

已实现：dB 范围→压缩比从经验线性映射（1+range/6）改为物理映射
（输入调制范围 19.1dB / 输出实测范围），单测覆盖直通≈1 与 4:1 压缩≈4
两个标定点。详见 [algorithm.md §3](algorithm.md)。

## P3 "真克隆"路线（基础版已完成）

### Wiener-Hammerstein 模型 ✅（基础版）

已实现 Linear → Static Nonlinearity → Linear 三段模型（对标 ToneX/NAM 简化版）：

- **采集**：3 档电平扫频（共用基线校准）+ 各档 THD（`audio/wh-capture.ts`）
- **非线性**：y(u)=gain(u)·u 数据点 → 奇对称三次 Hermite 插值 → 4097 点 WaveShaper 曲线（`engine/wh-nonlinear.ts`）
- **线性**：低电平档拟合 pre-filter、高低电平差拟合 post-filter（单 peaking Biquad，RBJ cookbook，`engine/wh-linear.ts`）
- **应用**：`chain.loadWH` — IIRFilter(pre) → WaveShaper → IIRFilter(post)，立即可弹；wizard 增加"W-H 真克隆"按钮（基线校准后可用）

详见 [algorithm.md §8](algorithm.md)。失真类相似度从 ~50%（特征匹配）有望进入 80%+（待真实硬件验收）。

**后续深化方向**（当前基础版的已知边界）：
- [ ] 有记忆非线性：Volterra 级 / 神经网络（捕获扬声器暂态、变压器磁滞、动态偏置）
- [ ] 多峰频响的更精细线性拟合（多个 Biquad 级联或 FIR）
- [ ] 拟合闭环校验：应用 WH 模型后反向测量，与目标响应比对自动微调

## 其他

- [ ] demo GIF 录制放 README（开源吸引力第一要素）
- [ ] 音色文件在线分享格式规范（URL 参数 / 二维码）
- [ ] 选型引擎闭环校验：应用克隆链后反向测量，与目标频响比对自动微调
