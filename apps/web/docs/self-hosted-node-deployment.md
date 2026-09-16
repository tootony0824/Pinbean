# PinBean Web 自有 Node 服务器部署指南

本文是 `apps/web` 当前唯一维护的 Web 部署路径。旧 Pages/Workers、纯静态 Nginx、浏览器直连火山引擎密钥和第三方托管文档均已退役。

## 架构

- Next.js 运行在 Node.js 环境，使用 `npm run build:web` 构建，`npm run start:web` 启动。
- 浏览器端负责图片裁剪、生成参数、Canvas 预览、编辑和导出。
- `/api/ai-optimize` 是唯一 AI 服务端入口，使用 Node runtime 读取 `VOLC_ACCESS_KEY_ID` 和 `VOLC_SECRET_ACCESS_KEY`。
- AI API 使用异步 job 协议：POST 创建任务，GET 轮询状态；单个 HTTP 请求不会长时间 sleep 等待上游。
- 进程内 job store 和限流只适合单实例部署；未来多实例必须同时共享任务状态、会话签名验证、执行协调和限流状态，网关限流不能替代任务共享。本阶段不实现多实例。

## 环境要求

- Node.js 20 LTS 或更新的稳定 LTS。
- npm 使用仓库根目录的 `package-lock.json`，不要在 `apps/web` 内创建子锁文件。
- 生产服务器需要 HTTPS 终止层，例如 Nginx、Caddy 或云负载均衡。

## 构建

```bash
cd /srv/pinbean
npm ci
npm run build:core
npm run build:palette
npm run build:web
```

提交前建议运行：

```bash
npm run check:web
```

## 环境变量

```bash
NODE_ENV=production
PORT=3000
VOLC_ACCESS_KEY_ID=你的火山引擎 AccessKeyId
VOLC_SECRET_ACCESS_KEY=你的火山引擎 SecretAccessKey
AI_ALLOWED_ORIGINS=https://your-domain.example
NEXT_PUBLIC_OFFICIAL_DOMAIN=https://your-domain.example
```

说明：

- `VOLC_ACCESS_KEY_ID` / `VOLC_SECRET_ACCESS_KEY` 只在服务端读取，不能使用 `NEXT_PUBLIC_` 前缀。
- `AI_ALLOWED_ORIGINS` 为空时默认只允许当前站点同源请求；生产建议显式设置正式域名。
- `NEXT_PUBLIC_OFFICIAL_DOMAIN` 是可选前端变量，用于非正式域名访问时跳转到正式域名；修改后需要重新构建。

## 直接启动

```bash
npm run start:web -- -p 3000
```

## PM2 启动

`ecosystem.config.cjs` 示例：

```js
module.exports = {
  apps: [{
    name: 'pinbean-web',
    cwd: '/srv/pinbean',
    script: 'npm',
    args: 'run start:web -- -p 3000',
    exec_mode: 'fork',
    instances: 1,
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

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Nginx 反向代理

唯一维护的配置是 [`../deploy/nginx.conf`](../deploy/nginx.conf)，不再复制第二份模板。替换域名和 TLS 路径后，先执行 `nginx -t`，经部署审批才安装或 reload；本次仓库修改不代表已经上线。

- `start:web` 经 Web workspace 的启动脚本默认绑定 `127.0.0.1`，不要用 `-H 0.0.0.0` 覆盖。旧 `server.js` 仅用于本地自签名 HTTPS 调试，生产也绑定 loopback，不作为第二条部署路径。
- Node 3000 端口必须禁止公网访问：同时核验监听地址、主机防火墙、云安全组和容器端口映射。只有同机 Nginx 可以访问该端口；不能把 Origin 或自定义请求头检查当作身份认证或防火墙。
- 应用默认忽略所有转发地址头，使用共享 IP 配额。只有上述封闭条件均成立后才设置 `AI_PROXY_MODE=closed-proxy`。应用只接受 X-Forwarded-For 中一个合法 IPv4/IPv6，归一化后作为附加配额键；链、端口、zone id、非法值、缺失值均回到共享配额，不读取 X-Real-IP 作为备用身份。
- 模板用 `$remote_addr` **覆盖** X-Forwarded-For 和 X-Real-IP，清空 Forwarded；不可改成 `$proxy_add_x_forwarded_for`。
- CDN 场景不能直接相信 CDN 提交的任意链。必须只允许已确认 CDN 出口访问源站，在 Nginx 用明确、持续维护的 `set_real_ip_from` CIDR 和 CDN 官方来源头恢复地址，再覆盖传给 Node 的单一 IP。不得信任 `0.0.0.0/0`、`::/0` 或任意用户头；未经部署验证应保持默认共享配额模式。

## AI 会话与资源边界

- 成功 POST 自动签发随机匿名 cookie，GET 必须验证签名与有效期后按会话读取任务。同 IP 不共享任务所有权，同会话换 IP 仍可读取自己的任务。cookie 是 bearer 会话，应避免泄漏。无 cookie 的匿名客户端必须串行完成首次 POST 并保存响应 cookie 后再提交；并行首次 POST 会各自签发会话，浏览器最后写入的 cookie 可能使另一任务不可访问。现有 UI 是单任务提交，不增加登录 endpoint。
- cookie 使用 HttpOnly、SameSite=Strict、API 路径作用域和 24 小时有效期，生产额外 Secure，浏览器必须通过 HTTPS 访问。开发 HTTP 可用。无需新增持久化签名密钥：签名 secret 每个 Node 进程随机生成；重启后旧 cookie 与进程内任务均失效，用户重新提交即可。
- 保留单进程 fork 模式，禁止 PM2 cluster、多副本或滚动混跑。无账号系统，不保证跨进程恢复，也不引入 Redis。
- 会话与 IP 分别限额 8 次/分钟，全局提交 32 次/分钟（令牌桶，允许容量内突发）；会话/IP 最多 2 个活动任务，全局最多 16 个活动任务、128 个存储任务、8 个 provider 请求并发。新建 cookie 或轮换地址不能绕过全局限制。
- 限流桶最多 2048 个，5 分钟未使用后按请求清理；桶满时拒绝新键，不驱逐已有配额。任务从创建时刻起绝对 20 分钟截止，更新与轮询不延期，迟到结果不能复活任务；清理采用惰性执行。
- 同任务 provider 查询合并，完成后至少间隔 2 秒；provider 请求最多 30 秒并受任务剩余寿命约束，超时中止 fetch。请求体约 5.35 MiB 上限、15 秒读取截止，最多 8 个并行 POST 读取，Nginx 另设 6 MiB。限额不是计费保证，仍应在 provider 控制台配置预算/额度告警。
- API envelope 与页面调用参数保持不变，响应禁止缓存；失去 cookie 的旧任务返回与不存在任务相同的 404。


## AI 接口冒烟

本阶段只运行可控 stub，不调用真实 provider：

```bash
npm exec --workspace=apps/web -- tsx --test tests/aiOptimize*.test.mts
```

真实 provider 成功路径需单独授权，在 HTTPS 正式入口使用浏览器验证（自动保留 cookie）；命令行调用必须保存并回传 cookie，不能在生产 HTTP loopback 上验证 Secure cookie。旧 `test-api.js` 未适配签名 cookie，不作为本阶段验收命令。日志不得打印 AK/SK、Authorization、cookie、Base64 或上游完整响应。

## 验收清单

- `npm run check:web` 通过。
- `npm run build:web` 后 `npm run start:web -- -p 3000` 可启动。
- 浏览器可以上传图片、裁剪、生成、去背景、校对、导出和进入制作模式。
- AI 弹窗可以提交任务、轮询状态、取消、失败重试，成功后不会覆盖当前图纸直到用户确认使用结果。
- 生产日志中没有 Base64、长期密钥、完整上游响应或 provider task id。
