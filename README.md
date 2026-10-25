<p align="center">
  <img src="frontend/public/logo/logo-mark.svg" alt="Keep Learning and Nobody Explodes logo" width="160">
</p>

<h1 align="center">Keep Learning and Nobody Explodes</h1>

<p align="center"><em>Upload your course material — and defuse it together.</em></p>

## In short

**Keep Learning and Nobody Explodes** turns your own course material into a cooperative 3D bomb-defusal game: an AI pipeline reads uploaded documents and generates grounded questions, which two learners then have to answer together, one defusing the bomb and the other reading the manual, before the timer runs out. As you learn, your knowledge grows into houses on a shared floating island, one storey per mastered skill.

## Project description

Learning alone from slides and scripts is tedious, and classic quiz apps quickly become a solitary click-through. Our project brings two things together that rarely meet in education: **your own learning material** and **real cooperation under pressure**.

Inspired by *Keep Talking and Nobody Explodes*, every learning session is a two-player bomb-defusal game. One player is the **defuser**: they see the bomb and its modules (wires, fuse boxes, switches, combination locks, terminals, radars, …), but the possible answers are shown only as abstract symbols. The other player is the **expert**: they see the actual question and a page-turning manual that tells them which symbol stands for which answer. Only by explaining, discussing and agreeing can the pair cut the right wire. Roles swap after every module, so both learners have to understand the content. Three wrong answers or an expired timer, and the bomb goes off.

The questions are not written by hand. Learners create an **island** for their learning group and upload documents (PDFs, images, scans) to it. The backend runs OCR on every upload and hands the text to **Akasha**, our AI question architect. Akasha sorts the material into broad **topics** (houses, e.g. Robotik or Biologie), extracts questions that are strictly grounded in the source text, validates them, has them reviewed by a second AI step and finally arranges them into a **skill tree** of specific skills (storeys) from foundational to advanced.

Every topic appears on the island as a **house**, and every skill as one **storey** of that house. A storey is unlocked once all members of the island have passed the storey below it, so the house literally grows with the group's shared knowledge. Higher storeys bring bigger bombs with more modules. To learn with someone else, an island can be **forked**: the new pair shares the same houses but builds them up from their own progress.

The result is a learning environment in which progress becomes visible, repetition feels like play, and explaining something to your partner is the core mechanic, which is one of the most effective ways to learn.

## Features

- **Upload your own material**
  Upload PDFs and images to an island. The documents are stored in S3-compatible object storage, run through OCR and queued for question generation automatically.

- **AI-generated, source-grounded questions**
  Akasha generates questions of several types (single/multiple choice, true/false, text and number input, matching, grouping, ordering, image coordinates) and only from facts that are provably present in the uploaded material.

- **Topics, skills and skill trees**
  Questions are grouped into broad topics (houses) and specific skills
  (storeys). Existing topics and skills are reused when new documents are
  uploaded, so the knowledge base grows instead of fragmenting.

- **Cooperative bomb defusal**
  Eleven different 3D bomb modules map question types onto playful interactions: cutting wires, setting fuses, flipping switches, turning dials, connecting cables, entering codes on a lock or a terminal, and more.

- **Asymmetric roles with a manual**
  The defuser sees glyphs instead of answer texts; the expert sees the question and a page-turning manual. Every glyph is unique within a game, so the players have to communicate.

- **Living 3D island**
  Each learning group gets its own floating low-poly island with houses, river, streets, traffic, birds, animals and avatars. Offline partners fall asleep on the island.

- **Progress you can see**
  A house is built storey by storey as the whole group passes skills. Bomb size grows with every storey (4 modules on the ground floor, up to 8).

- **Presence and invites**
  A live user channel shows whether your partner is online and lets you invite them directly into a game.

- **Smart repetition**
  The server prefers questions neither player has solved yet, starts with previously failed ones and brings back solved questions only after a resting period.

- **Resilient sessions**
  Every game is event-sourced: a reloaded browser or a restarted server resumes the running game exactly where it was.

## Architecture

```
                 ┌───────────────────────────────────────────┐
                 │ Frontend (React, three.js, R3F)           │
                 │ Islands · Houses · Storeys · Bomb · Manual│
                 └──────┬───────────────┬─────────────┬──────┘
             HTTP upload│      REST /api│   WebSockets│(sessions, presence)
                        ▼               ▼             ▼
┌─────────┐ webhook ┌────────────────────────────────────────────┐
│ RustFS  │────────▶│ Backend (Rust, Axum)                       │
│  (S3)   │◀────────│ Upload · Islands · Sessions · Presence     │
└─────────┘ objects │ OCR worker (Apalis + xberg)                │
                    └──────┬─────────────────────────┬───────────┘
                           │ SQL                     │ gRPC (ManifestTrials)
                           ▼                         ▼
                    ┌──────────────┐  SQL   ┌───────────────────────────┐
                    │  PostgreSQL  │◀───────│ Akasha (Rust)             │
                    │ data · queue │        │ Extract → Schema → Review │
                    │ game events  │        │ → Skill  (LLM pipeline)   │
                    └──────────────┘        └─────────────┬─────────────┘
                                                          │ OpenAI-compatible API
                                                          ▼
                                                        LLM
```

### Ingestion flow

1. A learner creates an island and uploads a document (`POST /upload?island_id=…`).
2. The backend stores the file in RustFS under `uploads/<content-island>/<uuid>/<file>`; for a fork this is the origin island that owns the shared houses.
3. RustFS notifies the backend via an authenticated webhook; the backend registers the document and enqueues an OCR job in the Postgres-backed job queue.
4. The OCR worker extracts the text and sends it to Akasha via gRPC.
5. Akasha runs its agentic pipeline and writes topics, skills and tasks into PostgreSQL.

### Game flow

1. Both partners see each other's presence on the island and one invites the other into a storey.
2. The server picks the tasks of that skill, deals the glyphs, assigns roles and starts the clock.
3. Each turn, the defuser answers on the 3D module while the expert reads the briefing and manual.
4. The server judges every answer, counts strikes and broadcasts events to both clients.
5. A defused bomb passes the storey for both players and may unlock the next one.

The server is the single authority over every game: clients only render what they are told. All game events are persisted *before* they are broadcast, which makes games replayable and restart-proof. The wire protocol is documented in [`schema/session-protocol.md`](schema/session-protocol.md) and [`schema/user-channel.md`](schema/user-channel.md).

## Components

| Directory | Description |
|---|---|
| [`frontend/`](frontend/) | React 19 + TypeScript single-page app rendering the islands, houses, storeys and the bomb with three.js |
| [`backend/`](backend/) | Rust/Axum service: upload, S3 webhook, OCR worker, REST API, WebSocket sessions and presence |
| [`akasha/`](akasha/) | Rust gRPC service with the LLM pipeline that turns text into topics, skills and questions |
| [`common/`](common/) | Shared configuration crate and gRPC/protobuf definitions (`akasha.proto`) |
| [`schema/`](schema/) | JSON schemas for questions, answers and session messages, plus protocol documentation |
| [`flake.nix`](flake.nix) | Reproducible dev environment and one-command local stack |

## Technologies

**Frontend**
- React 19, TypeScript, Vite, React Router
- three.js with React Three Fiber and drei
- Blender (scripted low-poly models for houses, furniture and the bomb, exported as glTF)
- Bun, oxlint, Playwright

**Backend**
- Rust (edition 2024), Tokio, Axum (HTTP + WebSockets)
- sqlx with PostgreSQL migrations
- Apalis with a PostgreSQL job queue
- xberg for OCR and PDF text extraction
- AWS S3 SDK against RustFS

**AI service (Akasha)**
- Rust, tonic/prost (gRPC)
- async-openai against any OpenAI-compatible endpoint (`LLM_BASE_URL`, `LLM_MODEL`)
- JSON schema validation of all model output

**Infrastructure & tooling**
- PostgreSQL 18, RustFS (S3-compatible object storage)
- Nix flake with process-compose for the complete local stack
- GitHub Actions CI (rustfmt, strict clippy, unit and database tests, frontend lint and build)

## AI integration

### AI in the software

AI is at the heart of the product: it is what turns any learning material into a playable game. **Akasha** is a dedicated service that runs a step-based, self-correcting **agentic pipeline**:

1. **Extract** — The LLM reads the OCR text and generates questions grouped by broad topic (for example Robotik or Biologie). It follows an *evidence-first protocol*: before writing a question it has to locate a verbatim passage in the source that proves the answer. Questions without evidence must not be created. Existing broad topic names of the island are passed in and reused when they fit; specific techniques become skills in the classification step.
2. **Schema** — The output is validated statically and semantically against our question schema (types, index ranges, answer shapes, non-empty texts).
3. **Review** — A second LLM call acts as a quality gate. It rejects wrong or mixed languages, broken encodings, garbled tokens, placeholders, truncated text and markup in player-facing values.
4. **Skill** — A classification step groups each topic's questions into skills, reuses existing skills and orders new ones from foundational to advanced, which yields the storeys of each house.

Steps are not hard-wired into a straight line: every step can jump to any other step, and a failed step feeds a human-readable error back into the next attempt (for example, a schema violation sends the pipeline back to extraction with the exact problem). Error and transition limits keep the pipeline bounded. Akasha talks to any OpenAI-compatible API, so the model can be swapped between hosted and self-hosted LLMs via configuration.

Everything after generation is deliberately **deterministic and AI-free**: answers are judged by exact rules in the backend, which keeps the game fair, fast and cheap to run.

### AI in the development process

AI tools were part of our everyday workflow during the hackathon:

- **Coding agents** — We developed with AI coding assistants such as Claude Code. [`backend/AGENTS.md`](backend/AGENTS.md) is a living guide for agents that describes commands, architecture, invariants and conventions, so that agents and humans work by the same rules.
- **AI code review** — Pull requests were additionally reviewed by GitHub Copilot, and its findings were fixed before merging.
- **Asset generation** — [`frontend/HOUSE_TEXTURES.md`](frontend/HOUSE_TEXTURES.md) is a reusable brief for design and text-to-image agents that produce seamless PBR facade textures. The 3D models (houses, decor, bomb) are generated by Blender Python scripts in [`frontend/scripts/blender/`](frontend/scripts/blender/), which we wrote and iterated on with AI assistance.
- **Prompt engineering** — Akasha's prompts ([`akasha/src/pipeline/prompt/`](akasha/src/pipeline/prompt/)) are versioned alongside the code and were developed iteratively by testing them against real course material.
- **Guardrails** — To keep AI-assisted code maintainable, we rely on strict tooling: Conventional Commits, the Pragmatic Rust Guidelines, clippy with pedantic lints as errors, unit and database tests in CI, and Playwright end-to-end tests that play full two-player sessions.

## Getting started

Requirements: [Nix](https://nixos.org/) with flakes enabled (optionally direnv).

```bash
# Start Postgres, RustFS, setup/notifications, backend and Akasha in one dashboard
nix run .#dev

# In a second terminal: start the frontend
cd frontend
cp .env.example .env.local   # set VITE_API_URL=/backend for the dev proxy
bun install
bun run dev
```

Akasha needs an OpenAI-compatible LLM endpoint via `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`, plus the backend's Postgres database (`DATABASE_URL`); the dev stack supplies the database URL. Without `VITE_API_URL`, the frontend runs on in-memory mock data, which is handy for working on the 3D scenes alone.

### Tests

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace                 # unit tests
cargo test -p backend -- --ignored     # database/S3 tests (dev stack running)

cd frontend
bun run lint && bun run build
bun run e2e                            # two-player sessions against the real backend
```

More details are in [`backend/AGENTS.md`](backend/AGENTS.md), [`frontend/README.md`](frontend/README.md) and [`frontend/e2e/README.md`](frontend/e2e/README.md).

## Outlook

- Authentication and user accounts instead of the current user header
- Groups of more than two players and spectator mode
- Teacher view to curate, edit and approve generated questions
- Spaced-repetition statistics per learner and skill
- More bomb modules and question types, e.g. image-based questions from document figures

## Team

*Keep Learning and Nobody Explodes* was developed by **Team Claude's Plan**:

- David Maul
- Jonas Göbel
- Leon Bohnwagner
- Leon Lux
- Max Gerbeth
- Philipp Völler
- Ruben Otto
- Timo Triebensky

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
