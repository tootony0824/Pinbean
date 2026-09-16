# Product Fixture Candidates

仓库根目录 `测试图片/` 中现有 5 张 `2048×2048` PNG 可作为第一批正方形图候选，但目前不能覆盖透明图、照片、长图、白色主体和复杂背景。

在把任何图片固化为 Golden Fixture 前，需要：

1. 确认图片为自有、授权或可安全用于仓库测试的素材。
2. 明确 `GenerationConfig`、Palette 与版本。
3. 分别记录当前 Web 和 Native 输出差异。
4. 人工批准 expected Grid、Statistics 与 Preview。
5. 记录批准日期和算法版本。

产品 Fixture 不应通过“直接采用当前 Web 输出”自动生成，否则会把 Reference Implementation 的缺陷固化成产品规格。
