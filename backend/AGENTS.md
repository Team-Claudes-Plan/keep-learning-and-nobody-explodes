# Agent Guide

## Commands

Run Rust/Nix commands from the repository root.

- `nix run .#dev` — start the complete local backend stack (Postgres, RustFS, setup, webhook configuration, and the backend under `cargo watch`). Run it in its own terminal.
- `nix develop` — enter the backend development shell with the required environment and native libraries; `.envrc` uses this automatically through direnv.
- `cargo test --workspace` — run Rust tests, excluding ignored integration tests.
- `cargo test -p backend <test_name>` — run a focused backend test.
- With the dev stack running and inside `nix develop`: `cargo test -p backend -- --ignored` — run tests requiring S3/dev environment variables.
- `cargo fmt --all --check` then `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings` — match Rust CI. Clippy treats the workspace's extensive warning set as errors.
- `nix fmt` — format Nix files after changing the flake.

The frontend is a separate Bun package, not part of the Cargo workspace. From `frontend/`:

- `bun install`
- `bun run dev`
- `bun run build` — TypeScript project build/typecheck plus Vite production build.
- `bun run lint` — oxlint; there is currently no frontend test script.

## Architecture

- `backend/` contains the backend binary. Its process runs both the Axum HTTP server and the Apalis OCR worker; startup connects to Postgres, applies migrations, and initializes the Postgres-backed job queue.
- Ingestion flow: `POST /upload` writes objects under `uploads/` in S3 → RustFS sends an authenticated object-created webhook to `/events/rustfs` → the webhook enqueues OCR → the worker retrieves the object, extracts text, and updates the `documents` table. Preserve the `uploads/` prefix and bucket/webhook-token assumptions when changing this flow.
- `common/proto/` contains protobuf sources. `common/grpc/build.rs` compiles them at build time; edit the `.proto` files, not generated output, and wire new generated packages into `common/grpc/src/lib.rs`. `protoc` is required outside the Nix shell.
- `frontend/src/router.tsx` owns routes. UI data currently comes from the mock data and lookup helpers in `frontend/src/data/houses.ts`, which is the intended seam for replacing mocks with real data.

## Environment and local state

- A plain `cargo run` is insufficient unless backend dependencies and environment are already configured. Required runtime variables are `DATABASE_URL`, `WEBHOOK_TOKEN`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `S3_BUCKET`; the Nix dev stack supplies development values. Backend listens on `127.0.0.1:8081` by default.
- The Rust build needs native ONNX Runtime/libheif and build tools supplied by the Nix shell. Outside Nix, `ORT_LIB_PATH` and dynamic-link configuration may also be needed; prefer the flake environment rather than reconstructing it manually.
- Local Postgres data, RustFS objects, notification queues, and process logs live under `.data/`. Delete it only when intentionally resetting all local dev state. Logs are in `.data/logs/`.
