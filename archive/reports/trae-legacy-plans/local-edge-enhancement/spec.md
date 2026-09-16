# 本地化主体分割与架构优化 (Local Salient Object Detection & Architecture Refactoring) Spec

## Why
目前项目在处理背景与主体颜色相近的图片时，边缘轮廓会被“吃掉”。之前尝试通过调用云端 AI API (如 Remove.bg 或 百度智能云) 来去除背景，但这种方案引入了外部依赖、网络延迟、成本以及可能的隐私问题。
为了让项目“走得更远更好”，我们需要回归本源，重新思考架构。项目的核心是将**任意图片转化为拼豆图纸**，底层的核心是**像素化算法**与**色彩映射算法**。解决轮廓不清晰的问题，完全可以通过**纯本地的前端算法**来实现，而不需要依赖重度的 AI 模型。

## What Changes
1.  **移除云端 API 依赖**：删除 `index.wxml`, `index.wxss`, `index.js` 中所有关于调用百度云或 Remove.bg 进行抠图的代码和 UI 按钮。
2.  **本地化边缘增强算法 (Edge Enhancement)**：
    *   引入本地图像处理逻辑。在进行网格化（`_pixelate`）之前或过程中，使用经典的图像处理算法（如 Sobel 算子、Canny 算子或简单的对比度增强）来检测和强化边缘。
    *   即使背景和主体颜色相近，边缘通常也会有细微的梯度变化。通过算法将这些变化放大（例如，在边缘处强制描上深色线），从而在像素化采样时保护轮廓不被吞噬。
3.  **色彩空间转换与智能阈值**：
    *   在色彩映射时，不仅仅计算 RGB 的欧几里得距离，可以考虑将图像转换到 HSL 或 LAB 色彩空间，因为它们更符合人类视觉对亮度和边缘的感知。
4.  **提供“对比度/边缘强化”调节滑块**：
    *   既然是纯本地算法，我们可以将控制权交给用户。提供一个滑块，让用户手动调节边缘检测的强度，以便适应不同类型的图片。
5.  **架构梳理与解耦**：
    *   将图像处理的核心算法（像素化、边缘检测、颜色映射）从 `index.js` 页面逻辑中抽离出来，形成独立的 `utils/imageProcessor.js` 模块，保持页面逻辑清晰。

## Impact
- Affected specs: 图像上传、参数调节、图纸生成流程。
- Affected code: `miniapp/pages/index/index.js`, `miniapp/pages/index/index.wxml`, `miniapp/pages/index/index.wxss`, 新增 `miniapp/utils/imageProcessor.js`。

## ADDED Requirements
### Requirement: Local Edge Enhancement
The system SHALL provide a local algorithm to detect and enhance image edges before or during pixelation, preventing outline loss without relying on external APIs.

#### Scenario: Success case
- **WHEN** user uploads an image with similar background and foreground colors.
- **THEN** the system applies edge enhancement locally, and the generated bead grid clearly shows the outline of the subject.

### Requirement: Algorithm Decoupling
The system SHALL separate core image processing logic from the UI page logic.

## REMOVED Requirements
### Requirement: Cloud AI Background Removal
**Reason**: To reduce external dependencies, costs, and complexity, and focus on robust local image processing algorithms.
**Migration**: Remove all related API calls, UI buttons, and state variables related to "AI 一键抠图".