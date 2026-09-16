# 编辑模式工具重构与增强计划 (Edit Mode Tools Refactoring Plan)

## 1. 目标 (Summary)
重构当前的编辑模式，将“滑动选中”功能解耦，引入明确的**工具切换按钮（拖动、选中、画笔、吸管）**，彻底解决误触问题。同时，重新引入安全的**放大/缩小功能（通过按钮控制）**，并支持单指拖动画布。

## 2. 当前状态分析 (Current State Analysis)
目前编辑模式下，只要手指在画布上滑动，就会触发“选中”格子（`_handleTouch`）。由于缺乏独立的工具状态管理，如果想单指拖动画布，极易误触导致画脏图纸。
之前尝试过的手势缩放和平移也因为手势冲突被移除，现在亟需一套稳定、不冲突的按钮式工具栏。

## 3. 拟进行的修改 (Proposed Changes)

### 3.1 增加工具栏状态与画布变换变量 (`index.js`)
*   **状态新增**:
    *   `editTool`: 字符串，可选值为 `'pan'` (拖动, 默认), `'select'` (选中), `'pen'` (画笔), `'eyedropper'` (吸管)。
    *   `activePenColor`: 对象 `{hex, key}`，用于记录当前画笔选中的颜色（默认取调色板第一个）。
    *   `zoomScale` (默认 1), `translateX` (默认 0), `translateY` (默认 0) 用于画布缩放和平移。
    *   `isPanning`, `lastPanPos` 用于处理单指拖动逻辑。

### 3.2 UI 界面重构 (`index.wxml` & `index.wxss`)
*   **工具切换按钮**: 在 `edit-toolbar` 顶部增加一行工具按钮，支持高亮当前选中的工具。
    *   `[✋ 拖动] [🔲 选中] [🖌️ 画笔] [💧 吸管]`
*   **缩放控制按钮**: 增加独立的放大和缩小按钮（例如在工具栏右侧或浮动在画布上）。
    *   `[🔍 放大] [🔍 缩小]`
*   **画布容器重构**:
    *   将 `.canvas-wrapper` 的 `overflow: auto` 改为 `overflow: hidden`。
    *   重新包裹一层 `<view class="canvas-zoom-container">`，应用 `transform: translate({{translateX}}px, {{translateY}}px) scale({{zoomScale}})`，实现平滑的 CSS 缩放和移动。

### 3.3 交互逻辑重写 (`index.js`)
*   **触摸事件 (`onTouchStart`, `onTouchMove`, `onTouchEnd`) 分流**:
    *   **`editTool === 'pan'`**: 记录手指位置，根据移动的 `deltaX` 和 `deltaY` 更新 `translateX` 和 `translateY`。
    *   **`editTool === 'select'`**: 维持现有的滑动选中逻辑，记录到 `selectedCells` 并绘制半透明高亮。
    *   **`editTool === 'pen'`**: 手指滑动到的格子，直接替换为 `activePenColor`（自动保存历史快照并实时重绘 `exportGrid`）。
    *   **`editTool === 'eyedropper'`**: 获取点击的格子的颜色，更新为 `activePenColor`，然后自动将工具切换回 `'pen'`。
*   **缩放逻辑 (`onZoomIn`, `onZoomOut`)**:
    *   `onZoomIn`: 将 `zoomScale` 乘以 1.5，最大限制为 5。
    *   `onZoomOut`: 将 `zoomScale` 除以 1.5，最小限制为 1。如果回到 1，则重置 `translateX` 和 `translateY`。
    *   每次缩放和平移后调用 `_constrainPan` 确保图像不出界。

## 4. 假设与决策 (Assumptions & Decisions)
*   **防误触决策**: 通过强制切换工具（特别是把“拖动”设为默认），用户必须主动点击“选中”或“画笔”才能修改图纸，从根本上杜绝了拖动查看时的误操作。
*   **交互简化**: 放弃复杂且易冲突的双指缩放/双击缩放，改用显式的放大/缩小按钮，对于像素级编辑应用来说是最稳定可靠的选择。

## 5. 验证步骤 (Verification Steps)
1.  进入编辑模式，确认默认工具为“拖动”，单指滑动可以平滑移动画布。
2.  点击放大/缩小按钮，确认画布缩放正常且不会超出边界。
3.  切换到“选中”工具，确认单指滑动能拉出蓝色的高亮框。
4.  切换到“吸管”工具，点击任意豆子，确认底部的色板选中了该颜色，并自动跳转到了“画笔”工具。
5.  在“画笔”工具下，滑动手指，确认能直接在图纸上画出选中的颜色。