import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// 预览版构建：单文件 HTML（JS/CSS 全内联），@api 指向本地演示数据层，不依赖后端
const root = dirname(fileURLToPath(import.meta.url))
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: { '@api': resolve(root, 'src/preview/demoApi.ts') },
  },
  build: {
    outDir: 'dist-preview',
    assetsInlineLimit: 100 * 1024 * 1024, // 资源全部内联
  },
})
