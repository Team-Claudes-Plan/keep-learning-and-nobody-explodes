import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.API_PROXY_TARGET

  return {
    plugins: [react()],
    server: {
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
