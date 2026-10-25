# Backend

The central Rust service of the project. It is the single authority for
everything that is not AI: it takes uploaded course material, prepares it for
question generation and runs the cooperative games.

## What happens here

- **Upload & ingestion** — receives documents for an island
  (`POST /upload?island_id=<uuid>`), stores them in S3 (RustFS), reacts to the
  storage webhook (`/events/rustfs`) and queues an OCR job.
- **OCR worker** — an Apalis worker on a Postgres job queue extracts the text
  of PDFs and images (xberg) and hands it to [Akasha](../akasha/) via gRPC.
- **REST API** (`/api`) — users, islands, memberships, forks and the houses
  with their unlocked storeys.
- **Game sessions** (`/api/sessions/ws`) — one actor per running game picks the
  questions, deals the glyphs, runs the clock, judges answers and counts
  strikes. Games are event-sourced in Postgres, so they survive reloads and
  restarts.
- **User channel** (`/api/users/ws`) — presence of island partners and game
  invites.

## Why it is needed

The clients only render what they are told. Keeping game rules, answer
checking and progress on the server makes games fair, keeps solutions out of
the browser and lets two players share one consistent game state. It also
decouples slow work (OCR, AI) from the user through a job queue.

## Run & test

```bash
nix run .#dev                      # full local stack incl. the backend
cargo test -p backend              # unit tests
cargo test -p backend -- --ignored # database/S3 tests (dev stack running)
```

Architecture details, invariants and conventions: [`AGENTS.md`](AGENTS.md).
Wire protocols: [`../schema/`](../schema/).
