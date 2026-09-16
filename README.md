# PinBean · 拼豆图纸生成与制作管理

> 把一张图片，变成能直接开拼的拼豆图纸，并管好从选料、拼制到发布的全过程。以微信小程序为核心交付。

## 这是什么

PinBean 是一个面向拼豆（perler beads / 拼豆豆）爱好者的工具：上传图片 → 自动生成像素化拼豆图纸 → 给出制作所需的尺寸、颗数、颜色、分板、耗时与备料清单 → 一键生成小红书 / 抖音发布文案与封面。目标是把用户从「生成图纸」一路带到「买豆、分板、开拼、发布」，而不是停在出一张图。

## 解决的问题

市面拼豆软件的常见痛点：颜色识别不准、灰色毛边、无法合并相近色系、手动着色困难、没有采购清单、导出受限。PinBean 在优化这些的基础上，进一步补上了「制作管理」和「内容发布」两段常被忽略的环节。

## 核心功能

**制图**
- 图片上传、可调粒度像素化、相近色合并、多色号系统（MARD / COCO / 漫漫 / 盼盼 / 咪小窝）
- 自动去背景、手动着色 / 橡皮擦 / 颜色替换
- Web 专属交互：自定义生成调色板、放大镜、Focus 制作视图；不代表微信/H5 主客户端已有相同界面
- Web AI 图片优化：通过自有 Node API 代理调用火山引擎「即梦」，真实 provider 成功路径需独立账号验收；不是小程序本地制图的前置条件

**制作管理**（PinBean 的重点）
- 生成后自动评估：难度、图纸尺寸、颗数、用色、预计耗时、拼板数量
- 备料清单（按约 8% 损耗向上取整）、一键复制
- 29×29 标准板分板计划与推荐制作顺序
- 按色号 / 分板标记制作进度，本地保存，可复制制作进度与复盘文案

**发布**
- 一键生成发布文案（成品展示 / 制作教程 / 挑战记录三种模板）
- 生成 3:4 小红书封面图与发布包（标题 / 首图 / 正文 / 标签 / 发布前检查清单）

## 产品设计思路

PinBean 不只做「图片转像素格」，而是覆盖四段连续工作：**选题 → 制图 → 制作 → 发布**，让工具服务内容增长。每个新功能都必须能进入「生成图纸 → 制作 → 发布」的真实链路，而不是堆叠算法参数。完整设计见 [`docs/PINBEAN_SYSTEM_BLUEPRINT.md`](docs/PINBEAN_SYSTEM_BLUEPRINT.md)。

## 目录结构

- `apps/miniapp-uni/`：Vue 3 + TypeScript 的微信小程序/H5 客户端（当前主交付目标）
- `v1` 分支：保留已退役的原生微信小程序完整源码；`main` 不再携带旧版源码
- `apps/web/`：Next.js 网页工作台与交互参考；共享行为以 Core 契约、测试和批准的 Golden Fixtures 为准，不以 Web 差异自动定标准
- `packages/bead-core/`：跨平台图案生成、编辑、历史与项目核心
- `packages/palette-data/`：Web 与 uni-app 共用的供应商色号映射
- `color-palette/`：原始色板资料
- `docs/`：规划、对齐文档、系统蓝图
- `archive/`：历史备份与阶段性报告（不参与当前开发）

当前使用根 Git 仓库和 npm workspaces 统一管理。`packages/bead-core/` 已成为生成、数值网格、色板身份、编辑事务、撤销/重做、去背景、统计、项目序列化、备料、29×29 分板、制作评估和进度的共享事实来源。Web 和 uni-app 通过 Adapter 消费共享 Core；Canvas、文件、相册、分享和浏览器下载只作为平台能力。`apps/miniapp-uni/` 是当前微信/H5 主客户端，已经覆盖图片选择、共享 core 双模式生成、Canvas 预览、统计、画笔、橡皮、填充、整色替换、吸管、连续画笔、完整供应商色板补色、统一撤销/重做、去背景、最后一张图纸自动恢复，以及原版导出区的网格/纯净切换、详细设置、纯图纸、色卡图纸、备料清单、29×29 分板图纸、分板合集和 PinBean 项目文件导入导出。制作管理已经支持难度/耗时/板数评估、推荐制作顺序、按色号和分板标记进度、精确图案版本本地恢复、随项目文件迁移、复制制作计划与进度/完成复盘，以及只导出未完成分板；备料清单同步显示已完成与待拼状态。发布助手支持挂件/礼物/照片/大图用途预设、成品展示/制作教程/挑战记录三种文案、完整发布包和 1080×1440 的 3:4 发布封面；用途随项目文件保存。作品可以独立命名，名称统一进入项目文件、图纸、清单、分板与发布封面文件名；最近制作保留最多 8 个稳定项目记录，同一作品编辑后更新原记录而不重复。旧原生微信小程序完整保留在 `v1` 分支，`main` 不再携带旧版源码，也不再将其纳入根 workspace、根测试或生产入口。切换审计与微信平台待验证项见 [uni-app 微信入口切换审计](docs/UNIAPP_SWITCH_AUDIT.md)。原 Web/Native Git 历史和迁移恢复方式见 [monorepo 迁移记录](docs/MONOREPO_MIGRATION.md)。

## 技术栈

- uni-app + Vue 3 + TypeScript + Pinia（`apps/miniapp-uni/`，新客户端）
- `v1` 分支中的微信原生小程序（历史行为与平台参考，不存在于 `main` 工作树）
- Next.js + TypeScript + Tailwind CSS + Canvas API（`apps/web/` 网页版参考实现，图像像素化与颜色映射在浏览器端完成，AI 通过自有 Node 服务端 API 代理）
- 火山引擎「即梦」AI（图片优化）

## 运行

**小程序**
1. 在仓库根目录运行 `npm run build:mp-weixin --workspace=apps/miniapp-uni`
2. 用微信开发者工具打开仓库根目录（`project.config.json` 已指向 `apps/miniapp-uni/dist/build/mp-weixin/`）
3. 首页路径为 `pages/index/index`

**uni-app 新客户端**
```bash
npm run check:uni
npm run dev:h5 --workspace=apps/miniapp-uni
```

微信构建产物位于 `apps/miniapp-uni/dist/build/mp-weixin`，该目录由构建生成且不提交 Git。需要热更新时运行 `npm run dev:mp-weixin --workspace=apps/miniapp-uni`，并在开发者工具中改用对应的 `dist/dev/mp-weixin` 产物；提交前仍以 production build 验证。

**网页版**
```bash
npm ci
npm run dev:web
npm run check:web
npm run build:web
npm run start:web -- -p 3000
```

自有 Node 服务器部署见 [`apps/web/docs/self-hosted-node-deployment.md`](apps/web/docs/self-hosted-node-deployment.md)。

从仓库根目录执行验证（CI 固定 Node 24.13.0 / npm 11.4.2，满足锁文件中 Linux lzma 的 ^24.12、ESLint 10 的 >=24 与 Playwright >=20 约束）：

```bash
npm ci
npm test           # Core、palette、Web、uni 单测；uni 复用前序构建，不重复 pretest
npm run check      # 全仓类型、lint、测试、fixtures 与各端构建
npm run check:core # 单独检查 Core
npm run check:uni  # 单独检查 uni-app
npm run check:web  # 单独检查 Web
```

完整 H5 smoke（会启动浏览器，必须由负责浏览器验收的操作者运行）：

```bash
npm run check      # 或 build:core、build:palette、build:uni:h5 依次构建
node node_modules/playwright-core/cli.js install chromium # 已有 Chrome 可省略
npm run test:h5:full
```

完整 runner 使用临时生成的 50×50 不透明双色夹具，分别以 `cartoon`、`realistic` 执行编辑、导出、持久化、项目、进度、发布、最近制作和复盘全部八个 smoke 开关。默认在空闲 loopback 端口托管 `dist/build/h5`，结束时关闭服务；每种模式使用独立浏览器上下文，日志、PNG 和项目文件保存在输出所示的系统临时目录。设置 `PINBEAN_SMOKE_ARTIFACT_DIR` 可改产物目录，`PINBEAN_H5_URL` 可使用外部已启动服务（runner 不会关闭该服务）。完整模式固定夹具，不使用 `PINBEAN_SMOKE_IMAGE` 覆盖，以保持精确统计断言。

Chrome 查找支持 Windows 标准安装目录、Linux PATH、macOS Applications 和 Playwright Chromium 缓存；`CHROME_PATH` 优先且必须是可执行文件路径。例如 PowerShell 使用 `$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'`，bash 使用 `export CHROME_PATH='/usr/bin/google-chrome'`。单模式基础 smoke 使用 `npm run test:h5:smoke`，需自行提供 H5 服务；通过 `PINBEAN_SMOKE_MODE`、`PINBEAN_SMOKE_IMAGE` 调整模式与输入，完整业务分支的固定统计断言不适用于任意自选图片。

`.github/workflows/check.yml` 定义干净 `npm ci`、根 `check`、Chromium 安装与完整 H5 smoke，并保留七天产物，不配置真实 provider 凭据。新增 runner/CI 在本轮仅做静态检查，尚未作为新实现验收证据。H5 的真实浏览器下载不等于微信相册交付；`npm run test:wechat:smoke` 是包含平台 API mock 的业务链检查，`reLaunch` 不等于冷进程重启，真机 gate 见切换审计。

只维护根目录的 `package-lock.json`，不要在子目录重新创建锁文件。算法规则见 [Bead Core V1](docs/core-spec/BEAD_CORE_V1.md)。

## 项目经验与开发记录

- [experience.md](experience.md)：记录重构过程中已经验证的工程经验、踩坑和证据边界，包括共享 Core、Golden Fixtures、微信自动化、Android 兼容、导出设计、时间估算和 50 图回归。开始相近任务前先查这里，避免重复踩坑或把自动化结果写成真机结论。
- [记录.md](记录.md)：按大版本连续记录项目从 Git 保护、monorepo 整合、Web/Core 接入到 uni-app、真机和导出回归的完整演进。需要了解“当前方案为什么这样做”和历史检查点时从这里开始。

这两份文件都属于当前项目知识，不是归档材料。完成功能、修复重要问题或形成新的验证结论后，应随代码检查点同步更新。

## 多人 / 多 Agent 协作

伙伴或伙伴的 Agent 接手任务前，先阅读 [多 Agent 协作交接协议](docs/AGENT_COLLABORATION_HANDOFF.md)，并结合上面的 [experience.md](experience.md) 与 [记录.md](记录.md) 理解已有决策。协作协议固定了目录职责、Git 分支与提交规则、跨端逻辑归属、测试门禁、权限边界、PR 模板和一段可直接转发的 Agent 启动提示词。

## 来源与致谢

- 网页版参考实现与核心像素化算法基于开源项目 [Zippland/perler-beads](https://github.com/Zippland/perler-beads) 与 [liangdabiao/perler-beads-ai](https://github.com/liangdabiao/perler-beads-ai)（Apache 2.0）。
- 本仓库的原创工作：**微信小程序端实现**，以及 **PinBean 产品系统设计**——把单一的图纸生成扩展为「选题 → 制图 → 制作 → 发布」闭环，补齐制作评估、备料分板与内容发布层。
