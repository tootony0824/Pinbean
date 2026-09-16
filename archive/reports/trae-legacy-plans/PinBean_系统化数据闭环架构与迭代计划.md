# PinBean 系统化数据闭环架构与迭代计划

## Summary

将 PinBean 从“单次工具链路”升级为“可迭代系统”的关键，是把每次识别的**输入**、**算法版本与参数**、**模型输出**、**人工修正结果**与**修正轨迹**沉淀为可复现数据，并配套一个可自动跑分的评测/版本化机制，从而支持多轮规则/参数迭代提升识别质量。

本方案基于你当前的决策：

- 数据汇聚：本地导出包（单文件/少文件，可手动搬运到训练/评测环境）
- 用户标识：匿名设备 ID（不做登录）
- 优化目标：规则/参数迭代（先建立数据与评测体系，再考虑 ML）

---

## Current State Analysis（基于仓库现状）

### 现有端与核心链路

- 小程序端主入口：[index.js](file:///Users/yuest/Documents/pinbean/miniapp/pages/index/index.js)
  - 上传→像素化→可编辑→去背景→导出闭环已完成
  - 已完成模块化拆分：
    - 生成：[generate.js](file:///Users/yuest/Documents/pinbean/miniapp/pages/index/modules/generate.js)
    - 编辑：[editing.js](file:///Users/yuest/Documents/pinbean/miniapp/pages/index/modules/editing.js)
    - 导出：[export.js](file:///Users/yuest/Documents/pinbean/miniapp/pages/index/modules/export.js)
    - 统计：[stats.js](file:///Users/yuest/Documents/pinbean/miniapp/pages/index/modules/stats.js)
    - 去背景：`pages/index/modules/background.js`（已存在但未在本计划中展开）
- 小程序宿主能力封装（初步 services 层）：
  - [storage.js](file:///Users/yuest/Documents/pinbean/miniapp/services/storage.js)
  - `album.js` / `canvas.js`
- 核心识别输出数据结构（实际在运行中流转）：
  - `exportGrid`: `PixelCell[][]`，其中 cell 为 `{ key: string, color: string }`
  - 空白/外部目前主要以 `key === '?'` 表示（见 [editing.js](file:///Users/yuest/Documents/pinbean/miniapp/pages/index/modules/editing.js) 与 [export.js](file:///Users/yuest/Documents/pinbean/miniapp/pages/index/modules/export.js)）
- 像素化算法入口：
  - 小程序封装版：[imageProcessor.js](file:///Users/yuest/Documents/pinbean/miniapp/utils/imageProcessor.js)
  - 共享简化版：[pixelationCore.js](file:///Users/yuest/Documents/pinbean/miniapp/utils/shared/pixelationCore.js)
  - Web 参考：[pixelation.ts](file:///Users/yuest/Documents/pinbean/perler-beads-ai/src/utils/pixelation.ts)

### 缺失能力（导致无法“系统化迭代”）

- 缺少“项目/样本”的持久化与导出：每次生成和编辑不会形成可复现的记录
- 缺少“人工修正”可机器消费的标签：没有结构化 diff / label
- 缺少评测集、指标、对比与版本登记：无法回答“这次改动是否变好、变好多少、是否回归”

---

## Proposed System Architecture（离线优先）

### 1) 核心对象模型（Project / Run / Label）

建议将一次用户工作抽象成 3 层对象：

- **Project（项目）**：以“用户的一张图片”为中心的容器，可包含多个识别运行（多次生成、多次参数）与多个修正版本
- **Run（一次识别运行）**：一次 `onGenerate()` 产生的“预测网格”，并记录当时算法版本与参数（可复现）
- **Label（标签/修正结果）**：用户在编辑模式下的最终网格（ground truth-ish），以及与 run 的差异（diff）与编辑事件（可选）

这样可以支持：

- 同一张图在不同参数、不同版本下生成多个 run，用同一个 label 对比（横向对比）
- 同一张图被多次修正（label v1/v2），形成“标注迭代”（纵向迭代）

### 2) 数据闭环的端内模块划分（miniapp）

在不引入云端的前提下，小程序端建议新增“数据与版本”域的模块边界：

- `pages/index/modules/` 新增（建议）
  - `project.js`：项目生命周期（新建/加载/保存/重命名/清理）
  - `dataset.js`：样本导出（构建数据包、生成 JSONL、保存/分享文件）
  - `labeling.js`：标注状态机（“开始标注/完成标注/废弃标注”与 UI 联动）
  - `version.js`：算法版本与参数快照（写入 run 元信息）
- `services/` 新增/扩展（建议）
  - `fs.js`：文件系统封装（写文件、读文件、空间管理）
  - `crypto.js`：hash（用于 imageSha256、grid hash，便于去重）
  - 现有 [storage.js](file:///Users/yuest/Documents/pinbean/miniapp/services/storage.js) 扩展为“带版本迁移”的 KV（见后文）

### 3) 端外组件（评测与版本化，运行在 repo / 本地）

在仓库中增加一个“离线评测工具链”，用于把导出的样本包转成评测集并跑分：

- `evaluation/`（建议新增目录）
  - `schema/`：数据格式 JSON Schema（用于校验导出包）
  - `loader/`：读取 JSONL/JSON、还原网格、可视化 diff
  - `metrics/`：指标计算（见下文）
  - `runs/`：跑分结果归档（每次参数/版本的输出，形成可追溯记录）
  - `cli.ts`：`node evaluation/cli.js --dataset ... --candidate ...`

---

## Data Formats（本地导出包：单文件优先）

### 0) 设计原则

- **可复现**：任何一条样本都能用记录的参数重新跑出同样的预测（至少在同一版本上）
- **可对比**：预测 vs 标签可以稳定计算指标与可视化 diff
- **可控体积**：适配小程序本地存储 10MB 上限；导出文件可控（建议默认只带缩略图）
- **可扩展**：后续上云/训练模型时，不用推倒重来

### 1) 数据包封装：PB Dataset JSONL（推荐）

导出为单文件 `pinbean-dataset-YYYYMMDD.jsonl`，每行一个样本对象（便于增量追加、便于大文件流式处理）。

#### 1.1 顶层字段（每行一个 sample）

```json
{
  "schema": "pinbean.dataset.sample.v1",
  "sampleId": "pb_s_01J... (uuid)",
  "deviceId": "pb_d_01J... (匿名uuid)",
  "createdAt": 1710000000000,
  "source": {
    "app": "miniapp",
    "appVersion": "0.0.0",
    "runtime": {
      "wechatBaseLib": "x.y.z",
      "platform": "iOS|Android"
    }
  },
  "input": {
    "image": {
      "sha256": "hex",
      "mime": "image/jpeg",
      "width": 1024,
      "height": 768,
      "thumbnailBase64": "......",
      "thumbnailWidth": 512,
      "thumbnailHeight": 384
    },
    "preprocess": {
      "resize": {
        "method": "lanczos2",
        "targetW": 1024,
        "targetH": 768
      }
    }
  },
  "run": {
    "algorithm": {
      "name": "miniapp.imageProcessor.pixelate",
      "version": "algo-2026-05-11-001",
      "gitCommit": "optional"
    },
    "params": {
      "colorSystem": "MARD",
      "pixelationMode": "dominant",
      "granularity": 50,
      "smoothness": 1,
      "mergeSimilarColorsThreshold": 30
    },
    "grid": {
      "N": 50,
      "M": 38,
      "encoding": "rle@v1",
      "data": "..."
    }
  },
  "label": {
    "status": "accepted",
    "grid": {
      "N": 50,
      "M": 38,
      "encoding": "rle@v1",
      "data": "..."
    },
    "diff": {
      "encoding": "patches@v1",
      "patches": [
        { "x": 12, "y": 7, "from": "A01", "to": "A03" }
      ],
      "summary": {
        "changedCells": 123,
        "changedRatio": 0.064
      }
    }
  },
  "tags": {
    "scene": ["portrait", "flat-bg"],
    "notes": "optional"
  }
}
```

#### 1.2 网格编码：`rle@v1`（建议标准化）

目标：避免 `[{key,color},...]` 这种对象数组爆炸式体积。

建议把 grid 序列化成“按行 RLE + 调色板字典”的结构：

- `palette`: `string[]`，例如 `["?", "A01", "A03", ...]`
- `rows`: `Array<Array<[paletteIndex:number, runLength:number]>>`

示例（表达结构，实际导出时可进一步压成紧凑字符串）：

```json
{
  "encoding": "rle@v1",
  "N": 4,
  "M": 2,
  "palette": ["?", "A01", "B02"],
  "rows": [
    [[1,2],[0,2]],
    [[2,4]]
  ]
}
```

注意：如果你仍需要 `color(hex)`，建议通过 `key -> hex` 在评测侧结合 `colorSystemMapping.json` 还原（避免冗余存储）。

#### 1.3 diff 编码：`patches@v1`

最稳定、最通用的 diff：以 cell 坐标为主的 patch 列表：

- `x`：列索引（0-based）
- `y`：行索引（0-based）
- `from/to`：存 `key`（而非 hex），减少漂移

同时提供 `summary` 字段便于 UI 与评测快速读取。

### 2) “编辑轨迹”事件日志（可选，但建议预留）

如果你希望从“修正行为”反推系统可改进点（例如：常见误差模式、最常被替换的颜色、背景误判区域），可以额外记录事件流：

```json
{
  "encoding": "events@v1",
  "events": [
    { "t": 171..., "type": "enter_edit_mode" },
    { "t": 171..., "type": "pen", "x": 1, "y": 2, "to": "A03" },
    { "t": 171..., "type": "replace_global_color", "from": "A01", "to": "A03" },
    { "t": 171..., "type": "remove_background", "backgroundKey": "H01", "removed": 1200 }
  ]
}
```

---

## Iteration Flow（规则/参数迭代闭环）

### 1) 端内：采集 → 修正 → 形成样本

建议把“采集”做成明确动作而不是默认全量上报（便于隐私与可控体积）：

1. 用户生成一次 run（已有）
2. 用户进入编辑并完成修正
3. 用户点击“标记为已修正/加入评测集”
4. 系统生成 label + diff + 元信息快照，写入本地样本库（KV 或文件）
5. 用户在“数据集”页导出 JSONL 文件（追加式）

### 2) 端外：评测 → 对比 → 版本登记

建议建立固定流程（可脚本化）：

1. 从小程序导出 `pinbean-dataset-*.jsonl`
2. 用评测 CLI：
   - 校验 schema
   - 过滤：只取 `label.status === accepted` 的样本
3. 在候选参数集合上跑预测（复用 Web 的 pixelation 逻辑 or 从 miniapp 抽纯 JS 逻辑）
4. 指标计算与报告输出
5. 选择胜出方案，登记为新 `algorithm.version`，并把“版本-指标-变更点”写入 `evaluation/runs/` 归档

### 3) 回流：把“新版本”落回 miniapp

以“参数注册表”的形式发版，避免散落硬编码：

- `miniapp/utils/recognitionProfiles.js`（示例命名）：存 profile 列表（默认 profile + 实验 profile）
- UI 允许切换 profile（实验开关）并在 run 里写入 profile id

---

## Evaluation & Metrics（建议指标体系）

> 目标是支撑“规则/参数”迭代，所以指标重点放在网格级对齐与颜色映射质量。

### 必备指标（建议 MVP 就做）

- **Cell Accuracy（逐格准确率）**：预测 key == 标签 key 的比例
- **Macro Color F1**：以颜色 key 为类别，衡量颜色分布是否接近（避免只看像素准确率）
- **Changed Ratio（修正量）**：label.diff.changedRatio 的分布（越低通常越好，但也要防止“过于保守”）

### 可选指标（用于定位问题）

- **Confusion Matrix（颜色混淆矩阵）**：找出最常被替换的 from→to
- **Region Metrics（外部/背景）**：若后续统一 `isExternal` 语义，可做背景 mask IoU
- **Edge Preservation Proxy**：对比边缘区域的错误率（需要额外提取边缘集合）

### 报告产物（每次跑分输出）

- `report.md`：总体指标 + 分场景指标（portrait/landscape/flat-bg 等）
- `diff-gallery/`：抽样输出可视化（预测图、标签图、diff 热力图）

---

## Versioning（识别版本化机制）

### 1) 版本号与可追溯性

建议把“识别逻辑版本”从 app 版本中独立出来：

- `algorithm.version`: `algo-YYYY-MM-DD-XXX`（或 semver，如 `algo-0.3.0`）
- 可选 `gitCommit`：用于在评测侧复现（如果导出发生在开发版/内测版）

### 2) 参数注册表（Profiles）

将影响识别质量的关键参数集中管理，并在 run 里完整记录：

- resize 策略（方法、目标尺寸、是否裁剪）
- pixelationMode（dominant/average）
- smoothness / mergeSimilarColorsThreshold（见 [imageProcessor.js](file:///Users/yuest/Documents/pinbean/miniapp/utils/imageProcessor.js) 的后处理语义）
- colorSystem（MARD/…）

---

## Milestones（从“工具”到“系统”的分阶段交付）

### Milestone 1：数据闭环 MVP（可导出可评测）

- 小程序端新增：
  - 匿名 `deviceId` 生成与持久化
  - “标记为已修正”动作：生成 label + diff
  - “导出数据集”动作：生成 JSONL 文件（单文件）
- 评测侧新增：
  - schema 校验 + loader
  - 基础指标（cell accuracy / color F1 / changed ratio）

验收标准：

- 任意一张图：能导出包含 input 缩略图 + run grid + label grid + diff 的一行 JSON
- 评测脚本能读入并输出一份报告（不要求漂亮，但要稳定）

### Milestone 2：项目化与多 run 管理（支持多轮对比）

- 小程序端引入 Project（保存/加载/列表）
- 每次 `onGenerate()` 生成一个 run 记录（不同参数/版本都可留档）
- label 可选择“绑定到某次 run”或“作为该项目最新标签”

验收标准：

- 同一张图能生成 2 次 run，并用同一 label 做对比（在评测侧出两份跑分结果）

### Milestone 3：误差分析与回归治理（不再靠感觉改参数）

- 自动输出：
  - top-K 混淆颜色对
  - 修正最多的样本列表
  - 分场景分桶指标
- 建立固定“回归集”（从导出样本中冻结一批）
- 新参数必须在回归集上不退化（定义阈值）

验收标准：

- 每次改动有“可解释”的数据结论：好在哪里、坏在哪里、影响哪些类型图片

### Milestone 4：版本发布节奏（可持续迭代）

- 建立 release note 模板：版本号、关键改动、评测对比、已知风险
- 小程序端提供 profile 实验开关（或灰度策略：本地开关）
- 导出样本带上版本号与 profile id

验收标准：

- 你能回答“当前线上版本识别质量相对上一个版本提升多少/回归多少”

---

## Storage Strategy（小程序端本地存储建议）

### 1) 两层存储：KV + 文件

- KV（`wx.setStorageSync`）：放索引与小体积元信息
- 文件（`wx.getFileSystemManager`）：放数据集导出文件、图片缩略图缓存

### 2) KV 结构（建议）

- `pb.deviceId`: string
- `pb.projectsIndex.v1`: `[{projectId, name, updatedAt, coverThumbnailRef}]`
- `pb.project.<projectId>.v1`: project JSON（不含大字段）
- `pb.samplesIndex.v1`: `[{sampleId, createdAt, projectId}]`

### 3) 迁移机制（必须有）

建议为每个 key 增加 `vN` 后缀，写一个 `migrations/`（或 `services/storageMigrations.js`）在 `app.onLaunch` 时执行迁移，避免后续格式升级造成崩溃。

---

## Assumptions & Decisions

- 默认不接入云端，不做账号体系；导出数据由你手动汇聚到训练/评测环境
- 导出数据默认只包含缩略图（thumbnail base64），避免大文件与隐私压力；如需原图，后续可增加“包含原图”开关
- 标签以“最终网格”为准；diff 为派生数据（可重算），但为调试方便可随样本一并导出
- 先围绕规则/参数迭代建立评测闭环，暂不规划模型训练管线（但 schema 已预留扩展位）

---

## Verification（落地后如何验收）

### 小程序端验收

- 生成→编辑→标记为已修正→导出：全链路成功
- 导出的 JSONL：
  - schema 校验通过
  - run.grid 与 label.grid 维度一致
  - diff 能从 run+label 重算一致（抽样校验）

### 评测侧验收

- CLI 能对导出的 JSONL 产出稳定报告
- 同一数据集重复跑分结果一致（可重复性）
- 新参数/新版本能与旧版本在同一数据集上对比输出 delta

