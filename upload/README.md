# Ingestion service

Rust backend that ingests course material (PDFs, images, …), stores objects in an
S3-compatible store, and enqueues OCR jobs for workers in Postgres.

## Stack

| Piece       | What                                        | Local endpoint |
|-------------|---------------------------------------------|----------------|
| `ingestion` | Rust backend (crane build)                  | –              |
| RustFS      | S3-compatible object storage                | `:9000` (console `:9001`) |
| Postgres 18 | OCR worker job queue                        | `:5432`        |

All dev state lives in gitignored `.data/`. delete to reset Postgres/RustFS.

## Prerequisites

- [Nix](https://nixos.org/download) with flakes enabled
- Optional: [direnv](https://direnv.net) (`use flake` in `.envrc`)

## Usage

```bash
nix run .#dev
```

This opens the process-compose TUI. Key bindings: arrow keys to select a process,
`l` for logs, `s`/`T` to stop/start a process, `F9` to quit (shuts everything
down in reverse dependency order).

After it's up, use the services like this:

```bash
nix develop                      # shell with cargo, psql, s5cmd, rustfs CLI
psql "$DATABASE_URL" -c '\l'     # job-queue database
s5cmd --endpoint-url "$S3_ENDPOINT" ls
```

Connect an S3 client (aws cli, MC, the AWS SDK) with:

- endpoint: `http://localhost:9000` (path-style)
- access/secret key: `devadmin` / `devadmin-secret`
- bucket: `course-materials`

## Building the backend

```bash
nix build        # -> result/bin/ingestion
result/bin/ingestion
```
