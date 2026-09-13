import { defineConfig } from 'vite'

export default defineConfig({
  server: { host: '127.0.0.1', port: 5410, strictPort: true },
  preview: { host: '127.0.0.1', port: 5419, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (asset) => asset.name?.endsWith('.css') ? 'assets/styles.css' : 'assets/[name][extname]',
      },
    },
  },
  test: {
    include: ['tests/core/**/*.test.js'],
    exclude: ['.worktrees/**', 'tests/e2e/**'],
  },
})
