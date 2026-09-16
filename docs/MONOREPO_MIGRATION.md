# Monorepo 迁移记录

## 当前布局

```text
pinbean/
├── .git/                         # 唯一活动仓库
├── apps/
│   ├── web/                      # Next.js 网页工作台与行为参考
│   └── miniapp-uni/              # Vue 3 + TypeScript 微信/H5 主客户端
├── packages/
│   ├── bead-core/                # 纯 TypeScript 业务事实来源
│   └── palette-data/             # 共享供应商色号映射与 Palette API
├── package.json                  # npm workspaces
├── package-lock.json             # 唯一锁文件
└── project.config.json           # 微信开发者工具根项目，指向 uni-app mp-weixin 构建产物
```

`apps/miniapp-uni` 已替代旧原生微信小程序成为主交付端。根入口指向 `apps/miniapp-uni/dist/build/mp-weixin/`。旧原生实现完整保留在 `v1` 分支，`main` 不再携带其源码，也不再将其纳入 npm workspace、根测试或生产入口。

当前迁移状态见 `docs/REFACTOR_STATUS.md`；Core 行为契约见 `docs/core-spec/BEAD_CORE_V1.md`；微信入口状态见 `docs/UNIAPP_SWITCH_AUDIT.md`。

## 历史保留

- 原根仓库基线：`ba67539`。
- 迁移前工作区快照：`a796ad6`，标签 `reference/workspace-before-monorepo`。包含当时 Web 的未提交工作和 Native 两个已完成提交对应的文件内容。
- 历史保留合并：`6fc7fde`，父提交包含 Web `9e07b9a`、Native `e08cb4f`。合并不更改文件树，也不重写原提交哈希。
- 原始分支：`reference/web/*`、`reference/native/*`。
- Native 初始版本：`reference/native/miniapp-initial-version`，解引用为 `f2abe2c`。

原始 app refs 的目录结构不同，**不要在当前工作区直接切换到这些分支**。可用以下方式只读检查：

```bash
git log reference/web/feat/pixelation-v2
git show reference/native/miniapp-initial-version:pages/index/index.js
git show reference/workspace-before-monorepo:perler-beads-ai/src/app/page.tsx
```

## 外部恢复备份

迁移前完整备份位于仓库外的私有备份目录：

```text
<private-backup-root>/monorepo-20260828-01/
```

目录权限为 `0700`，不属于本仓库。包含：

- `root.bundle`、`web.bundle`、`native.bundle`：全部原始 refs 和可达提交。
- `workspace.tar.gz`：原始工作区和 Git 元数据；不含可重建的 `node_modules`、Next 构建缓存、静态导出和 Core dist。
- `*-working.patch`、`*-index.patch`：原工作区和暂存区差异。
- `metadata.json`、`manifest.json`：原始 HEAD/分支和文件 SHA-256。
- `web.git/`、`native.git/`：从工作区移出的原始 Git 目录，保留配置、reflog 和索引。
- `dependency-versions-before.json`：统一锁文件前的依赖版本清单。

备份可能包含本地配置和凭据，禁止上传或提交。恢复应在新建的空目录进行，不能直接覆盖当前仓库。

例如恢复原 Web Git 历史并重放其未提交修改：

```bash
git clone <private-backup-root>/monorepo-20260828-01/web.bundle /tmp/pinbean-web-recovery
git -C /tmp/pinbean-web-recovery switch feat/pixelation-v2
git -C /tmp/pinbean-web-recovery apply <private-backup-root>/monorepo-20260828-01/web-working.patch
```

如果需要忽略文件和本地环境配置，应从 tar 归档恢复到空目录。不要依赖 Git bundle 恢复未追踪或忽略文件。

## 日常命令

在仓库根目录运行：

```bash
npm ci
npm run dev:web
npm run build:web
npm run check:core
npm run check:palette
npm run check:uni
npm run test:web
npm run check
```

微信构建：

```bash
npm run build:uni:mp-weixin
```

仍用微信开发者工具打开根目录。`project.config.json` 的 `miniprogramRoot` 指向 `apps/miniapp-uni/dist/build/mp-weixin/`；修改 uni-app 后先运行微信 production 构建，再由开发者工具读取产物。

统一锁文件从原有多个锁文件合并。新增或更新依赖使用 `npm install <package> --workspace=<path>`，只提交根锁文件，不创建子目录 lockfile。

## 迁移边界

- Web 与 uni-app 的跨端业务规则通过 `packages/bead-core` 和 `packages/palette-data` 共享。
- 旧原生实现只允许作为只读参考，不恢复为 workspace 或生产入口。
- 本地 env、`.claude`、`.wrangler` 和构建缓存保持本地，根 `.gitignore` 覆盖新路径。
- 桌面构建和 Node 测试不能替代微信开发者工具、真机或实际导出验证。

## 验证记录（2026-08-28）

- 完整归档中的 199 个非缓存文件 SHA-256 核验通过。
- 目录迁移后 136 个应用文件逐字节一致；随后仅调整 Native README 的相对链接，并将子锁文件合并到根锁文件。
- 在独立恢复目录从 bundle clone 并应用原工作区 patch，Web 98 个、Native 34 个 tracked 文件与备份哈希一致。
- Web `9e07b9a`、Native `e08cb4f`、Native 初始版本 `f2abe2c` 均为新根分支的祖先。
- 标准根目录 `npm ci` 成功；锁文件未引入任何新依赖版本。
- 根目录 `npm run dev:web` 启动成功，首页 HTTP 200，标题为 `PinBean｜拼豆制作台`。临时验证服务已停止。
- 当时 `npm run check` 通过：core 12 个测试、Native 6 个测试、core TypeScript/lint/build、Web 静态构建。
- Web 原有两条 `AIOptimizeModal.tsx` 的 `<img>` lint 警告仍保留；旧依赖的 deprecation 警告未通过升级或禁用检查掩盖。
- 当时未执行微信开发者工具及真机 UI 验证；后续状态以 `docs/UNIAPP_SWITCH_AUDIT.md` 为准。

## 验证记录（2026-09-02）

- `apps/miniapp-uni` 已完成微信/H5 主入口切换。
- `v1` 分支保存旧原生实现；`main` 不携带旧版源码，根 workspace、根脚本和根门禁均只面向新版。
- `packages/bead-core` 已扩展为生成、编辑事务、严格解码、制作领域和进度事实来源。
- `packages/palette-data` 已提供 runtime public API，应用不再直接读取 raw JSON mapping。
- 文档同步后需以根 `npm run check` 和 stale reference scan 作为最终迁移门禁。
