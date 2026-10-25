import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.API_PROXY_TARGET

  // `npm run cert` generates these; without them Vite keeps serving plain HTTP.
  const certDir = resolve(process.cwd(), 'certs')
  const keyFile = resolve(certDir, 'server.key')
  const certFile = resolve(certDir, 'server.crt')
  const https =
    existsSync(keyFile) && existsSync(certFile)
      ? { key: readFileSync(keyFile), cert: readFileSync(certFile) }
      : undefined

  return {
    plugins: [react()],
    server: {
      // Reachable from a phone on the same Wi-Fi.
      host: true,
      https,
      // Vite rejects unknown Host headers by default; mDNS/Bonjour names are fine here.
      allowedHosts: ['.local', '.fritz.box'],
      // Dev only: forward /backend/* to the backend (/backend/api/islands -> /api/islands,
      // /backend/upload -> /upload) so the browser never needs CORS. Set VITE_API_URL=/backend.
      proxy: proxyTarget
        ? {
            '/backend': {
              target: proxyTarget,
              changeOrigin: true,
              ws: true,
              rewrite: (path) => path.replace(/^\/backend/, ''),
            },
          }
        : undefined,
    },
  }
})
