# MARD 常用 120 色板：对齐与接入计划（miniapp）

## Summary

目标：在 `miniapp` 中只保留 **MARD** 一个色号系统，并将用于“RGB 最近色映射 + 全局合并”的调色板从当前的 **291 色**收敛为“市面常见 120 色套装”级别的**常用约 120 色**（阈值隐式固定 30），从而提升生成体验（颜色更少、风格更稳定）并降低维护复杂度。

输出物：
- 一份可落库的 **MARD 常用色板（≈120）** 数据文件（key + hex + rgb）
- 小程序仅展示/使用 MARD 色号，不再暴露其他画板/色号系统
- 校验：现有 RGB 核心链路仍可运行，且 palette size≈120

## Current State Analysis（基于仓库现状）

### miniapp 现有颜色数据

- `miniapp/utils/colorMappingData.js`：当前包含多系统映射（MARD/COCO/漫漫/盼盼/咪小窝等）。通过检索可见 **MARD 映射条目约 291**（与公开整理站点一致）[^pixel-beads].
- `miniapp/utils/rgbCore.js`：当前 RGB 核心算法实现（代表色提取、最近色、全局颜色合并），并通过 `COLOR_MAPPING` 构建 palette。
- `miniapp/utils/imageProcessor.js`：调用 `rgbCore` 完成像素化与全局合并，合并阈值目前已按要求**隐式固定 30**。

### 当前问题

- palette 过大（291）：生成结果颜色种类偏多，且维护成本高。
- 多色号系统/画板在 UI/数据层并存：重构目标是先**专注 MARD 一套**，降低复杂度。

## Proposed Changes

### Step 0：确定“常用 120 色套装”的权威数据源（输入前置）

你已确认：
- 口径：**120 色套装标准**
- 你有一个 `color-palette` 文件，其中包含 **MARD 标准颜色的 hex/rgb**，另有一个 **60 色简化版**，但你不确定是否为 MARD。
- 你倾向于**直接粘贴文件内容**给我。

执行前置条件：
- 你把 `color-palette` 文件内容粘贴到聊天（JSON/TS/CSV 均可）。

### Step 1：把 color-palette 变成仓库内的可追踪数据文件

新增文件（建议）：
- `miniapp/utils/mardPaletteSource.md`：原始粘贴内容的备份（便于追溯）
- `miniapp/utils/mardPalette120.json`：最终用于程序的“常用≈120色”标准化结构

标准化结构（建议固定）：
```json
[
  { "key": "A1", "hex": "#FAF4C8", "rgb": { "r": 250, "g": 244, "b": 200 } }
]
```

选择逻辑（决策已锁定）：
- 若 `color-palette` 明确提供 120 色集合：直接采用该集合为 `mardPalette120.json`
- 若只提供全量 MARD + 一个 60 色集合：以“全量 MARD”为准，**从中抽取 120 色集合**，抽取规则为：
  1) 优先使用文件内显式标注为“套装/常用/核心/standard/120”的集合（若存在）
  2) 若文件仅给 60 色集合：在其基础上补齐到 120（补齐规则：按色相/明度覆盖，优先补常见中间色与灰阶；补齐清单在 PR 中明确列出）

### Step 2：RGB palette 构建切换为“只读 mardPalette120.json”

修改文件：
- `miniapp/utils/rgbCore.js`

改动点：
- `buildPalette(cs)` 不再遍历 `colorMappingData.js`
- 直接加载 `mardPalette120.json` 构建 palette
- `cs` 参数保留但忽略（或强制要求 `cs === 'MARD'`，不满足则 fallback 到 MARD）

预期效果：
- `palette.length ≈ 120`
- `findClosestPaletteColor`、`calculatePixelGrid`、`mergeSimilarColorsByFrequency(threshold=30)` 行为不变，仅输入 palette 变小

### Step 3：小程序“画板/色号系统”只保留 MARD（UI 与默认值）

修改范围（以“不破坏 MiniMax 生成色纸 UI 设计”为约束）：
- `miniapp/utils/colorSystem.js`：`colorSystemOptions` 只保留 MARD；默认 system 固定 MARD
- `miniapp/pages/index/index.js`：删除/屏蔽切换系统相关逻辑，任何路径都使用 MARD
- `miniapp/pages/index/index.wxml`：如果有系统切换 UI，隐藏或移除（不改整体视觉风格，只做删减）

注意：
- 暂不删除 `colorMappingData.js` 中的其他系统字段（避免以后要恢复时成本高）；当前阶段只做“不可见 + 不可用”。

### Step 4：一致性校验（颜色是否正确）

校验方式：
1) 数据一致性
   - `mardPalette120.json` 中每个 `key` 的 `hex/rgb` 能互相转换（hex->rgb 校验）
   - 全部 key 唯一、hex 唯一（或允许不同 key 同色但需明确）
2) 功能回归（小程序）
   - 选 3 张图片（人像/风景/纯色背景）生成，确认：
     - 不崩溃
     - 颜色数显著减少（相比 291）
     - 色号显示均为 MARD
3) Web 对齐抽样
   - 随机抽 20 个 key，对比 `color-palette` 源文件与 miniapp 实际使用 hex 是否一致

## Assumptions & Decisions（已锁定）

- “常用 120”口径采用：**市面常见 120 色套装标准**。
- 合并阈值：RGB 全局相似色合并阈值**隐式固定为 30**，暂不对 UI 暴露。
- UI 约束：保留 MiniMax 的“生成色纸”UI 视觉设计，只做功能删减与数据源替换。

## Verification Steps（执行后验收）

- 代码层：
  - `rgbCore.buildPalette()` 实际 palette size ≈ 120
  - 小程序启动无报错（页面路由、require、JSON 格式正确）
- 体验层：
  - 同一张图生成结果颜色明显更少、更接近“套装常用色”的感觉
  - UI 不出现其他色号系统入口

---

[^pixel-beads]: 公开整理站点提供了 MARD 色号与 hex 的全量索引（包含 291 条记录）。来源示例：https://www.pixel-beads.com/zh/mard-bead-color-chart

