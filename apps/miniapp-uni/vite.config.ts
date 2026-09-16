import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

const uniPlugin = typeof uni === 'function'
  ? uni
  : (uni as unknown as { default: typeof uni }).default

export default defineConfig({
  plugins: [uniPlugin()],
  build: {
    // 微信开发者工具关闭二次 ES6 转换，避免其 Babel 阶段破坏 uni-app
    // 的 CommonJS 模块；因此微信产物必须在这里完成真机兼容转换。
    target: 'es2018',
  },
})
