import { defineConfig, devices } from '@playwright/test'
import { BACKEND_ADDR as BACKEND, DATABASE_URL, FRONTEND_PORT } from './e2e/env'

// End-to-end tests of a full two-player session: the real backend (cargo run) on Postgres, the
// Vite dev server proxying to it, two browser contexts as the two island partners. Every test seeds
// its own users and island, so the database needs no reset; see e2e/README.md.

function withoutLibraryPath(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[0] !== 'LD_LIBRARY_PATH' && entry[1] !== undefined),
  )
}

export default defineConfig({
  testDir: './e2e',
  // Two WebGL pages per test are heavy enough; run one test at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // NixOS cannot run Playwright's downloaded browsers; point this at a system Chromium. The
          // dev shell's library path (for the backend's native libraries) would break it, so it is
          // left out for the browser.
          executablePath: process.env.E2E_CHROMIUM || undefined,
          env: process.env.E2E_CHROMIUM ? withoutLibraryPath() : undefined,
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'cargo run -p backend',
      cwd: '..',
      url: `http://${BACKEND}/health`,
      // the first run compiles the backend
      timeout: 900_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      env: {
        DATABASE_URL,
        LISTEN_ADDR: BACKEND,
        WEBHOOK_TOKEN: 'e2e-webhook-token',
        // uploads are not part of the tests; the S3 client connects lazily
        S3_ENDPOINT: 'http://127.0.0.1:9',
        S3_ACCESS_KEY: 'e2e',
        S3_SECRET_KEY: 'e2e',
        S3_BUCKET: 'e2e',
        RUST_LOG: 'info',
      },
    },
    {
      command: `bunx vite --port ${FRONTEND_PORT} --strictPort`,
      url: `http://localhost:${FRONTEND_PORT}`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_API_URL: '/backend',
        API_PROXY_TARGET: `http://${BACKEND}`,
        VITE_E2E: 'true',
      },
    },
  ],
})
