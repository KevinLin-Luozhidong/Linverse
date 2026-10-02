import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 最小手写 Vite 配置：/api 与 /uploads 代理到本地后端
export default defineConfig({
  plugins: [react()],
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
