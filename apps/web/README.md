# PinBean Web 工作台

`apps/web` 是 PinBean 的 Next.js Web 工作台与行为参考实现。当前 Web 只支持自有 Node 服务器部署：`next build` 生成动态服务端产物，生产环境通过 `next start` 或 PM2 运行，再由 Nginx/Caddy 反向代理到公网。

## 功能

- 图片上传、裁剪、像素化生成、相似色合并和自动去背景。
- 多供应商色号系统：MARD、COCO、漫漫、盼盼、咪小窝。
- 手动校对、单格上色、区域填充、橡皮擦、整色替换、撤销/重做。
- 图纸导出、CSV 兼容导入/导出、制作模式和完成打卡图。
- AI 图片优化：浏览器只调用 `/api/ai-optimize`；火山引擎 AK/SK 只存在于 Node 服务端环境变量。

## 本地开发

从仓库根目录执行：

```bash
npm ci
npm run dev:web
```

Web workspace 内部命令：

```bash
npm run typecheck --workspace=apps/web
npm test --workspace=apps/web
npm run build --workspace=apps/web
npm run start --workspace=apps/web
```

根目录门禁：

```bash
npm run check:web
```

## 生产部署

1. 在服务器拉取代码并安装依赖：

```bash
cd /srv/pinbean
npm ci
npm run build:core
npm run build:palette
npm run build:web
```

2. 配置服务端环境变量：

```bash
VOLC_ACCESS_KEY_ID=你的火山引擎 AccessKeyId
VOLC_SECRET_ACCESS_KEY=你的火山引擎 SecretAccessKey
AI_ALLOWED_ORIGINS=https://your-domain.example
NEXT_PUBLIC_OFFICIAL_DOMAIN=https://your-domain.example
NODE_ENV=production
PORT=3000
```

3. 单进程运行：

```bash
npm run start:web -- -p 3000
```

4. PM2 示例：

```js
module.exports = {
  apps: [{
    name: 'pinbean-web',
    cwd: '/srv/pinbean',
    script: 'npm',
    args: 'run start:web -- -p 3000',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: '3000'
    }
  }]
};
```

> AI job store、匿名会话签名 secret 和限流当前均为进程内实现，只支持单实例，重启后会话与任务失效。未来多实例必须共享任务状态、会话签名验证、执行协调和限流状态；网关限流不能替代 job 状态共享。本阶段不实现多实例。

## Nginx 反向代理

唯一维护的生产模板是 [`deploy/nginx.conf`](deploy/nginx.conf)，安全前提与 CDN 可信链要求见 [部署指南](docs/self-hosted-node-deployment.md)。生产启动默认绑定 `127.0.0.1`，Node 端口必须对公网封闭；代理覆盖地址头，不追加用户提供的 XFF。只有封闭代理验收后才能启用 `AI_PROXY_MODE=closed-proxy`，默认使用保守共享配额。

## AI API 协议

- `POST /api/ai-optimize`：提交图片和 prompt，返回 `202 { ok, data: { jobId, status }, requestId }`。
- `GET /api/ai-optimize?jobId=...`：轮询任务状态，返回 queued/running/succeeded/failed。
- 请求必须同源或匹配 `AI_ALLOWED_ORIGINS`，并携带 `X-PinBean-AI-Request: 1`。
- 成功 POST 签发 HttpOnly、SameSite=Strict 的匿名签名 cookie，生产使用 Secure；GET 验证 cookie 决定任务所有权，IP 只用于配额。
- 服务端限制 prompt、图片内容与体积、会话/IP 提交及活动任务、全局提交/并发/容量、请求体读取时间和任务绝对寿命；轮询合并与节流，具体限额见部署指南。
- 日志只记录 requestId、内部 jobId 前后状态和错误码，不记录 Base64、长期密钥或上游完整响应。

## PWA 状态

当前只保留 `public/manifest.json` 与图标资源；没有接入离线缓存生成器、Service Worker 或第三方分析 SDK。任何离线缓存、安装提示和分析能力都应作为独立功能重新设计和验证。
