import { defineConfig } from 'vite'

export default defineConfig({
  server: { host: '127.0.0.1', port: 5410, strictPort: true },
  preview: { host: '127.0.0.1', port: 5419, strictPort: true },
})
