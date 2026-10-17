import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001' } },
  preview: { proxy: { '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001' } },
  build: { rollupOptions: { output: { manualChunks: { motion: ['motion'], ui: ['radix-ui'] } } } },
})
