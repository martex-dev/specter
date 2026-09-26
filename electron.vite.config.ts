import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    // index: SPECTER's own UI. adblock / video: preloads for web pages (sandboxed, so each must stay a single file).
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts'), adblock: resolve(__dirname, 'src/preload/adblock.ts'), video: resolve(__dirname, 'src/preload/video.ts') }
      }
    }
  },
  renderer: {
    resolve: {
      alias: { '@shared': shared, '@renderer': resolve(__dirname, 'src/renderer/src') }
    },
    plugins: [
      react(),
      {
        // Vite's React refresh preamble is an inline script; allow it in dev only.
        name: 'specter-dev-csp',
        apply: 'serve',
        transformIndexHtml: (html: string) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      }
    ],
    build: { chunkSizeWarningLimit: 1500, minify: 'esbuild', cssMinify: true, target: 'chrome150' }
  }
})
