import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { readFileSync } from 'node:fs'
import { llmProxyPlugin } from './server/llmProxy'

const packageVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

// https://vite.dev/config/
export default defineConfig({
  base: '/brick-flow-agent/',
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
  },
  plugins: [react(), llmProxyPlugin()],
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor'
          if (id.includes('/lucide-react/')) return 'icons-vendor'
          return undefined
        },
      },
    },
  },
})
