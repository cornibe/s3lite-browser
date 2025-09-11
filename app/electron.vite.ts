import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import optimizer from 'vite-plugin-optimizer'

export default defineConfig({
  plugins: [
    react(),
    optimizer({
      electron: () => ({ find: /^(electron)$/, code: 'export default require("electron")' })
    })
  ],
  build: { outDir: 'dist/renderer', sourcemap: true },
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV) }
})
