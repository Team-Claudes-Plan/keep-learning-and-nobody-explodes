# Agent Guide

## Commands

Run Rust/Nix commands from the repository root.

- `nix run .#dev` — start the complete local backend stack (Postgres, RustFS, setup, webhook configuration, and the backend under `cargo watch`). Run it in its own terminal.
- `nix develop` — enter the backend development shell with the required environment and native libraries; `.envrc` uses this automatically through direnv.
- `cargo test --workspace` — run Rust tests, excluding ignored integration tests.
- `cargo test -p backend <test_name>` — run a focused backend test.
- With the dev stack running and inside `nix develop`: `cargo test -p backend -- --ignored` — run tests requiring Postgres/S3 and the dev environment variables (the upload and session end-to-end tests).
- `cargo test -p backend -- --ignored session:: api:: db:: presence` — the database tests that need only Postgres (no S3); this is what CI runs.
- `cargo fmt --all --check` then `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings` — match Rust CI (`.github/workflows/ci.yml`). Clippy treats the workspace's extensive warning set as errors.
- CI (`.github/workflows/ci.yml`) runs fmt, clippy, the unit tests, the database tests above and Akasha's against a Postgres service, and the frontend lint/build. The frontend e2e tests (`frontend/e2e/README.md`) are local only.
- `nix fmt` — format Nix files after changing the flake.

The frontend is a separate Bun package, not part of the Cargo workspace. From `frontend/`:

- `bun install`
- `bun run dev`
- `bun run build` — TypeScript project build/typecheck plus Vite production build.
- `bun run lint` — oxlint.
- `bun run e2e` — Playwright: two players play storey sessions against the real backend (started by Playwright with `cargo run -p backend`) and Postgres. See `frontend/e2e/README.md`.

## Architecture

- `backend/` contains the backend binary. One process runs the Axum HTTP server and the Apalis OCR worker; startup connects to Postgres, applies migrations (`backend/migrations/`, sqlx), and initializes the Postgres-backed job queue. Shared state is `GlobalState { db, sessions, presence }`, passed to the `/api` routes via `with_state`.
- Source layout (`backend/src/`):
  - `main.rs` — wiring and routes: `/`, `/health`, the upload router, the webhook router, `api::routes()`.
  - `config.rs` — env-based `Config`.
  - `db.rs` — the single `Database` wrapper around the sqlx pool: all SQL lives here (users, islands and members, documents/OCR status, topic progress, tasks, game persistence). Prefer adding a method here over inline queries elsewhere; only tests use the pool directly for seeding.
  - `knowledge.rs` — pure rules for how far a house is built (see "Islands and topics" below).
  - `presence/` — the user channel: an in-memory hub of who is online and the open game invites between island partners (`schema/user-channel.md`). No IO; `api/presence.rs` (`GET /api/users/ws`) checks memberships and games before it calls in.
  - `akasha.rs` — lazy gRPC client that hands OCR text to Akasha (`common/proto/akasha.proto`).
  - `upload/`, `webhook.rs`, `worker.rs` — ingestion (below).
  - `api/` — JSON/WebSocket API under `/api`: `user.rs` (`CurrentUser` extractor), `users.rs` (`PUT /api/users/create`), `presence.rs` (`GET /api/users/ws`, the user channel), `islands.rs` (`GET /api/islands`, `PUT /api/islands/create`, `PUT /api/islands/{id}/members`, `PUT /api/islands/{id}/fork`), `session.rs` (`GET /api/sessions` lobby list, `GET /api/sessions/ws` websocket), `error.rs` (`ApiError` → `{"message": ...}`).
  - `session/` — two-player game sessions (below). A storey game plays one skill (`create` with `skill_id`/`island_id`, tasks from `session/pick.rs`); a lobby game draws from whole topics, and `Database::pick_tasks` spreads its tasks over their skills.
- Islands and topics:
    - **island** = what the frontend shows as an island: a user creates it and uploads documents into it. It has one or two members (`island_members`; at most two, enforced in `Database::add_island_member` under a row lock).
    - **topic** = a house on an island: Akasha files every generated question under a topic of the island and creates topics as needed (`topics.island_id`, unique per island case-insensitively).
    - **skill** = a storey of a topic and the unit of knowledge. Tasks reference their skill (`tasks.skill_id`), the topic follows from `skills.topic_id`; skill names are unique per topic case-insensitively. The skills of a topic form its skill tree, ordered by `skills.position` (ground floor first; ties by `created_at, id`). A skill inserted without a position is appended by a trigger, so Akasha stores new skills in the order its classification names them (prompted from foundational to advanced).
    - **fork**: to learn with a third person, a member forks the island for themselves and that person (`islands.origin_id`, always the root). Documents and topics live on the root (`COALESCE(origin_id, id)`, see `Database::content_island`), so forks share houses and an upload to a fork is stored under the root.
    - Knowledge is per user and skill: a user passed a skill once they won a storey game on it (`games.skill_id`, status `won` × `game_players`). A house's level is the number of skills **every** member of the island passed, counted in a row from the ground floor (`knowledge::house_level`); unlocked are the passed storeys and the next one (`knowledge::skill_unlocked`), which `GET /api/islands` lists per house as `skills`. On a fork, exactly the storeys both partners already passed are built.
    - Identity: there is no authentication. `users` has UUID ids, and requests name their user in the `X-User-Id` header, or in `?user_id=` for the websocket. `CurrentUser` rejects unknown users with 401. Session player ids are user ids.
- Ingestion flow:
    - every document belongs to an island (`documents.island_id` is `NOT NULL`)
    - create one with `PUT /api/islands/create` (`{"name": ..., "partner_id"?: ...}` → `{"id": ...}`),
    - then `POST /upload?island_id=<uuid>` (multipart; `island_id` is required, malformed → 400, unknown → 404) writes objects to S3 as `uploads/<content island id>/<uuid>/<filename>`
    - RustFS sends an authenticated object-created webhook to `/events/rustfs`
    - the webhook reads the island from the key (`upload::island_of_key`)
    - registers the `documents` row (`mark_queued`), then enqueues OCR
    - the worker retrieves the object, extracts text, updates the row and sends the text with the island's id and name to Akasha (`ManifestTrials`). Akasha extracts questions grouped by topic (reusing existing topic names), then a classification step groups every topic's questions into skills (reusing existing skills and adding new ones), and writes `topics`, `skills`, `tasks` and `instructions` itself.
    - The key is the only carrier of the island: it is all the webhook gets from RustFS, so keep the `uploads/<island_id>/<uuid>/<filename>` layout, the `uploads/` prefix and the bucket/webhook-token assumptions when changing this flow.
    - Keys without an island (older `uploads/<uuid>/<file>` keys, or objects put into the bucket by hand, e.g. with `s5cmd`) are logged and skipped. A redelivered event is acknowledged with 204 (the queue's idempotency key rejects the second job); events for an island that no longer exists are skipped, so RustFS does not retry them forever. `OcrJob` deliberately does not carry the island, so jobs already in the queue keep decoding.
- Session flow (gameplay): the `session/` module is the authority for a game; clients only render what they are told. See `schema/session-protocol.md` for the wire protocol (rules, message tables, event list, examples) and keep it in sync with the code.
  - `protocol.rs` — serde wire types (`ClientMessage`, `ServerMessage`, `GameEvent`, `Answer`, `ErrorCode`, …). These are mirrored by `schema/session-client-message.schema.json`, `schema/session-server-message.schema.json` and `frontend/src/api/types.ts`; change all of them together.
  - `state.rs` — pure rules, no IO: `GameState::decide(Command) -> events` validates, `apply(event)` folds an event into the state. Live games and replays use the same code. Put rule changes here and unit-test them without a database.
  - `glyphs.rs` — deals the symbols that replace answer texts for the defuser (`assign`, once per game at `create`, stored in `game_created.parts[].glyphs`); no symbol is used twice in a game. `GLYPH_COUNT` must equal the number of drawings in `frontend/src/game/glyphs.ts`.
  - `judge.rs` — compares an `Answer` to `tasks.solution` (text trimmed/case-insensitive unless `caseSensitive`, multiple choice as a set, `coords` as `{ x, y, radius }` in percent; missing radius defaults to 5). Solutions may be raw or wrapped in `{"correct_answer": ...}`.
  - `actor.rs` — one Tokio task per running game. It handles one request at a time: decide → persist events to the DB → apply → broadcast (`broadcast::Sender<Outgoing>`, optionally targeted at one player, e.g. private briefings). Also owns the deadline timer and lingers briefly after the last disconnect.
  - `mod.rs` — `Sessions`: validates create requests (a storey must be unlocked and both players island members; `invited` makes a game private), picks the tasks, creates games, and finds or restores the actor of a game from the persisted event log (so games survive a restart).
  - `pick.rs` — pure task selection for a storey: tasks the players have not solved first (failed before unseen), then solved ones that rested `REPEAT_DELAY`, then the rest; repeats when the skill has fewer tasks than the bomb has parts (`game_parts` allows a task twice per game).
  - `api/session.rs` — websocket glue: the first message must be `create`/`join`/`resume` (handshake timeout), then `submit_answer`/`forfeit`; server pings; resync after lagged broadcasts. Per-message failures become `error` frames and keep the socket open.
- Event sourcing invariants: `game_events` (gapless `sequence` per game) is the source of truth; `games`, `game_parts`, `game_players` are projections or lookup tables. Events are written **before** they are broadcast. Adding an event type means: variant in `GameEvent`, `decide`/`apply` in `state.rs`, a migration extending the `game_events_event_type_check` constraint, both JSON schemas, `types.ts`, and `session-protocol.md`. Never edit existing migrations; add a new one (`0006_…`).
- Content schemas for questions/answers live in `schema/` (`questions.schema.json`, `answer-submission.schema.json`, `answer-result.schema.json`, plus examples). `tasks.content` holds the player-facing question data; the server strips legacy `id`/`type`/`correct_answer` fields before briefing. For `text_input`, `number_input` and `coords` the prompt may live in `instructions.instruction`. `tasks.solution` may be raw or wrapped in `{"correct_answer": ...}`; `session/task.rs` normalizes both forms.
- `common/proto/` contains protobuf sources (`akasha.proto`: backend → Akasha). `common/grpc/build.rs` compiles them at build time; edit the `.proto` files, not generated output, and wire new generated packages into `common/grpc/src/lib.rs`. `protoc` is required outside the Nix shell.
- `frontend/src/router.tsx` owns routes. Islands come from `GET /api/islands` via `frontend/src/api/client.ts` (or the in-memory mocks in `api/mockIslands.ts` without `VITE_API_URL`); `data/islands.ts` `resolveIsland` places each topic as a house, picking a design from `data/houses.ts` and a grid cell, and house routes use the topic id. `frontend/src/api/types.ts` mirrors the wire types of the islands API and the session protocol. With the Vite proxy, set `VITE_API_URL=/backend` (see `frontend/.env.example`).

## Conventions

- Rust code follows the [Pragmatic Rust Guidelines](https://microsoft.github.io/rust-guidelines/). "Must" guidelines always hold; "should" guidelines may be deviated from with a good reason. Where they conflict with the project's clippy configuration or existing code, clippy (`-D warnings`) wins.
- Commit messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `<type>[optional scope]: <description>`, with an optional body and footers. Use `feat` for new features and `fix` for bug fixes; other types (`docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`, `style`) are allowed. Mark breaking changes with `!` before the colon or a `BREAKING CHANGE:` footer. Prefer separate commits over mixing types in one commit.

## Testing

- Pure logic (`session/state.rs`, `session/judge.rs`, `session/pick.rs`, `presence/mod.rs`, `knowledge.rs`, `webhook.rs`) has plain unit tests; keep new rules testable at that level.
- Database/S3-dependent tests are `#[ignore]`d and need the dev stack (see Commands): `session/tests.rs` (drives `Sessions`, storey games and the websocket), `api/presence.rs` (the user channel over a websocket), `upload/tests.rs` (upload to S3 + island check), `webhook.rs` (`tests::database`: webhook → `documents` row), `api/users.rs` and `api/islands.rs` (membership, forks, house levels; they share `api::testing`). Akasha's `db.rs` has one for storing topics, skills and tasks. `tokio-tungstenite`/`tower` are dev-dependencies for transport-level tests.
- The upload endpoint is generic over the `UploadStore` trait (`content_island` + `put`); production uses `Uploader` (S3 + Postgres), offline tests use a recording store, so most upload tests need neither.
- SQL is written as runtime strings, so schema mismatches (such as a missing `NOT NULL` column) are not caught by the compiler or CI; cover new queries with an ignored DB test.
- New backend code gets tests (user rule); prefer extending the pure-state tests, and add an ignored DB test only for persistence/restore behavior.

## Environment and local state

- A plain `cargo run` is insufficient unless backend dependencies and environment are already configured. Required runtime variables are `DATABASE_URL`, `WEBHOOK_TOKEN`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `S3_BUCKET`; optional are `LISTEN_ADDR` (default `127.0.0.1:8081`), `MAX_UPLOAD_BYTES` (default 256 MiB) and `S3_REGION`. The Nix dev stack supplies development values.
- The Rust build needs native ONNX Runtime/libheif and build tools supplied by the Nix shell. Outside Nix, `ORT_LIB_PATH` and dynamic-link configuration may also be needed; prefer the flake environment rather than reconstructing it manually.
- Local Postgres data, RustFS objects, notification queues, and process logs live under `.data/`. Delete it only when intentionally resetting all local dev state. Logs are in `.data/logs/`.
