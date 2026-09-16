# Bead Core V1 行为规格

`bead-core` 是 PinBean 图案业务事实来源。Web 与 `apps/miniapp-uni` 只负责图片解码、交互、Canvas/文件/相册/分享等平台能力；已退役的原生微信小程序完整保留在 `v1` 分支作为历史参考，不存在于 `main` 工作树。

## 确定性边界

以下输入完全相同时，输出 `BeadGrid` 必须完全相同：

- `NormalizedImage.width / height / rgba`
- `GenerationConfig`
- `Palette` 及其顺序和版本

不同平台从同一 JPEG、PNG 解码出的 RGBA 不保证逐字节一致；EXIF 旋转、ICC 色彩管理和平台解码差异属于 Image Adapter 的职责。

## Grid

- `cells` 使用行优先的 `Uint16Array`。
- `0` 表示 `EMPTY`。
- `1...N` 表示项目局部 `paletteTable[index - 1]` 对应的 stable Color ID。
- 生成完成后只保留实际使用的颜色，并按原 Palette 顺序压缩为项目局部 `paletteTable`。
- 编辑事务可在首次落笔时把完整供应商色板中的未使用 Color ID 加入局部图案；撤销/擦除后无用颜色会按 Palette 顺序确定性压缩。
- 白色豆是普通非零 palette index，不能用 Hex 判断空格。

## 网格尺寸

`targetGrid.axis = width` 是当前新生成默认语义：目标 size 表示横向格数，纵向按宽高比四舍五入。

`targetGrid.axis = long-side` 只作为旧数据兼容能力保留：目标 size 表示长边格数，短边按宽高比四舍五入。

所有维度最少为 1。

## 采样

- 当前算法使用 nearest-neighbor。
- 目标采样图尺寸为 `gridWidth × scale`、`gridHeight × scale`。
- 源坐标为 `floor(targetCoordinate × sourceSize / targetSize)`，并限制在源图边界内。
- 默认兼容参数为 `scale = 4`。
- Canvas 不参与核心 resize 或 sampling。

## Alpha

- 当 `alpha < alphaThreshold` 时跳过该像素。
- 当 `alpha >= alphaThreshold` 时，RGB 不按 Alpha 加权。
- Cell 没有任何有效像素时输出 `EMPTY`。
- 兼容阈值为 `128`。

## Cartoon

每个有效采样像素先以 RGB 欧氏距离映射到 palette index，再按 palette index 计数。计数严格大于当前最大值时才替换，因此平票时首见者胜。

`algorithmVersion = 2` 修复了旧实现中“采样过程中后见颜色可能在最终平票时胜出”的偏差；新生成使用 V2。已知 legacy `algorithmVersion = 1` 项目继续可读，但未知算法版本必须明确失败。

## Realistic

对有效采样像素分别计算 R/G/B 算术平均值，使用 `Math.round` 取整，然后以 RGB 欧氏距离映射到 palette index。

## Palette Mapping

- 使用 RGB 欧氏距离。
- 距离严格更小时替换候选。
- 等距离时 palette 中靠前的颜色胜出。
- Palette Color 的身份使用 stable `id`，`code` 仅用于显示，`hex/rgb` 是颜色属性。
- Web 与 uni-app 必须通过 `@pinbean/palette-data` 的公开 API 获取供应商 Palette，不能在运行时直接读取 raw JSON。

## Similarity Merge

- 统计非空 palette index 的频率。
- 频率高者优先；频率相同时按 Grid 首次出现顺序，再按 palette index。
- 当 `distance < threshold` 时，低频色并入高频色。
- 被合并的颜色不再作为高频候选继续合并其他颜色。
- 阈值来自 `GenerationConfig`，兼容默认值为 `48`。

## 版本

- `schemaVersion` 表示持久化格式版本。
- `algorithmVersion` 表示图片到网格的算法版本。
- `paletteVersion` 表示色板数据版本。
- 当前新生成算法版本为 `2`，已知旧算法版本 `1` 只用于读取兼容；算法 3 为显式候选生成分支，不改变默认版本。已知算法 1、2、3 可读取，未知算法必须拒绝。
- 遇到未知算法或 Schema 版本时必须明确失败，不能静默降级。

## Algorithm 3 area sampling candidate

Algorithm 3 is opt-in and requires `sampling.strategy = area`, `minimumCoverage` in `[0,1]`, and `averageColorSpace = srgb | linear`. It samples original RGBA pixels by exact source-area overlap for each target cell. Fully transparent pixels and pixels below `alphaThreshold` contribute nothing. Cartoon palette votes and realistic channel averages are weighted by overlap area multiplied by alpha; ties retain source encounter order. Cells below the effective-alpha coverage threshold are `EMPTY`. Generation validates cell, visit, comparison, image and palette budgets before reading pixels. V3 requires `colorDistance = rgb | oklab`; palette coordinates are precomputed. Linear averaging decodes sRGB before averaging and encodes/rounds back to bytes before mapping. Palette-distance ties retain palette order. V3 threshold merge uses the selected space (RGB byte units or unscaled OKLab distance); thresholds must not be reused across spaces.

Optional `maxColors` is a positive integer up to 65535 and is mutually exclusive with enabled threshold merge. It selects up to K used allowed-palette medoids by greedy minimum weighted squared distance, weighting each source color by the sum of `1 + number of unlike four-neighbors` over its cells. Candidates follow palette order; strict improvements win; final nearest assignment retains earlier selected candidates on ties. EMPTY never participates. This bounded heuristic favors boundary details but does not guarantee semantic eye/line preservation under small K. Budget includes `min(K, paletteSize) * paletteSize²` work. All fields survive clone, strict decode and project round trips; legacy configs reject V3 fields.

Structural cleanup is deferred and absent (effectively off): no isolated bead deletion, no unproven eye/line preservation claim. Both client services expose explicit V3 configuration; normal UI generation remains V2.


## PatternSession、Command 与 History

- Core 级 `PatternSession` 统一持有 `BeadPattern + Palette + PatternEditHistory + BeadStatistics`。
- 所有编辑使用 stable Color ID 表达变化：`{ index, beforeColorId, afterColorId }`。
- 支持 paint、erase、fill、replace、background-remove、undo、redo；selection-fill 属于 fill 的交互侧包装，不单独进入 Core 数据模型。
- Command 应用前必须验证目标格子的 `beforeColorId`；Undo/Redo 必须验证反向状态。陈旧命令必须整体失败，不能只应用一部分。
- Command 不直接修改输入 Grid，而是返回新的 `Uint16Array` Grid 与重算后的统计。
- 空操作不进入历史；执行新分支后清空 Redo；历史长度由显式 limit 控制。
- 历史基于 stable Color ID，而不是 numeric palette index；因此 paletteTable 压缩或重排后 Undo/Redo 仍能保持语义。
- 历史持有独立、不可变的 Command 快照；修改调用方命令或执行结果不得改变已记录的撤销/重做语义。

## Background Removal

- 忽略边缘 `EMPTY`，统计边缘非空 palette index。
- 出现次数最多的边缘色作为背景候选；平票时按固定边缘遍历顺序首见者胜。
- 只删除与边缘四向连通、且 palette index 与候选完全相同的 Cell。
- 封闭孔洞保留；白色只是普通 palette index。
- 当前版本不按颜色距离扩展渐变背景，渐变中只有精确命中的主背景色会删除。
- 结果必须以 `background-remove` Command 返回，因此可进入统一 Undo/Redo。

## BeadProject 与严格解码

- 运行时 Grid 保持 `Uint16Array`，持久化使用可读的 `number[]`。
- Project 明确保存 `schemaVersion`、palette 元数据、局部 palette table 和可选 `GenerationConfig`。
- 反序列化入口接收 `unknown`，逐字段验证 Schema、算法版本、palette metadata/table、cell 边界、mode、grid axis/size、sampling scale、merge threshold、alpha threshold。
- Schema V0 到 V1 的确定性迁移会用 `createdAt` 补齐 `updatedAt`。
- 未知 Schema、未知算法、越界 palette index 或 generation palette 漂移必须明确失败。
- 导入失败必须原子化，不能污染当前会话或当前图案。

## 项目交换外层格式

- `.pinbean.json` 外层 `formatVersion = 2` 与 Core `schemaVersion`、`algorithmVersion` 分开演进；本次不改变生成算法或 Golden 输出。
- 外层记录供应商标识和完整、有序的 `selectedColorIds`，不能由图纸实际用色反推生成选色。平台用 Palette Resolver 获取色板，Core 校验身份、版本、顺序和引用颜色；Core 不依赖供应商数据包。
- 已知外层 V1 可迁移；旧色板版本仅接受显式白名单，未知格式或色板版本必须拒绝。
- `progress`、`cellProgress`、`workflow`、`publishReview` 是跨端保留的业务元数据，不包含图片资产、Canvas 或页面状态。
- 缺少 generation 的合法 Project 保持来源未知；运行时编辑配置不得被重新导出为虚构的生成来源。

## Production Domain

- Core 提供平台无关的制作领域模型：备料清单、8% 余量、29×29 分板、分板颜色统计、制作耗时、难度评估、推荐制作顺序和制作进度。
- 制作进度使用按实际格子 stable Color ID 计算的内容 Hash；该 Hash 忽略未使用的 paletteTable 项，避免单纯选中未使用色破坏进度恢复。
- 旧 full paletteTable Hash 只保留为 legacy progress key 读取路径，新进度身份使用内容 Hash。客户端当前项目与进度应作为同一个权威记录保存，不再按每次编辑写入独立存储键。
- 逐格完成使用独立版本化的 cellProgress 侧车，按 projectId 和内容 Hash 校验整数格子索引；透明格不能标记完成。
- 整色完成可展开为该色全部格子；部分格子完成不能升级为整色完成。显式改变整色标记时同步该色逐格状态，未改变的颜色保留部分完成；分板完成保持独立语义。

## 暂不包含

- 图片文件解码、EXIF 和 ICC 处理
- Canvas Renderer
- Web、uni-app 或微信平台 API
- Worker
- 浏览器下载、相册保存、文件分享和剪贴板
