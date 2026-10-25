# Schema

The contracts between the parts of the project: JSON schemas and protocol
documentation that the backend, Akasha and the frontend all follow.

## What happens here

| File | Content |
|---|---|
| [`questions.schema.json`](questions.schema.json) | the question types (single/multiple choice, true/false, text/number input, matching, grouping, coords, order) as Akasha generates them |
| [`answer-submission.schema.json`](answer-submission.schema.json), [`answer-result.schema.json`](answer-result.schema.json) | the shape of an answer and of its judgement |
| `*.example.json` | examples for the schemas above |
| [`session-protocol.md`](session-protocol.md) | rules and messages of the game session websocket |
| [`session-client-message.schema.json`](session-client-message.schema.json), [`session-server-message.schema.json`](session-server-message.schema.json) | the session messages as JSON schemas |
| [`user-channel.md`](user-channel.md) | the websocket for presence and game invites |

## Why it is needed

The frontend, the backend and Akasha were developed in parallel by different
people. These files are the single source of truth for what is sent between
them, so every side can be built and tested against the same contract.

When a message or question type changes, update the Rust types
(`backend/src/session/protocol.rs`), the schemas here and
`frontend/src/api/types.ts` together.
