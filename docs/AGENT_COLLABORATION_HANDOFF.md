# PinBean 多 Agent 协作交接协议

> 用途：项目伙伴把本文或文末“启动提示词”交给自己的 Agent，让 Agent 在不依赖原开发对话的情况下安全参与 PinBean。  
> 默认语言：中文；代码、命令、标识符和技术名词保留英文。  
> 仓库形态：根目录是唯一活动 Git 仓库，Web、小程序和共享包都属于同一个 monorepo。

## 1. Agent 接手后的第一条原则

先读取当前仓库，再判断任务；不要根据旧计划、聊天摘要或目录名称推测现状。

开始任何修改前，依次读取：

1. 根 `AGENTS.md`
2. `README.md`
3. `CLAUDE.md`
4. `docs/REFACTOR_STATUS.md`
5. `docs/UNIAPP_SWITCH_AUDIT.md`
6. `docs/core-spec/BEAD_CORE_V1.md`
7. 与本次任务直接相关的源文件和测试

`MINIAPP_REFACTOR_ROADMAP.md` 包含历史路线，只能用于了解背景。实现可能已经超过旧里程碑，必须以当前代码、测试和状态文档为准。

## 2. 当前架构边界

| 路径 | 角色 | 修改规则 |
|---|---|---|
| `apps/web/` | Next.js 成熟网页版和行为参考 | 保留成熟 UI 与原导出体验；跨端业务规则不能只写在 Web 内 |
| `apps/miniapp-uni/` | uni-app 微信小程序/H5，当前主要交付目标 | 平台 UI、微信 Canvas、相册、分享和 Adapter 放这里 |
| `v1` 分支 | 已退役原生微信小程序完整源码 | 只读历史参考；不要合并回 `main` workspace、根门禁或生产入口 |
| `packages/bead-core/` | Web 与小程序共享的确定性业务核心 | 生成、网格、编辑、去背景、统计等跨端逻辑的唯一目标来源 |
| `packages/palette-data/` | 291 色供应商品牌映射和稳定颜色身份 | 不允许用显示色号替代稳定 Color ID |
| `docs/` | 规范、状态和验收证据 | 产品或架构决策变化时同步更新 |
| `archive/` | 历史备份与阶段报告 | 不作为当前实现，不批量整理或删除 |

共享 Core 不得依赖 Vue、React、Pinia、`wx`、`uni`、DOM、Canvas、Node 文件 API 或平台存储。

Core 网格使用数值 `BeadGrid`：

- `0 = EMPTY`
- `1...N = 当前项目色板索引`
- 色板身份使用稳定 Color ID
- Canvas 只是 Renderer，不是网格数据源

任何会影响最终图案结果的参数必须进入 `GenerationConfig`。算法结果发生设计变化时，要评估 `algorithmVersion`，并有意识地更新测试与 Golden Fixtures；禁止为了让测试变绿而直接改 expected 或削弱断言。

## 3. Git 协作规则

### 3.1 开始任务

在仓库根目录执行：

```bash
git status --short
git branch --show-current
git log -5 --oneline
git fetch origin
```

如果工作区有不属于本任务的修改，先识别所有者和用途。不得覆盖、清理、stash、reset 或提交别人的改动；无法安全隔离时停止并通知项目负责人。

从最新 `main` 创建任务分支。Agent 平台有强制分支前缀时遵循平台要求；没有时使用：

```text
feat/<short-task>
fix/<short-task>
test/<short-task>
docs/<short-task>
```

不要在活动工作区直接 checkout `reference/web/*`、`reference/native/*` 或历史标签。需要检查历史时使用 `git show`、`git log <ref>` 或独立 clone。

### 3.2 提交检查点

每个可独立验证和回退的阶段单独提交。一个提交只表达一个主要意图，例如：

```text
feat: 接入某项功能
fix: 修复安卓导出文字渲染
test: 增加导出回归
docs: 记录真机验证结论
```

提交前必须检查：

```bash
git status --short
git diff
git diff --check
```

不要提交：

- `.env*`、Access Key、Token、Cookie、登录状态
- `.wrangler`、`.claude`、本地 IDE 设置
- `node_modules`、`.next`、`out`、`dist` 和构建缓存
- 用户原图、批量测试输出、相册导出文件
- 子目录 `.git` 或新的子项目 lockfile

只维护根 `package-lock.json`。安装依赖必须从根 workspace 执行，不在 `apps/*` 下生成独立锁文件。

### 3.3 推送与合并

除非项目负责人明确授权，不执行 `git push`、强制推送、生产部署、重写历史或直接合并 `main`。

获得授权后，只推送自己的任务分支并创建 Pull Request。禁止直接推送 `main`，禁止 `git push --force`。同步主分支优先：

```bash
git fetch origin
git merge origin/main
```

出现冲突时逐文件解释双方意图；不要用 `ours`、`theirs` 或整文件覆盖快速消除冲突。

## 4. 实施流程

Agent 应按以下顺序推进：

1. 用一句话复述目标和成功标准。
2. 检查 Git 状态、相关文档、现有代码和现有测试。
3. 对复杂任务给出 3～7 步的简短计划。
4. 先复现问题或建立基线，记录当前行为。
5. 修改根因，只改完成任务需要的内容。
6. 运行最相关的小范围检查。
7. 运行受影响 workspace 的完整检查。
8. 涉及跨端共享行为时运行根 `npm run check`。
9. 涉及视觉、Canvas、下载或真机时补人工证据，并准确写清自动化边界。
10. 创建可回退的 Git 提交。
11. 更新 `docs/REFACTOR_STATUS.md`；重大版本同步更新 `experience.md` 和 `记录.md`。
12. 交付时报告修改、验证、提交、风险和未完成项。

不要为了未来可能需要的功能增加抽象、兼容层、配置或基础设施。优先选择当前最简单、可验证、跨端一致的实现。

## 5. 验证要求

### 5.1 共享 Core

```bash
npm run check:core
```

算法变化必须有可复现测试。Golden 输出只能在有明确产品或算法决定时变化。

### 5.2 Web

```bash
npm run test:web
npm run build:web
```

影响页面流程时，还要在浏览器检查对应环节：上传/裁剪、轮廓与细腻模式、去背景、编辑、统计和导出。浏览器自动化能证明页面与业务链路，但实际下载文件需要正常浏览器或文件解析验证。

### 5.3 uni-app

```bash
npm run check:uni
npm run test:h5:smoke --workspace=@pinbean/miniapp-uni
npm run test:wechat:smoke
```

修改生成、编辑或导出时，至少覆盖：

- 轮廓与细腻两种模式
- 去背景
- 撤销与重做
- 纯图纸与色卡图纸
- 非 MARD 品牌色号

微信开发者工具中的 mock 只能证明页面、Store、Core 和 Adapter 调用链，不能冒充真实相册、分享面板、权限和真机清晰度。涉及平台问题时明确写出设备、系统、微信版本、基础库、输入图片、设置和实际输出。

### 5.4 全仓检查

准备发 PR 前运行：

```bash
npm run check
```

如果全仓检查因为与本任务无关的既有问题失败，保留完整失败信息并说明；禁止删除测试、忽略错误或降低断言来制造绿色结果。

## 6. 产品已确认的约束

- 保留 Web 成熟界面与已经打磨的导出体验。
- uni-app 图纸导出采用已确认的混合设计：旧版 `🎨 豆画` 标题、旧版摘要和坐标留白，加上 uni-app 最小 900px 小图纸画布与 `A1 · 120` 形式图例。
- 拼豆时间只能称为“粗略摆豆时间”：按每小时约 400～650 颗估算，不含分装、返工、熨烫和装裱；没有真实数据前不要添加假精确系数。
- 图纸尺寸当前安全范围为 15～80 格。扩大上限前必须先有真机 Canvas、内存、滚动与导出证据。
- 当前主交付闭环是：导入图片 → 生成图案 → 可选去背景/编辑 → 导出可用图纸。
- 不为了形式统一重做用户已经满意的 UI。

## 7. 安全和权限

未经项目负责人当前对话明确授权，不执行：

- 删除重要文件、历史 refs、标签或外部备份
- `git push`、合并 `main`、重写 Git 历史
- 数据库迁移、凭据修改、全局安装
- Cloudflare、微信或其他生产发布
- 将私有图片、密钥、日志身份信息上传到第三方

发现疑似密钥时只报告文件和变量名，不输出值。发现远程 URL 可能包含 Token 时不要打印完整 URL。

## 8. Pull Request 交付模板

```markdown
## 修改内容

- 具体说明行为变化和涉及的平台。

## 原因

- 说明原问题、复现条件和根因。

## 验证

- `npm run ...`：通过/失败及数量
- 浏览器或微信开发者工具：检查了什么
- 真机：设备、系统、微信版本、输入和实际输出

## Git 检查点

- `<commit> <message>`

## 风险与未验证项

- 明确自动化没有覆盖的内容。
- 明确是否需要 Android、iOS、相册、分享或权限复核。
```

## 9. Agent 最终回复格式

最终回复先给结论，再给以下信息：

1. 做了什么
2. 为什么这样做
3. 修改了哪些关键文件
4. 跑了哪些验证以及结果
5. 创建了哪些 Git 提交
6. 仍有哪些风险或需要负责人决定的事项

不得用“应该可以”“理论上完成”替代实际验证。没有运行过的测试必须写成未验证。

## 10. 可直接转发给伙伴 Agent 的启动提示词

复制下面整段，将尖括号内容替换为本次任务：

```text
你现在参与 PinBean 项目的多人协作。

仓库地址：<仓库地址>
本次任务：<具体任务>
成功标准：<可观察、可测试的完成条件>
允许修改的主要范围：<目录或模块；不确定可写“由 Agent 检查后判断”>
是否允许推送任务分支：<允许/不允许>
是否允许生产部署：不允许，除非项目负责人在当前对话再次明确授权。

开始前必须读取根 AGENTS.md、README.md、CLAUDE.md、docs/AGENT_COLLABORATION_HANDOFF.md、docs/REFACTOR_STATUS.md、docs/UNIAPP_SWITCH_AUDIT.md 和相关测试。以当前代码与测试为准，不把旧路线图当成完成状态。

先检查 git status、当前分支、最近提交和已有改动。不要覆盖、清理、stash、reset 或提交他人的未完成工作。根目录是唯一 Git 仓库，只维护根 package-lock.json；不要在 apps 下创建子仓库或子锁文件。

跨 Web/小程序的生成、网格、编辑、去背景、统计、制作计划和进度逻辑应进入 packages/bead-core；平台图片读取、Canvas、下载、相册和分享放在对应 Adapter。旧原生实现只在 `v1` 分支中作为只读历史参考。

复杂任务先给简短计划，然后持续推进到成功标准满足。先复现或建立基线，修根因，运行最相关测试；准备交付前运行受影响 workspace 的完整检查，跨端改动运行 npm run check。视觉或平台问题要区分自动化、开发者工具 mock 和真实设备证据。

每个可独立验证和回退的阶段单独 commit。未经明确授权，不 git push、不直接合并 main、不强制推送、不生产部署、不修改凭据、不删除历史或备份。若遇到权限、产品冲突、无法安全合并的工作区改动或需要人工选择，停止并说明具体阻塞。

完成后按 docs/AGENT_COLLABORATION_HANDOFF.md 的 PR 模板汇报：修改内容、原因、验证结果、Git 提交、风险与未验证项。
```

## 11. 项目负责人给任务时应补充的信息

为了让伙伴 Agent 少猜，最好每次附上：

- 一个明确目标，例如“修复 Android 色卡图纸导出出现异常黑块”
- 一份可复现输入或最小测试数据
- 期望结果截图或原版本参考
- 允许修改的范围
- 是否允许安装依赖、推送分支或部署
- 哪些产品设计必须保留
- 最终需要的验收设备或平台

如果这些信息暂时没有，Agent 应先从仓库和现有证据中完成安全调查，再只询问会显著改变实现方向的问题。
