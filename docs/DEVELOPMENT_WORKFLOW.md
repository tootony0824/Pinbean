# 开发工作流（共享 Core + 平台 Adapter）

## 当前闭环

PinBean 当前以 `packages/bead-core` 为业务事实来源，`apps/miniapp-uni` 是微信/H5 主交付端，`apps/web` 是网页工作台与行为参考。旧原生小程序完整保留在 `v1` 分支，`main` 不携带旧版源码。

稳定闭环：

1. 选择/上传图片，由平台 Adapter 解码为 RGBA。
2. `bead-core` 根据 `GenerationConfig` 生成 Numeric `BeadGrid`。
3. 编辑、去背景、撤销/重做通过 Core `PatternSession` 事务执行。
4. 统计、备料、29×29 分板、制作评估和进度由 Core 派生。
5. Web/uni-app Adapter 只负责 Canvas、文件、相册、分享、剪贴板和平台存储。
6. 项目以 `.pinbean.json` 保存 Schema、算法版本、Palette 元数据、Grid、进度、用途和复盘侧车。

## 修改归属

- 结果相关生成、编辑、统计、项目解码、制作计划和进度规则：改 `packages/bead-core/` 并补测试。
- 色板映射、稳定 Color ID、供应商色号筛选：改 `packages/palette-data/`。
- Web 交互、浏览器 Canvas、下载、Focus 页面和兼容导入：改 `apps/web/`。
- 微信/H5 交互、uni Canvas、相册、分享、项目文件交付和移动端页面：改 `apps/miniapp-uni/`。
- 不把 `wx`、`uni`、DOM、Canvas 或 Node 文件 API 放入 Core。

## 验收入口

从仓库根目录执行：

```bash
npm run check:core
npm run check:palette
npm run test:web
npm run check:uni
npm run build:web
```

完整门禁：

```bash
npm run check
```

微信端验证：

```bash
npm run build:uni:mp-weixin
```

然后用微信开发者工具打开仓库根目录；根 `project.config.json` 指向 `apps/miniapp-uni/dist/build/mp-weixin/`。真机检查相册权限、实际保存、文件分享、触摸坐标、冷启动恢复和 80×80 性能时，必须明确记录设备、微信版本、基础库版本和输入图片。

## Golden 与算法变更

- 每个结果相关算法变更都必须考虑 `algorithmVersion`。
- Golden Fixtures 只能在有明确算法或产品决策时更新，并要说明变化原因。
- 不得删除测试、弱化断言或把平台 mock 结果写成真机结论。

## 旧版参考规则

`v1` 分支保存旧原生实现，仅用于查历史交互和微信 API 写法；它不进入 `main` 的 workspace、根测试或生产入口。需要恢复旧行为时使用 `git show v1:<path>` 或独立 worktree 阅读，再通过共享 Core/Adapter 在新版实现，不要把对象 Cell 模型迁回 Core。
