# 真实图片回归样例

这 5 张 PNG 是从用户授权使用的本地测试图片中选取并缩放得到的固定测试输入：

- `line-art.png`：黑白线稿，覆盖高对比边缘。
- `cartoon.png`：大色块卡通图，覆盖 dominant 投票。
- `landscape.png`：连续色调风景图，覆盖 average 与相似色合并。
- `portrait.png`：连续肤色与深色头发的人像，覆盖照片细节和大范围明暗过渡。
- `tall-pattern.png`：164×192 的纵向成品图纸，覆盖非正方形输入和纵向 Grid 尺寸。

生成命令使用 macOS 自带 `sips -Z 192 -s format png`，保持原图宽高比。PNG 用于人工查看；对应的 `.rgba.gz` 是预解码后的 RGBA 输入，尺寸在测试清单中显式声明，自动测试使用 Node 内置 `zlib` 解压，不引入图片解码依赖。测试不依赖用户目录，也不会因 JPG/PNG 解码器差异改变输入像素。

`expected/` 为每张图的 dominant/average 场景保存完整 Numeric Grid、palette table、统计与 hash，并保存由 Grid 直接生成的预览 PNG。更新预期时运行根目录 `npm run fixtures:update`，检查 JSON 和预览差异后再提交，不能为了让测试通过而盲目接受新基线。
