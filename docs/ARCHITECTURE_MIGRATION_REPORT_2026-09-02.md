# PinBean 旧架构到新架构迁移报告

日期：2026-09-02

## 结论

旧架构到新架构的代码迁移已完成，并通过根 `npm run check`。当前架构以 `packages/bead-core` 为跨端业务事实来源，以 `packages/palette-data` 为供应商色板事实来源；`apps/miniapp-uni` 是微信/H5 主交付端，`apps/web` 是网页工作台与行为参考。旧原生微信小程序完整保留在 `v1` 分支，并已从 `main` 工作树、npm workspace、根脚本、根门禁和生产入口剔除。

## 核心变化

- Core 事实源：生成、Numeric Grid、stable Color ID、编辑事务、撤销/重做、去背景、统计、严格项目解码、内容 Hash、备料、29×29 分板、制作评估和进度已收口到 `packages/bead-core`。
- 色板事实源：五套供应商品牌色板由 `packages/palette-data` 提供公开 API，应用运行时代码不再直接读取 raw palette JSON。
- Web 收口：主要编辑、去背景、颜色替换、撤销/重做、CSV 兼容导入和 Focus v2 读取都通过 Core Pattern/Session；CSV 导入不再白底合成后重新采样。
- uni-app 收口：Store 与编辑服务改用 Core `PatternSession`；未使用色选中不修改 Pattern，首次落笔才进入局部 paletteTable；补齐相册权限恢复、连续画笔/橡皮、吸管和分板主色摘要。
- 原生版退役：`v1` 分支固定旧版最后一个提交并保留 `apps/miniapp-native-reference` 完整源码；`main` 删除旧版源码，根 lockfile 中旧 workspace 包残留已移除。
- 文档同步：`AGENTS.md`、`README.md`、`CLAUDE.md`、`MINIAPP_REFACTOR_ROADMAP.md`、`docs/core-spec/BEAD_CORE_V1.md`、`docs/DEVELOPMENT_WORKFLOW.md`、`docs/REFACTOR_STATUS.md`、`docs/UNIAPP_SWITCH_AUDIT.md`、`docs/MONOREPO_MIGRATION.md`、`docs/AGENT_COLLABORATION_HANDOFF.md` 已更新到新入口和新边界。

## 算法与兼容

- 新生成使用 `algorithmVersion = 2`。
- V2 修复 cartoon final vote 平票语义：最终计数平票时首见 palette index 胜出。
- 已知 legacy `algorithmVersion = 1` 项目继续可读；未知算法版本和未知 schema 版本明确失败。
- `.pinbean.json` 继续保存 schema、算法版本、palette metadata、局部 paletteTable、Grid、GenerationConfig，以及客户端侧进度/用途/复盘侧车。
- 生产进度新写入使用 content hash：按实际格子的 stable Color ID 计算，忽略未使用 paletteTable 项；旧 full paletteTable hash 只作为 legacy key 读取路径。
- 导入和恢复入口执行严格 `unknown` 校验，损坏文件、palette drift、越界 cell 和非法 GenerationConfig 不会污染当前会话。

## 有意不迁移或延后

- 旧原生对象 Cell 模型不进入 Core；只在 `v1` 分支中作为历史参考。
- Web AI 图片优化仍依赖外部付费 API 与凭据，不作为本地制图迁移阻塞项。
- 内置裁剪继续取消，依赖系统相册裁剪。
- Native 全屏预览、矩形选区、清空/删除等交互不作为主闭环阻塞项。
- 过程组合长图继续延后，等待 Project 原图/成品照片素材生命周期明确。
- Web 标准 `.pinbean.json` 项目文件完整 UI 仍属于后续 Web 体验增强；本轮已完成 CSV 兼容导入直建 Core Pattern 与 Focus v2 Pattern 存储。

## 验证结果

- `npm run check`：通过。
- Core：32 项测试通过，并完成 typecheck、lint、build。
- Palette Data：8 项测试通过，并完成 typecheck、build。
- Web：16 项测试通过，production build 通过。
- uni-app：56 项测试通过，并完成 Vue typecheck、ESLint、H5 build、`mp-weixin` build 和微信产物语法扫描。
- stale reference scan：live code/config 中无旧原生 workspace/package 引用；Web/uni-app runtime source 中无 `@pinbean/palette-data/color-system-mapping.json` 直接导入。
- Web build 剩余 2 条既有 `AIOptimizeModal.tsx` `<img>` warning；本轮新增的 React Hooks dependency warning 已清除。

## 人工 Gate

以下仍不能用自动化或 H5 结果冒充完成：

- Android/iOS 真机相册保存成图清晰度。
- 微信文件分享面板真实成功。
- 真机触摸坐标、连续画笔、吸管和大图滚动手感。
- 80×80 真机 Canvas 内存、导出耗时和冷启动恢复。
- 真实微信账号/设备条件下的权限拒绝再开启流程。

## 风险边界

- `npm audit` 仍报告既有依赖链安全告警，本轮没有执行 `npm audit fix` 或 `--force`，避免把 DCloud/构建链大版本升级混入架构迁移。
- `.zcode/` 是本地计划文件目录，未作为产品源码处理。
- 未执行 `git push`、生产发布、凭据修改或历史删除。
