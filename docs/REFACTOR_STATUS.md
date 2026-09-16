# 重构执行状态

最后更新：2026-09-16

## 2026-09-15—16 Web Pencil 腾讯云测试部署

- Web Pencil 输入提交 `edc18ed`、HTTP 项目编号兼容提交 `4cf6b9e`、编辑控件修复提交 `efbef12` 与颜色排除撤销提交 `65b04fc` 已部署到腾讯云南京 Ubuntu 24.04 单实例。Next.js 仅监听 `127.0.0.1:3000`，由 Nginx 提供公网入口；systemd 服务和证书自动续期均已启用。
- 公网 IP HTTP 完整冒烟通过：空存储上传、裁剪、轮廓/细腻双模式生成、稳定项目 ID、进入校对、刷新恢复，以及排除杂色撤销/重做、色块按住高亮、图纸缩放/复位、区域填充提示对比度、Pencil 连续涂擦、整笔撤销重做、笔手竞争、手指平移不改图，页面异常为 0。
- DNSPod 已增加 `tootonyzhou.top` 的 A 记录并生效。Let's Encrypt 证书签发和续期模拟均成功，服务器内部 HTTPS 返回 200；由于域名尚未完成中国大陆 ICP 备案，公网 HTTPS 握手被腾讯云未备案链路阻断，当前设备测试使用公网 IP 的 HTTP 入口。旧静态版本和切换前 Nginx 配置保留在服务器备份目录，可回退。
- AI provider 凭据未部署；图片本地生成与 Pencil 校对不依赖 AI。iPad Safari + Apple Pencil 的物理输入、延迟和系统手掌抑制仍需用户设备验收。

## 2026-09-10 Web Pencil 最小适配

- 在现有 Web 校对画布内使用 Pointer Events 区分笔、鼠标、手指；笔/鼠标连续涂擦，手指只平移，笔优先并阻塞未离开的触摸。画布移动保留至少一部分可见区域，避免拖出后找不到图纸。
- 复用 Core 通用命令实现一笔一次撤销、实时统计与持久化；坐标按平移后的显示边界计算，快速移动补齐经过格子。现有橡皮、区域工具、撤销重做继续使用；未修改小程序或生成算法，未接入 Pencil 笔身双击。
- Web 47 项单测、生产构建通过；Chrome 输入冒烟覆盖涂擦、整笔历史、笔手竞争、触摸平移与刷新恢复，页面异常为 0。复现入口：`apps/web/scripts/pencilSmoke.mjs`。
- 未验收：iPad Safari 与 Apple Pencil 真机触控、延迟及手掌表现。本轮没有重新执行完整上传裁剪、下载和 Focus 流程，旧自动测试中的双模式 Golden、编辑、项目兼容仍通过。

## 2026-09-08 算法阶段一至三

- Core 保留 V1/V2 读取和 V2 默认生成，新增显式 V3 候选配置：原始 RGBA 区域面积采样、alpha 加权 cartoon 投票与 realistic sRGB 平均、有效覆盖率阈值和预算前置校验。
- V3 配置已贯通 clone、严格解析、Pattern/Project 序列化及恢复；52 项 Core 测试通过，包含合成边界和 V2 回归。
- 后续代码已实现可配置 RGB/OKLab、sRGB/线性光平均、互斥最多 K 色边界加权贪心限色与完整配置往返。Web/Uni 服务层支持显式 V3；普通 UI 维持 V2。结构清理明确延后，不删除孤立豆。
- 最终 check:core、check:web、check:uni 均通过（含 Web 生产和 Uni H5/微信构建）；另新增 V3 跨端限定色板一致性测试通过。未使用浏览器，GUI/微信真机性能与视觉质量未验收。
- 离线脚本 `apps/web/scripts/compareGenerationQuality.mts` 复用五张 RGBA、双模式、七种配置共70组，产物 `docs/generation-quality-v3/report.json` 和 SVG。运行：`npm run build:core && npm exec --workspace=apps/web -- tsx scripts/compareGenerationQuality.mts I:/pinbean/docs/generation-quality-v3`。阈值固定0以隔离采样/配色，不替代旧 golden；旧 golden 保留。
- 对照平均源像素 OKLab 误差：V2 0.05749，V3 RGB 0.05290，OKLab/sRGB 0.05033，OKLab/linear 0.05061，K8/16/32 为0.05668/0.05175/0.05052。每项五次生成断言相同hash。并行构建期间测得耗时只作本机参考，不能作为真机预算结论；不据此切默认。


## 2026-09-07 可靠性收口

- Core 历史命令独立复制并冻结；外层项目格式 V2 保存完整有序选色，兼容已知 V1，生成算法、Golden 与 BeadProject schema 不变。workflow/review 和逐格进度侧车由 Core 校验，来源未知的项目不伪造生成记录。
- 微信导入以完整快照和主项目保存为事务边界；继续上次图纸只读恢复。当前项目内嵌进度为唯一持久化权威，旧独立键只读保留；内存最多缓存 32 个版本的整色与逐格进度。最近制作仍是最多 8 条摘要，不是多作品网格仓库。
- Web 接入标准项目导入导出及工作台/Focus 共用存储；部分完成以整数格子侧车保存，刷新恢复，撤销可恢复会话内缓存进度。旧缓存迁移失败保留原文。
- AI 任务所有权改为签名匿名会话，IP 仅限流；默认不信任转发头，封闭代理模式显式启用。任务、桶、并发、提交和轮询有界，生产默认 loopback，唯一 Nginx 模板覆盖来源头。
- 根测试包含 uni；新增固定 Node 24.13.0/npm 11.4.2 的 CI 及双模式完整 H5 smoke runner。CI 和完整 runner 本轮未执行，不能视为已验收。

本轮本地验证（基于 7e9a8e5 的未提交工作树）：根 `npm run check` 完整通过，Core 44、Palette 11、Web 42、uni 71 项测试通过，并完成类型/lint、Web production、H5 和微信生产构建。第一次完整检查发现 Next Link lint 错误，修复后重跑通过；最后仅修改 Focus 旧警告文案，再次 `npm run build:web` 通过。

浏览器证据：H5 首页加载；Web 使用共享 API 生成的 3×2、4 颗、两色、无 generation 项目作为本地存储夹具，刷新后恢复图纸并经真实按钮进入 Focus，手机尺寸 DOM 正确。该过程不是文件上传验收。内置浏览器不支持文件上传，Focus 截图两次返回 `browser screenshot activity capture failed for guest`，所以未完成逐格画布点击与刷新、完整导出和视觉验收。单测覆盖对应持久化与桥接规则，但不能替代上述浏览器和真机证据。

未执行：微信真机相册、分享、冷进程恢复及 Android/iOS 验收；真实 Nginx/CDN 链和公网端口封锁；真实或付费 provider。没有推送、部署、删除旧用户记录或更新依赖审计基线。

以下为 2026-09-06 迁移检查点记录；与上述本轮状态冲突时以上述内容为准。

## 当前结论

旧架构到新架构的核心迁移已完成：`packages/bead-core` 已成为生成、Numeric Grid、稳定 Color ID、编辑事务、撤销/重做、去背景、严格项目解码、统计、备料、29×29 分板、制作评估和进度的共享事实来源。`apps/miniapp-uni` 是当前微信/H5 主交付端，`apps/web` 是网页工作台与行为参考；旧原生微信小程序完整保留在 `v1` 分支，已从 `main` 工作树、workspace、根门禁和生产入口剔除。

## 本轮迁移完成项

- `bead-core`：新增 `algorithmVersion = 2`，修复 cartoon final vote 平票语义；新增严格 `unknown` 反序列化、`PatternSession`、stable Color ID 编辑历史、内容 Hash 和制作领域模型。
- `palette-data`：提供供应商 Palette 公开 API、stable Color ID 筛选和 runtime mapping 访问；应用源码不再直接读取 raw palette JSON。
- Web：编辑、去背景、颜色替换、撤销/重做、CSV 兼容导入和 Focus v2 存储收口到 Core Pattern/Session；CSV 不再通过白底合成图二次采样。当前 Web 使用动态 Next.js Node 构建，唯一 AI API 采用异步 job 协议，浏览器不接触 VolcEngine 长期密钥；已移除 Pages/Workers、静态导出和浏览器直连 signer。
- uni-app：Store 与编辑服务收口到 Core Session；完整色板未使用色改为“选中不改 Pattern、首次落笔进入 Pattern”；补相册权限恢复、连续画笔/橡皮、吸管和分板主色摘要。
- 原生版：`v1` 分支固定旧版最后一个提交并保留 `apps/miniapp-native-reference` 完整源码；`main` 删除旧版源码，根脚本和 workspace 门禁不再依赖旧原生包。
- 文档：根说明、开发指引、Core 规格、工作流和切换审计已按新事实源更新。

## 当前测试状态

最近已单独通过的门禁：

- Core：类型检查、lint、fixtures、测试和构建通过；新增 cartoon 平票、Pattern Session、内容 Hash、production domain、严格项目解码覆盖。
- Palette Data：共享色板 API、stable Color ID、选择集、五套供应商字段和非法输入测试通过。
- Web：`check:web` 已通过（Core/Palette 构建、Web typecheck、23 个 Web 测试和动态 Next production build）；生产 `next start` 已在本机 smoke 验证首页、CSRF 拒绝和缺失配置错误 envelope。AI signer、嵌套 provider response、risk/429/expired、输入上限、client job isolation、Focus 拖拽、CSV 限制、完成卡片 external 统计和相机 tracks cleanup 均有代码覆盖；当前仍需真实 provider 账号与浏览器端 AI 成功路径验收。
- uni-app：类型检查、Node tests、H5 构建、`mp-weixin` 构建和产物语法扫描通过；微信模拟器能力边界仍不冒充真机相册/分享结果。

本轮最终确认：根 `npm run check` 已通过；Web 已收敛为自有 Node/PM2 部署文档，已删除过时的 Pages/Workers、纯静态和旧浏览器 signer 实现；`docs/npm-audit-baseline-2026-09-06.json` 保存了审计基线（53 项，包含 DCloud/构建链间接依赖），没有执行 `audit fix --force`。

## 已知边界

- Android 真机曾确认语法修复、启动、图片选择、RGBA 解码、Core 生成、Canvas 写入和本地持久化；实际相册保存、文件分享、触摸坐标和 iOS 兼容仍是人工设备 gate。
- 原检查点仅覆盖 CSV 和 Focus v2；标准项目 UI 已在 2026-09-07 接入，完整文件上传/下载浏览器验收仍待完成。
- Web AI 进程内 job store/限流只适合单实例；多实例必须共享任务状态、签名会话、执行协调及限流，网关限流不能替代任务状态共享。生产账号、provider 真实结果和上游额度仍未在本地验证；PWA 当前只有 manifest/图标，不包含 Service Worker 或 Analytics。
- `apps/web/src/app/page.tsx` 与 `apps/miniapp-uni/src/pages/index/index.vue` 仍偏大，但本轮优先完成事实源、业务边界和平台 Adapter 收口，未做额外视觉重设计。
- 过程组合长图继续延后：当前 Project 不携带原图资产，也没有成品照片采集入口；现有分板合集覆盖制作总览，3:4 封面覆盖发布首图。

## 完成标准

1. 根 `npm run check` 已通过。
2. 引用扫描确认 live code/config 不再把旧原生包当 workspace、生产入口或根门禁依赖。
3. 最终迁移报告已记录行为保持项、算法版本变化、兼容格式、被放弃的旧交互、已执行测试和未执行的真机/账号 gate。

## 执行约束

- 不删除 `.git`、历史 refs、标签或外部恢复备份。
- 不执行 `git push`、生产发布或凭据变更。
- 用户原图、真机截图、批量导出结果和本地报告默认不进入 Git。
- 每项结果相关新增能力必须有自动测试；平台行为必须区分 mock、模拟器、H5、真机和人工验收。
