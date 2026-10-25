// Where the e2e backend runs and which database it uses; shared by the config and the seed.

export const BACKEND_ADDR = process.env.E2E_BACKEND_ADDR ?? '127.0.0.1:18081'
export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 5179)
export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/upload'
export const BACKEND_URL = `http://${BACKEND_ADDR}`
