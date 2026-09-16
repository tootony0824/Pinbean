# PinBean uni-app

PinBean 的 Vue 3 + TypeScript 跨平台客户端，目标平台是 H5 与微信小程序。业务算法来自 `@pinbean/bead-core`，供应商色号来自 `@pinbean/palette-data`；本工程只实现平台输入、界面状态和 Renderer。

## 本地验证

从仓库根目录执行：

```bash
npm run check:uni
```

该命令依次构建共享核心、检查 Vue/TypeScript、执行 workspace 消费边界测试，并构建 H5 与 `mp-weixin`。

单独启动开发环境：

```bash
npm run dev:h5 --workspace=apps/miniapp-uni
npm run dev:mp-weixin --workspace=apps/miniapp-uni
```

微信构建产物位于 `apps/miniapp-uni/dist/build/mp-weixin`。基础工程阶段尚未替换根 `project.config.json` 指向的原生参考版；等图片生成闭环稳定后再切换默认开发者工具入口。

## 边界

- 不在 Vue、Pinia、`uni` 或 Canvas 中实现图案算法。
- `BeadGrid` 是图案事实源，Canvas 只负责显示和导出。
- Pinia 保存界面与会话状态；大网格不拆成响应式 Cell 对象。
- 只维护根 `package-lock.json`，本目录不创建子锁文件或 `.git`。
