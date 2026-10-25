# Akasha

The AI service of the project. Akasha turns the plain text of uploaded course
material into playable content: topics (houses), skills (storeys) and
questions with their solutions.

## What happens here

The backend calls `ManifestTrials` via gRPC
([`akasha.proto`](../common/proto/akasha.proto)) with the OCR text of a
document. Akasha queues the request and runs an agentic LLM pipeline
([`src/pipeline/`](src/pipeline/)):

1. **Extract** — the LLM writes questions grouped by topic, each one grounded
   in a verbatim passage of the source (evidence-first protocol). Existing
   topics of the island are reused.
2. **Schema** — static and semantic validation against the question schema.
3. **Review** — a second LLM call rejects wrong languages, broken encodings,
   placeholders and garbled text.
4. **Skill** — groups the questions of every topic into skills and orders new
   skills from foundational to advanced (the skill tree).

A failed step feeds its error back into a retry, bounded by error and
transition limits. The results are written directly into Postgres (`topics`,
`skills`, `tasks`, `instructions`). The prompts live in
[`src/pipeline/prompt/`](src/pipeline/prompt/).

## Why it is needed

Without Akasha every question would have to be written by hand. It lets
learners bring any material and play it immediately. Running it as a separate
service keeps the slow, failure-prone LLM work away from the game server and
makes the model exchangeable.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | — | any OpenAI-compatible endpoint |
| `ADDRESS` | `0.0.0.0:50051` | gRPC listen address |
| `CONCURRENCY` | `8` | parallel pipeline runs |
| `PIPELINE_MAX_QUESTIONS` | `10` | questions per document |
| `PIPELINE_MAX_STEP_ERRORS`, `PIPELINE_MAX_TRANSITIONS` | `3`, `100` | retry limits |

`nix run .#dev` starts Akasha together with the rest of the stack; on its own:
`cargo run -p akasha`.
