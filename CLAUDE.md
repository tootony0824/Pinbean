# PinBean 拼豆助手

## 项目定位

微信小程序 + 拼豆图纸生成与制作管理 → 小红书/抖音内容增长 → 小程序广告变现。

**核心理念**：工具必须稳定服务真实制作链路。AI 原图可以提升选题和美感，但拼豆图纸、备料、分板、进度和发布素材必须可验证、可恢复、可导出。

**第一用户**：开发者自己（做内容、引流量、验证什么主题值得继续投入）。

---

## 商业路径

### 两条腿走路

**短期（赚现金流）**

```text
稳定制图工具 → 自己创作拼豆内容 → 发小红书/抖音引流 → 广告变现
```

**长期（AI 生成）**

```text
收集/创作高质量豆图数据 → 训练 Stable Diffusion LoRA → 用提示词生成豆图原图 → 转成可制作图纸
```

两条路不冲突：边用工具做内容，边积累训练数据。

### 战略核心

> AI 生成豆图的质量 = 人工创作的质量。
> 人的工作 = 创造主题与审美选择，不是重复修图。

### 竞品对比

| 项目 | 方案 | 特点 |
|---|---|---|
| `perler-beads-ai` | 即梦 AI API + 转图纸 | 已验证 AI + 拼豆可行，依赖付费 API |
| `Zippland/perler-beads` | 纯算法 | 无 AI 美学，但说明工具有市场 |
| **PinBean** | 可制作图纸 + 制作管理 + 发布闭环 | 先做稳定工具与内容增长，再沉淀自训数据 |

---

## 当前产品方向

PinBean 不只做「图片转像素格」，而是覆盖四段连续工作：**选题 → 制图 → 制作 → 发布**。

### 保留主链路

- 上传/选择图片。
- 选择供应商品牌色板（MARD / COCO / 漫漫 / 盼盼 / 咪小窝）。
- 选择横向格数与卡通/写实模式。
- 生成 Numeric Grid 图纸。
- 可选去背景、画笔、橡皮、填充、替换、吸管和撤销/重做。
- 导出纯图纸、色卡图纸、备料清单、29×29 分板、分板合集和 `.pinbean.json` 项目文件。
- 记录制作进度、生成制作计划/复盘文案和 3:4 发布封面。

### 继续避免

- 不恢复内置裁剪；用户上传前用系统相册裁剪。
- 不向普通用户暴露复杂算法参数。
- 不把外部 AI API 凭据重新引入仓库。
- 不用他人小红书图片训练模型。
- 不用 mock、H5 或模拟器结果冒充真机相册/分享验收。

---

## 技术架构

### 活跃代码

- `packages/bead-core/`：跨平台业务事实来源，包含生成、Numeric Grid、稳定 Color ID、编辑事务、撤销/重做、去背景、统计、严格项目解码、内容 Hash、备料、29×29 分板、制作评估和进度。
- `packages/palette-data/`：供应商色板映射、stable Color ID、品牌 Palette API 和筛选 API。
- `apps/miniapp-uni/`：Vue 3 + TypeScript + Pinia 的微信/H5 主客户端。
- `apps/web/`：Next.js 网页工作台与行为参考。
- `v1` 分支：保留已退役原生微信小程序完整源码，只作历史行为与微信 API 参考；`main` 不携带旧版源码。

### 边界规则

- 新跨平台业务逻辑进入 `bead-core`。
- `bead-core` 不依赖 Vue、React、Pinia、`wx`、`uni`、DOM、Canvas、Node 文件 API 或平台存储 API。
- Canvas 是 Renderer，不是 Grid 事实源。
- 图片解码、相册、文件、剪贴板、分享和下载留在平台 Adapter。
- 颜色身份使用 stable Color ID；Hex/RGB 是颜色属性，色号 code 是展示字段。
- 所有结果相关参数属于 `GenerationConfig`；结果相关算法变更必须考虑 `algorithmVersion` 和 Golden Fixtures。

---

## 当前算法与数据模型

- Core Grid：`Uint16Array`，行优先，`0 = EMPTY`，`1...N = project paletteTable index`。
- Palette：供应商稳定 Color ID 作为身份；局部 `paletteTable` 只保存图案实际使用色。
- 生成：cartoon / realistic 双模式，RGB 欧氏距离映射，固定相似色合并语义。
- 版本：当前新生成 `algorithmVersion = 2`；V2 修复 cartoon final vote 平票时首见颜色胜出的语义。已知 legacy V1 可读，未知算法版本失败。
- 编辑：`PatternSession` 统一处理 paint、erase、fill、replace、background-remove、undo、redo。
- 进度：使用按实际格子 stable Color ID 计算的内容 Hash，忽略未使用 paletteTable 项；旧 Hash 仅作 legacy key 读取。
- 项目：`.pinbean.json` 严格反序列化，导入失败不能污染当前会话。

---

## 数据策略

### 为什么重要

- AI 生成豆图需要高质量训练数据。
- 训练数据应来自自己的创作、授权素材、CC0/公有领域素材或合法可用素材。
- 自创数据过程本身也是在验证什么样的豆图主题能传播。

### 数量目标

100–200 张起步。

### 格式建议

```text
图片：高清豆图/可转拼豆原图，主体清晰、对称、背景少、颜色可控
标签：perler bead, character, symmetrical, simple pattern, pink background
项目：保留 .pinbean.json、导出图纸、成品图、发布数据和复盘字段
```

### 来源边界

- ✅ 自己创作。
- ✅ 找创作者谈授权。
- ✅ CC0/公有领域素材站补充。
- ❌ 不用别人小红书图片训练。
- ❌ 不用爬虫抓图建立灰色数据集。

---

## 开发优先级

| 优先级 | 任务 | 状态 |
|---|---|---|
| P0 | 旧架构收口到共享 Core + uni-app 主端 | 收尾验证中 |
| P0 | 根 `npm run check` 与 stale reference 扫描 | 本轮最终门禁 |
| P1 | 真机相册保存、文件分享、触摸坐标、80×80 性能复核 | 人工设备 gate |
| P1 | Web 标准 `.pinbean.json` 项目 UI 完整导入导出 | 后续 Web 体验增强 |
| P2 | 过程组合长图 | 等源图/成品素材生命周期明确后再做 |
| P2 | AI 原图生成与 LoRA 数据闭环 | 内容验证后推进 |

---

## 验证命令

从仓库根目录运行：

```bash
npm ci
npm run check:core
npm run check:palette
npm run test:web
npm run check:uni
npm run build:web
npm run check
```

微信构建：

```bash
npm run build:uni:mp-weixin
```

用微信开发者工具打开仓库根目录；根 `project.config.json` 指向 `apps/miniapp-uni/dist/build/mp-weixin/`。

---

## 参考资料

- 竞品：[liangdabiao/perler-beads-ai](https://github.com/liangdabiao/perler-beads-ai) - AI + 拼豆。
- 竞品：[Zippland/perler-beads](https://github.com/Zippland/perler-beads) - 纯算法。
- 当前系统蓝图：`docs/PINBEAN_SYSTEM_BLUEPRINT.md`。
- Core 行为规格：`docs/core-spec/BEAD_CORE_V1.md`。
- 迁移状态：`docs/REFACTOR_STATUS.md`。
- uni-app 切换审计：`docs/UNIAPP_SWITCH_AUDIT.md`。
