# miniapp 重构路线图归档说明

> 更新日期：2026-09-02
> 状态：本文不再作为当前执行路线图。旧原生微信小程序完整保留在 `v1` 分支；当前主交付端是 `apps/miniapp-uni/`，共享业务事实来源是 `packages/bead-core/`。

## 当前事实

- `apps/miniapp-uni/` 已替代旧原生小程序成为微信/H5 主客户端。
- 根 `project.config.json` 指向 `apps/miniapp-uni/dist/build/mp-weixin/`。
- `v1` 分支保留旧 `apps/miniapp-native-reference/` 完整源码；`main` 已剔除该源码目录。
- `packages/bead-core/` 已收口生成、Numeric Grid、稳定 Color ID、编辑事务、撤销/重做、去背景、统计、严格项目解码、内容 Hash、备料、29×29 分板、制作评估和进度。
- `packages/palette-data/` 已提供五套供应商色板的公开 Palette API；运行时代码不再直接读取 raw JSON。

## 已完成迁移

- Web 与 uni-app 均通过 Adapter 消费共享 Core。
- Web 主要编辑、去背景、颜色替换、撤销/重做已改用 Core Pattern Session。
- uni-app Store 与编辑服务已改用同一 Core Pattern Session。
- 完整供应商色板未使用色支持“选中不修改 Pattern、首次落笔进入 Pattern”。
- 相册权限恢复、连续画笔/橡皮、吸管、分板主色摘要已补齐。
- 旧原生包已解除 workspace、根脚本和根门禁依赖。

## 保留本文的原因

本文记录了早期 Web-first、原生小程序模块化、导出能力迁移和裁剪取舍的历史背景。需要查看旧交互时，应通过 `git show v1:<path>`、独立 worktree 或 Git 历史读取；不要把旧对象 Cell 模型、旧路径或旧 npm 包恢复到 `main`。

## 当前执行入口

- 开发工作流：`docs/DEVELOPMENT_WORKFLOW.md`
- 迁移状态：`docs/REFACTOR_STATUS.md`
- Core 行为规格：`docs/core-spec/BEAD_CORE_V1.md`
- uni-app 微信入口审计：`docs/UNIAPP_SWITCH_AUDIT.md`
- Monorepo 迁移记录：`docs/MONOREPO_MIGRATION.md`
