# miniapp 结构清理与模块化落地路线

## Summary

把 `miniapp` 重构成“干净目录 + 模块化开发 + 可回归验收”的工程形态，目标收敛到最小闭环：

上传 → 识别生成 →（可选去背景）→ 导出（纯图纸/色卡图纸）

本次重构以“不改变现有功能行为”为第一原则，在此基础上：

1. 先把 `pages/index/index.js` 变成薄控制器（只负责状态与事件转发）
2. 将导出与编辑逻辑迁移到 `pages/index/modules/export.js`、`pages/index/modules/editing.js`
3. 新增并启用 `services/`（权限/相册保存/存储等宿主封装）
4. 新增并启用 `components/`（至少落地一个可复用 UI 组件）
5. 清理嵌套 `.git`，统一由根仓库管理

## Current State Analysis（基于仓库现状）

### 现有目录与入口

- 小程序根：`/Users/yuest/Documents/pinbean/miniapp/`
- 全局路由：`miniapp/app.json` 仅包含 `pages/index/index`
- 首页：`miniapp/pages/index/index.js|wxml|wxss`
- 已存在页面内模块骨架：`miniapp/pages/index/modules/*`
  - `generate.js` / `background.js` / `stats.js` 已在 `index.js` 中被引用并实际生效
  - `export.js` / `editing.js` / `ui.js` 目前为空壳（`module.exports = {}`)

### 现状问题（导致“文件太乱/难维护”）

1. `pages/index/index.js` 同时承担：
   - 页面状态、生成链路、编辑模式、导出绘制、保存权限处理等多种职责
2. 导出逻辑与编辑逻辑强依赖页面 `this.data`，可复用与可测试性差
3. `wx.*` 宿主能力（相册权限、canvas 导出）散落在页面代码里，难统一处理异常路径
4. 缺少通用组件目录，WXML 中重复片段多（segment 控件/工具切换等）
5. `miniapp/` 与 `perler-beads-ai/` 内嵌 `.git`，容易让工具链与团队协作混乱

## Proposed Changes

### 1) 定义 PinBean（miniapp）目标结构（最终目录树）

目标：让“放哪儿”成为确定规则，避免功能迭代时再次堆进一个大文件。

```
miniapp/
├── app.js / app.json / app.wxss
├── pages/
│   └── index/
│       ├── index.js          # 薄控制器：状态字段 + 事件转发 + 调度
│       ├── index.wxml/wxss
│       └── modules/
│           ├── generate.js    # 生成主链路（已有）
│           ├── export.js      # 导出（迁移 index.js 中导出相关）
│           ├── editing.js     # 编辑模式（迁移 index.js 中编辑相关）
│           ├── background.js  # 去背景（已有）
│           ├── stats.js       # 统计（已有）
│           └── ui.js          # UI 辅助（toast/modal/节流等）
├── utils/
│   ├── imageProcessor.js      # 核心算法入口（已存在）
│   ├── rgbCore.js             # 底层色彩工具（已存在）
│   └── ...（色板/映射等）
├── services/
│   ├── album.js               # 相册权限 + 保存图片（统一处理授权/失败路径）
│   ├── canvas.js              # canvasToTempFilePath Promise 化封装
│   └── storage.js             # wx.setStorageSync/getStorageSync 统一封装（可选）
└── components/
    └── pb-segmented/          # 通用 segmented 组件（本次落地并在首页使用）
```

说明：

- `modules/`：页面内“业务能力模块”，按功能纵切（generate/export/editing）。
- `utils/`：纯算法与数据，不依赖 Page/Component。
- `services/`：所有 `wx.*` 宿主能力封装层，禁止在 modules/index 里直接散落调用（除非临时过渡）。
- `components/`：跨页面复用的 UI（本次至少落地一个组件并接入首页，避免空目录）。

### 2) 导出模块化（index.js → modules/export.js）

目标：把导出相关逻辑从页面迁移到 `modules/export.js`，页面只保留同名 handler 做转发，WXML 无需改动。

迁移范围（来自 `miniapp/pages/index/index.js`）：

- `_drawExportCanvasCore`
- `_drawExportCanvas`
- `onSaveWithLegend`
- `onSaveImage`

模块 API（采用“page 传入”的方式）：

- `exportModule.onSaveWithLegend(page)`
- `exportModule.onSaveImage(page)`
- `exportModule.drawExportCanvas(page)`（内部复用）
- `exportModule.drawExportCanvasCore(page, options)`（内部复用）

配套 services：

- `services/canvas.js`：封装 `wx.canvasToTempFilePath` 为 Promise（可统一超时、错误信息）
- `services/album.js`：封装保存逻辑：
  - `ensureWriteAlbumPermission()`：`wx.getSetting` → `wx.authorize` → 失败则引导 `wx.openSetting`
  - `saveTempFileToAlbum(filePath)`：统一 toast 文案与失败提示

### 3) 编辑模块化（index.js → modules/editing.js）

目标：把编辑模式相关逻辑迁移到 `modules/editing.js`，页面仅负责：

- 对外暴露 wxml 绑定的 handler（同名）
- 将 `page` 实例传给模块

迁移范围（来自 `miniapp/pages/index/index.js`，按当前实现）：

- 进入/退出编辑：`onToggleEditMode`
- 工具选择：`onSelectTool`
- 触摸交互：`onTouchStart` / `onTouchMove` / `onTouchEnd`
- 选区与覆盖层：`_handleTouch` / `_drawOverlay` / `onClearSelection`
- 画笔/吸管：`_handlePenTouch` / `_handleEyedropperTouch`
- 撤销/历史：`_saveHistory` / `onUndo`
- 删除/替换：`onDeleteCells` / `onPaletteColorClick` / `onReplaceColor` / `_replaceGlobalColor`
- 统计重算：`_recalculateStats`
- 去背景按钮 handler：建议作为 `editingModule.onRemoveBackground(page)`（内部调用 `modules/background.js` 与 `modules/stats.js`）

依赖处理（在模块内显式引用，而不是从 page 上拿隐式全局）：

- `const imageProcessor = require('../../../utils/imageProcessor.js');`
- `const { calcStats } = require('./stats.js');`
- `const { removeBackgroundByFloodFill } = require('./background.js');`

### 4) UI 组件化（新增并启用 components/pb-segmented）

目标：让首页的 segmented 控件从“重复 WXML 模板”变成可复用组件，并作为组件化体系的起点。

落地范围：

- 新增 `miniapp/components/pb-segmented/`（wxml/wxss/js/json）
- 组件能力：
  - `properties: { value, options }`
  - `triggerEvent('change', { value })`
- 首页接入（`pages/index/index.wxml`）：
  - 替换“处理风格/预览模式/编辑工具”这三处 segmented 结构为组件
  - `pages/index/index.json` 增加 `usingComponents` 引用

### 5) services 抽离（宿主能力统一入口）

目标：把散落在页面/模块的 `wx.*` 调用逐步收敛到 `services/`，降低后续扩展（如云端 API、更多导出格式）的成本。

本次必做：

- `services/album.js`：相册权限与保存
- `services/canvas.js`：canvas 导出

可选（若迁移过程中发现重复明显）：

- `services/storage.js`：色板系统选择的 `wx.setStorageSync/getStorageSync` 统一封装

### 6) 清理嵌套 .git（统一根仓库）

目标：只保留根目录 `.git/`，删除：

- `miniapp/.git/`
- `perler-beads-ai/.git/`

说明：

- 这不会影响小程序/网页运行，只是避免“仓库里套仓库”带来的工具与协作混乱。

## Assumptions & Decisions

- 不改变现有页面路由：`app.json` 仍以 `pages/index/index` 为首页。
- 不引入新框架（保持原生小程序 + CommonJS require）。
- 重构优先级：导出 → 编辑 → services → 组件化（组件化只落地一个最小可复用组件，避免过度重构）。
- modules 采用“page 传入”的调用方式：页面保留同名 handler，内部转发到模块，WXML 绑定无需改。

## Verification（验收步骤）

### 编译与运行

1. 微信开发者工具打开仓库根目录（使用根 `project.config.json`，`miniprogramRoot=miniapp/`）
2. 编译通过，无红色报错
3. 真机预览可打开首页（不再出现“页面不存在”）

### 最小回归清单（每次迁移后都跑）

1. 生成：
   - 上传图片
   - 卡通/写实各生成一次
   - 预览网格正常、颜色统计正常
2. 编辑：
   - 开启编辑模式
   - 画笔修改 3 个格子，撤销 1 次
   - 选中 → 删除
   - 吸管吸取颜色后自动切回画笔
3. 去背景：
   - 点一次去背景，统计数量减少
4. 导出：
   - “保存图纸”（纯图纸）导出不为空白
   - “色卡图纸”导出成功并可保存到相册
   - 权限拒绝/未授权时提示路径正确（能引导到设置页）

### 结构验收（重构完成后）

- `miniapp/pages/index/index.js` 只保留：
  - data 初始化
  - 生命周期
  - handler 转发（调用 modules）
  - 少量页面级渲染方法（如 `_drawGrid`）或进一步迁移到 modules/ui（视具体情况）
- `modules/export.js`、`modules/editing.js` 不再是空壳，且各自职责清晰

