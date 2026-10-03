import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// 最小手写 Vite 配置：/api 与 /uploads 代理到本地后端
// @api 别名：正常联调版指向 src/api.ts；preview 构建用 vite.preview.config.ts 覆盖指向 demoApi
const root = dirname(fileURLToPath(import.meta.url))
import { readFileSync } from 'node:fs'
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  resolve: {
    alias: { '@api': resolve(root, 'src/api.ts') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
