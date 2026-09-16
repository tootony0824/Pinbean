# Tasks

- [x] Task 1: 清理云端 API 相关代码
  - [x] SubTask 1.1: 删除 `miniapp/pages/index/index.wxml` 中的 `✨ AI 一键抠图` 按钮及相关的包裹容器。
  - [x] SubTask 1.2: 删除 `miniapp/pages/index/index.wxss` 中的 `.preview-actions`, `.action-btn` 等相关样式。
  - [x] SubTask 1.3: 删除 `miniapp/pages/index/index.js` 中的 `onRemoveBackground` 及 `_doBaiduMatting` 函数，清理相关状态变量。

- [x] Task 2: 架构重构：抽离图像处理算法 (架构优化)
  - [x] SubTask 2.1: 创建 `miniapp/utils/imageProcessor.js`。
  - [x] SubTask 2.2: 将 `index.js` 中的 `_pixelate`, `_hexToRgb`, `_getContrastColor`, `_colorDist`, `_buildPalette`, `_closest` 等方法迁移到 `imageProcessor.js` 并导出。
  - [x] SubTask 2.3: 在 `index.js` 中引入重构后的 `imageProcessor` 模块，并替换旧的方法调用。

- [x] Task 3: 本地边缘检测与增强算法实现
  - [x] SubTask 3.1: 在 `imageProcessor.js` 中实现经典的边缘检测算法（如基于 Sobel 算子的简单卷积），或者使用对比度拉伸技术。
  - [x] SubTask 3.2: 将边缘检测算法集成到像素化流程 (`_pixelate` 之前) 中。即在提取网格平均色或主色之前，先对源图或采样块进行边缘强化，强制为边缘像素赋予一个较深的权重，防止被背景同化。

- [x] Task 4: 添加“边缘强化”调节滑块 (用户控制)
  - [x] SubTask 4.1: 在 `index.wxml` 中，在处理风格或尺寸选择区域下方，添加一个 `slider` 用于调节“边缘强化程度 (Edge Enhancement)”。
  - [x] SubTask 4.2: 在 `index.js` 增加 `edgeStrength` 状态并绑定滑块事件。
  - [x] SubTask 4.3: 将 `edgeStrength` 参数传递给 `imageProcessor.pixelate` 方法，以控制边缘增强算法的强度（0 为关闭，越大越明显）。

- [x] Task 5: 优化编辑模式工具栏排版 (UI 优化)
  - [x] SubTask 5.1: 检查并修复编辑模式下 `[➖] 100% [➕]` 缩小功能失效的问题（此前已通过固定缩放阶梯尝试修复，需重新确认）。
  - [x] SubTask 5.2: 重新设计编辑模式的工具栏排版，确保 `拖动`、`选中`、`画笔`、`吸管` 以及缩放控制和撤销、删除等按钮布局更加紧凑合理，符合用户直觉。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]
- [Task 5] can run parallel with [Task 2]