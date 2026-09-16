# 微信小程序 vs 网页版：差异对比与复刻计划

## Summary

目标：系统性比较 `miniapp` 与 `perler-beads-ai` 在**算法**与**功能**上的差异，并以“网页版优先”为准绳，制定小程序的复刻路线，P0 聚焦 **图片裁剪 + 去背景**，并保证后续持续从网页版迁移能力时不再“各写各的”导致行为漂移。

## Current State Analysis（基于仓库现状）

### 两端入口与核心文件

- 小程序核心页面：`miniapp/pages/index/index.js`、`index.wxml`、`index.wxss`
- 小程序核心算法：`miniapp/utils/imageProcessor.js`（历史复杂版备份：`miniapp/utils/imageProcessor.v1.bak.js`）
- 网页版核心像素化算法：`perler-beads-ai/src/utils/pixelation.ts`（代表色计算、RGB距离匹配、透明处理）
- 网页版全局颜色合并：在页面逻辑中实现（`perler-beads-ai/src/app/page.tsx`，初始映射后立刻进行合并）
  - 代码段：`Starting global color merging...` 附近（见 [page.tsx](file:///Users/yuest/Documents/pinbean/perler-beads-ai/src/app/page.tsx#L874-L1016)）
- 网页版裁剪：`perler-beads-ai/src/components/ImageCropperModal.tsx`（依赖 `react-cropper`/`cropperjs`）
- 网页版编辑/洪水填充：`perler-beads-ai/src/utils/pixelEditingUtils.ts`、`perler-beads-ai/src/utils/floodFillUtils.ts`

### 算法差异（关键）

1) **取样/代表色（Dominant/Average）**
- Web：`calculateCellRepresentativeColor` 对每个格子取代表色（dominant=众数，average=均值），透明像素 `alpha<128` 跳过（见 [pixelation.ts](file:///Users/yuest/Documents/pinbean/perler-beads-ai/src/utils/pixelation.ts#L89-L148)）
- Miniapp：目前也已采用相同“简单粗暴”策略（RGB 欧氏距离 + dominant/average + alpha<128 跳过）

2) **全局颜色合并（Web 独有）**
- Web：初始映射后，按颜色频率排序，两两比较 RGB 距离，小于 `similarityThreshold` 则把低频合并进高频（见 [page.tsx](file:///Users/yuest/Documents/pinbean/perler-beads-ai/src/app/page.tsx#L891-L990)）
- Miniapp：已添加类似逻辑，但目前阈值与执行策略需要与 Web 的 `similarityThreshold` 语义对齐（应以 Web 为真相）

3) **孤立噪点清除**
- Web：在像素化核心里没有显式“孤立噪点清除”，更多依赖「裁剪/输入质量/阈值合并」减少杂色
- Miniapp：已有 3x3 邻域孤立点处理（这属于“可选增强”，需要确认是否保留，以及默认策略是否对齐 Web）

4) **输入分辨率处理**
- Web：在浏览器中可以用原图尺寸进行 `getImageData`（机器性能更强），因此细节更稳定
- Miniapp：为性能稳定，`onGenerate` 内会把原图缩放到固定上限再取 `canvasGetImageData`（导致“中间色”与杂色风险上升），这是 Miniapp 相比 Web 的核心差异之一

### 功能差异（关键）

- Web 有裁剪弹窗（CropperJS），Miniapp 尚无同等裁剪体验
- Web 有“外部/透明(isExternal)”模型以及洪水填充擦除工具（`floodFillErase`），Miniapp 目前仅有基础编辑/删除，并未形成完整的“去背景/外部区域”能力

## Proposed Changes（复刻路线，P0 聚焦裁剪+去背景）

### P0-1：复刻网页版裁剪（Miniapp 原生实现，但复刻 Web 的数据流）

**目标**
- 上传图片后先进入裁剪流程：`原图 -> 裁剪 -> 输出裁剪图(tempFilePath) -> 再进入像素化`

**实现方式（小程序原生，不尝试转译 cropperjs）**
- 新增裁剪页（建议）：`miniapp/pages/cropper/`
  - `cropper.wxml/wxss/js/json`
  - 交互：图片预览 + 裁剪框（拖动/缩放，最小实现不做旋转翻转）
  - 确认：使用 canvas `drawImage(img, sx, sy, sw, sh, 0,0,outW,outH)` 并 `wx.canvasToTempFilePath` 导出
- 首页 `index.js`：
  - `onChooseImage` 完成后改为 `wx.navigateTo({ url: '/pages/cropper/cropper?src=...' })`
  - cropper 页完成后通过 `eventChannel` 回传 `croppedPath`，首页接收后设置为 `imagePath` 再走 `onGenerate`

**为什么这样做**
- Web 的核心优势之一来自“输入更干净”。裁剪能显著降低背景对 dominant/average 的干扰，减少杂色与颜色数量。

### P0-2：复刻网页版去背景/外部区域模型（基于网格层的洪水填充）

**目标**
- 提供“一键去背景”：从四周边界开始，对“背景颜色”做洪水填充，将其标为透明/外部，从统计、渲染、导出中剔除。

**对齐 Web 的关键语义**
- Web 使用 `isExternal` + `TRANSPARENT_KEY`（见 [pixelEditingUtils.ts](file:///Users/yuest/Documents/pinbean/perler-beads-ai/src/utils/pixelEditingUtils.ts#L3-L11)）
- Miniapp 当前 grid cell 结构为 `{color, key}`，需要扩展为 `{color, key, isExternal}` 或约定 key（例如 `'TRANSPARENT'`）并在渲染/统计时跳过

**实现方式（建议）**
- 新增工具函数文件：
  - `miniapp/utils/pixelEditingUtils.js`：移植 Web 的 `TRANSPARENT_KEY`、`transparentColorData`、`floodFillErase`
  - 或者更小：直接在 `imageProcessor.js` 提供 `removeBackgroundByFloodFill(grid, N, M, backgroundKey)` 纯函数
- 背景判定策略（默认安全）：
  - 取四条边界格子的 key 频率众数作为 `backgroundKey`（避免用户必须指定背景色）
  - 从边界所有 key===backgroundKey 的点作为起点做 flood fill（4连通），标记为透明/外部
- UI 入口（P0 最小）：
  - 生成完成后提供一个按钮：「一键去背景」，点击后对 `exportGrid` 执行 flood fill，重绘与重算统计
  - 默认不自动开启，避免误删主体（用户可撤销/重新生成）

### P1：把 Web 的全局颜色合并“语义化对齐”，并统一阈值来源

**目标**
- Miniapp 全局颜色合并应与 Web 一致：
  - 按频率排序
  - 两两比较 `RGB distance`
  - 阈值使用 Web 的 `similarityThreshold` 语义（当前 Web 是从 UI/参数传入 `threshold`，见 [page.tsx](file:///Users/yuest/Documents/pinbean/perler-beads-ai/src/app/page.tsx#L925-L927)）

**建议实现**
- Miniapp 暂时使用固定阈值（30）可作为默认，但中期应：
  - 在算法层将 `mergeThreshold` 提升为显式参数（即使 UI 不暴露，也应集中在一个常量/配置位置）
  - 未来若要进一步“Web-first”，可直接移植 Web 的合并段落到 Miniapp，并保持代码结构一致（减少偏差）

### P1：模块化（为持续复刻降低成本）

**目标**
- 把 `miniapp/pages/index/index.js` 中的“图片输入、生成、编辑、导出、统计”拆分模块，以便后续继续复刻 Web 功能时可控。

**建议拆分文件**
- `miniapp/pages/index/modules/generate.js`：生成流程（canvasGetImageData -> imageProcessor.pixelate）
- `miniapp/pages/index/modules/editing.js`：编辑模式（画笔/选中/吸管/替换/撤销）
- `miniapp/pages/index/modules/export.js`：导出图纸/带色卡图纸
- `miniapp/pages/index/modules/stats.js`：统计重算、排序、过滤透明/外部

## Assumptions & Decisions

- 以“网页版优先”为准：算法行为以 `perler-beads-ai` 为真相来源，小程序尽量复刻，不再走 Lab/边缘检测等复杂分支（复杂版作为备份保留）。
- P0 默认“去背景不自动触发”，而是提供按钮触发，避免误删主体；后续可再加“自动判断”策略。
- Miniapp 保留对原图缩放上限（性能稳定优先），但裁剪 + 去背景能显著弥补缩略带来的杂色问题；后续可再讨论将上限提升到 400/800 的取舍。

## Verification（验收与对比方法）

### 对齐验收（Web vs Miniapp）
- 使用同一张图片：
  1) Web：裁剪 -> 生成（dominant/average）-> 导出/统计
  2) Miniapp：裁剪 -> 生成 -> 全局合并 -> 一键去背景 -> 导出/统计
- 对比指标：
  - 颜色种类数量（key 数）
  - 主体轮廓是否丢失（尤其眼睛/描边/小细节）
  - 背景是否被正确清理（外部区域透明，统计不计入）

### 小程序端手工验证清单
- 裁剪：裁剪后的 `tempFilePath` 可用；裁剪后再次生成不崩溃
- 去背景：按钮触发后背景显著减少；再次点击不会把主体继续“吃掉”（需要防重复或可撤销）
- 导出：导出的图纸与统计与当前一致（透明/外部区域不应计入）

