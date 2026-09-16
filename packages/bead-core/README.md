# @pinbean/bead-core

PinBean 的纯 TypeScript 拼豆核心。它接收规范化 RGBA、生成配置和版本化色板，输出确定性的 Numeric `BeadGrid`。

## 边界

本包不得依赖：

- `window`、`document`、DOM 或 Canvas
- `wx.*`、`uni.*`
- React、Vue、Pinia
- Node.js 文件、网络或进程 API

图片文件解码、EXIF、Canvas Renderer、触摸和文件保存属于应用 Adapter。

## 数据模型

```ts
interface BeadGrid {
  width: number
  height: number
  cells: Uint16Array
}
```

`0` 为 `EMPTY`；其他值是当前项目 `paletteTable` 的索引。`paletteTable[0]` 固定为空字符串，因此白色豆也是普通非零索引。

## 命令

```bash
npm ci --prefix ../..
npm run typecheck
npm test
npm run build
npm run check
```

依赖与锁文件统一由仓库根目录管理；也可以从根目录运行 `npm run check:core`。不要创建子包 `package-lock.json`。

完整 V1 行为定义见 [`../../docs/core-spec/BEAD_CORE_V1.md`](../../docs/core-spec/BEAD_CORE_V1.md)。
