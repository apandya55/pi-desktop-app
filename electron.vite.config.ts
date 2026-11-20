import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: 'electron/main.ts' } },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { input: 'electron/preload.ts', output: { format: 'cjs', entryFileNames: 'preload.cjs' } },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: { minify: true },
    plugins: [
      react(),
      tailwind(),
      {
        name: 'dev-content-security-policy',
        apply: 'serve',
        transformIndexHtml(html) {
          return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            .replace("connect-src 'self'", "connect-src 'self' ws:")
        },
      },
    ],
  },
})
