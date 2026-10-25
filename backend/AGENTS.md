# Agent Guide

## Commands

Run Rust/Nix commands from the repository root.

- `nix run .#dev` — start the complete local backend stack (Postgres, RustFS, setup, webhook configuration, and the backend under `cargo watch`). Run it in its own terminal.
- `nix develop` — enter the backend development shell with the required environment and native libraries; `.envrc` uses this automatically through direnv.
- `cargo test --workspace` — run Rust tests, excluding ignored integration tests.
- `cargo test -p backend <test_name>` — run a focused backend test.
- With the dev stack running and inside `nix develop`: `cargo test -p backend -- --ignored` — run tests requiring Postgres/S3 and the dev environment variables (the upload and session end-to-end tests).
- `cargo fmt --all --check` then `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings` — match Rust CI (`.github/workflows/lint.yml`, which only lints; it does not run tests). Clippy treats the workspace's extensive warning set as errors.
- `nix fmt` — format Nix files after changing the flake.

The frontend is a separate Bun package, not part of the Cargo workspace. From `frontend/`:

- `bun install`
- `bun run dev`
- `bun run build` — TypeScript project build/typecheck plus Vite production build.
- `bun run lint` — oxlint; there is currently no frontend test script.

## Architecture

- `backend/` contains the backend binary. One process runs the Axum HTTP server and the Apalis OCR worker; startup connects to Postgres, applies migrations (`backend/migrations/`, sqlx), and initializes the Postgres-backed job queue. Shared state is `GlobalState { db, sessions }`, passed to the `/api` routes via `with_state`.
- Source layout (`backend/src/`):
  - `main.rs` — wiring and routes: `/`, `/health`, the upload router, the webhook router, `api::routes()`.
  - `config.rs` — env-based `Config`.
  - `db.rs` — the single `Database` wrapper around the sqlx pool: all SQL lives here (documents/OCR status, topics, tasks, game persistence). Prefer adding a method here over inline queries elsewhere; only tests use the pool directly for seeding.
  - `upload/`, `webhook.rs`, `worker.rs` — ingestion (below).
  - `api/` — JSON/WebSocket API under `/api`: `topics.rs` (`PUT /api/topics/create`, `GET /api/topics/list`), `session.rs` (`GET /api/sessions` lobby list, `GET /api/sessions/ws` websocket), `error.rs` (`ApiError` → `{"message": ...}`).
  - `session/` — two-player game sessions (below).
- Ingestion flow: `POST /upload` writes objects under `uploads/` in S3 → RustFS sends an authenticated object-created webhook to `/events/rustfs` → the webhook enqueues OCR → the worker retrieves the object, extracts text, and updates the `documents` table. Preserve the `uploads/` prefix and bucket/webhook-token assumptions when changing this flow.
- Session flow (gameplay): the `session/` module is the authority for a game; clients only render what they are told. See `schema/session-protocol.md` for the wire protocol (rules, message tables, event list, examples) and keep it in sync with the code.
  - `protocol.rs` — serde wire types (`ClientMessage`, `ServerMessage`, `GameEvent`, `Answer`, `ErrorCode`, …). These are mirrored by `schema/session-client-message.schema.json`, `schema/session-server-message.schema.json` and `frontend/src/api/types.ts`; change all of them together.
  - `state.rs` — pure rules, no IO: `GameState::decide(Command) -> events` validates, `apply(event)` folds an event into the state. Live games and replays use the same code. Put rule changes here and unit-test them without a database.
  - `judge.rs` — compares an `Answer` to `tasks.solution` (text trimmed/case-insensitive unless `caseSensitive`, multiple choice as a set, `coords` as `{ x, y, radius }` in percent).
  - `actor.rs` — one Tokio task per running game. It handles one request at a time: decide → persist events to the DB → apply → broadcast (`broadcast::Sender<Outgoing>`, optionally targeted at one player, e.g. private briefings). Also owns the deadline timer and lingers briefly after the last disconnect.
  - `mod.rs` — `Sessions`: validates create requests, picks tasks, creates games, and finds or restores the actor of a game from the persisted event log (so games survive a restart).
  - `api/session.rs` — websocket glue: the first message must be `create`/`join`/`resume` (handshake timeout), then `submit_answer`/`forfeit`; server pings; resync after lagged broadcasts. Per-message failures become `error` frames and keep the socket open.
- Event sourcing invariants: `game_events` (gapless `sequence` per game) is the source of truth; `games`, `game_parts`, `game_players` are projections or lookup tables. Events are written **before** they are broadcast. Adding an event type means: variant in `GameEvent`, `decide`/`apply` in `state.rs`, a migration extending the `game_events_event_type_check` constraint, both JSON schemas, `types.ts`, and `session-protocol.md`. Never edit existing migrations; add a new one (`0004_…`).
- Content schemas for questions/answers live in `schema/` (`questions.schema.json`, `answer-submission.schema.json`, `answer-result.schema.json`, plus examples). `tasks.content` is the question without `id`/`type` (the server adds them); `tasks.solution` has the shape of the answer value.
- `common/proto/` contains protobuf sources (currently only `helloworld.proto`). `common/grpc/build.rs` compiles them at build time; edit the `.proto` files, not generated output, and wire new generated packages into `common/grpc/src/lib.rs`. `protoc` is required outside the Nix shell.
- `frontend/src/router.tsx` owns routes. Most UI data still comes from the mock data and lookup helpers in `frontend/src/data/houses.ts`, which is the intended seam for replacing mocks with real data. `frontend/src/api/types.ts` holds the TypeScript types for the session protocol.

## Conventions

- Rust code follows the [Pragmatic Rust Guidelines](https://microsoft.github.io/rust-guidelines/). "Must" guidelines always hold; "should" guidelines may be deviated from with a good reason. Where they conflict with the project's clippy configuration or existing code, clippy (`-D warnings`) wins.
- Commit messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `<type>[optional scope]: <description>`, with an optional body and footers. Use `feat` for new features and `fix` for bug fixes; other types (`docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`, `style`) are allowed. Mark breaking changes with `!` before the colon or a `BREAKING CHANGE:` footer. Prefer separate commits over mixing types in one commit.

## Testing

- Pure logic (`session/state.rs`, `session/judge.rs`, `webhook.rs`) has plain unit tests; keep new rules testable at that level.
- Database/S3-dependent tests (`session/tests.rs`, `upload/tests.rs`) are `#[ignore]`d and need the dev stack (see Commands). They bypass the websocket and drive `Sessions` directly; `tokio-tungstenite`/`tower` are dev-dependencies for transport-level tests.
- New backend code gets tests (user rule); prefer extending the pure-state tests, and add an ignored DB test only for persistence/restore behavior.

## Environment and local state

- A plain `cargo run` is insufficient unless backend dependencies and environment are already configured. Required runtime variables are `DATABASE_URL`, `WEBHOOK_TOKEN`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `S3_BUCKET`; optional are `LISTEN_ADDR` (default `127.0.0.1:8081`), `MAX_UPLOAD_BYTES` (default 256 MiB) and `S3_REGION`. The Nix dev stack supplies development values.
- The Rust build needs native ONNX Runtime/libheif and build tools supplied by the Nix shell. Outside Nix, `ORT_LIB_PATH` and dynamic-link configuration may also be needed; prefer the flake environment rather than reconstructing it manually.
- Local Postgres data, RustFS objects, notification queues, and process logs live under `.data/`. Delete it only when intentionally resetting all local dev state. Logs are in `.data/logs/`.
