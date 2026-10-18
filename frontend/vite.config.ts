import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// /api is proxied to the FastAPI service in development; in production the
// host routes /api to the backend, so no API URL is baked into the bundle.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { proxy: { '/api': { target: apiTarget, changeOrigin: true, ws: true }, '^/mcp(?:$|[/?])': { target: apiTarget, changeOrigin: true }, '/.well-known': { target: apiTarget, changeOrigin: true } } },
  preview: { proxy: { '/api': { target: apiTarget, changeOrigin: true, ws: true }, '^/mcp(?:$|[/?])': { target: apiTarget, changeOrigin: true }, '/.well-known': { target: apiTarget, changeOrigin: true } } },
})
