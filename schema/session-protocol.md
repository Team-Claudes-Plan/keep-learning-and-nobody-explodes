# Session protocol

Two players defuse one bomb together over a websocket. The server has the
authority: it picks the questions, runs the timer, checks answers and counts
strikes. Clients only render what they are told.

- Endpoint: `GET /api/sessions/ws` (websocket), lobby list: `GET /api/sessions`
- Every message is a JSON text frame with a `type` field.
- Schemas: [`session-client-message.schema.json`](session-client-message.schema.json),
  [`session-server-message.schema.json`](session-server-message.schema.json)
- Implementation: `backend/src/session/` (rules in `state.rs`, wire types in `protocol.rs`)

## Rules

- A bomb has `question_count` parts (1–11). **Turn n** plays part n.
- Each turn one player is the **defuser** (sees the module, answers) and the
  other is the **expert** (sees the prompt and the manual page). **Roles swap
  after every turn.**
- Starting role: if the creator picked a `role`, the joiner gets the other one.
  If only the joiner picked one, theirs counts. If nobody picked, it is random.
- A wrong answer is a strike and the part counts as failed. Either way the next
  turn starts.
- **Lost** at 3 strikes or when the deadline (`time_limit_secs` after the
  start, default 300) passes. **Won** once all parts are resolved.
  **Aborted** when a player sends `forfeit`.

```
waiting ──join──▶ active ──┬─ all parts resolved ──▶ won
   │                       ├─ 3 strikes / deadline ─▶ lost
   └──────forfeit──────────┴─ forfeit ──────────────▶ aborted
```

## Connecting

The first message decides how the socket enters a game:

| message | effect |
|---|---|
| `create` | opens a lobby; you take seat 0 |
| `join` | takes seat 1 of a waiting game and starts it |
| `resume` | reconnects with the `token` from `welcome` |

`create`/`join` answer with `welcome { game_id, player_id, token, seat }`.
**Store the token** (e.g. localStorage): it is the only way back into the game.

Then the server sends the current state:

- without `last_sequence`: one `snapshot`
- `resume` with `last_sequence`: every `event` after that sequence, no snapshot

followed by your `briefing` if a turn is running. After that, everything is
pushed live.

## Client → server

| type | fields | when |
|---|---|---|
| `create` | `topics: uuid[]`, `question_count`, `role?`, `time_limit_secs?` (30–3600) | first message |
| `join` | `game_id`, `role?` | first message, game `waiting` |
| `resume` | `game_id`, `token`, `last_sequence?` | first message |
| `submit_answer` | `turn`, `answer: { type, answer }` | your turn as defuser |
| `forfeit` | – | game not over |

`answer` is the `AnswerSubmission` from
[`answer-submission.schema.json`](answer-submission.schema.json). A
`questionId` in it is ignored; `turn` names the question. Because of `turn`, a
resent answer is rejected with `stale_turn` and never costs a second strike.

## Server → client

| type | content |
|---|---|
| `welcome` | `game_id, player_id, token, seat` |
| `snapshot` | `state`: status, players (+ online), deadline, turn, defuser, expert, strikes, parts with results, `last_sequence` |
| `event` | `sequence, at, event`: one logged game event, see below |
| `briefing` | private, per turn: `{ turn, role: "defuser", task }` or `{ turn, role: "expert", question_type, prompt, instruction }` |
| `presence` | `player_id, online` |
| `error` | `code, message`: answers a single message, the connection stays open |

The defuser's `task` is the question as in
[`questions.schema.json`](questions.schema.json) **without `prompt`**, enough
to render the module. The expert gets the `prompt` and the manual page
(`instructions.instruction`). That way the players have to talk.

Error codes: `bad_message`, `unknown_game`, `game_full`, `invalid_token`,
`not_your_turn`, `stale_turn`, `invalid_state`, `no_tasks`, `internal`.

## Events

Events are the source of truth. They are stored in `game_events`
(`event_type` + `payload`) with a gapless, increasing `sequence` per game. The
game state is the fold of its events, which is how a game is restored after a
server restart. Clients should ignore events with
`sequence <= last seen sequence`.

| event | payload |
|---|---|
| `game_created` | `topics, question_count, time_limit_secs, created_by, parts: [{ position, task_id, question_type }]` |
| `player_joined` | `player_id, seat, role` (the role they asked for) |
| `game_started` | `deadline, starting_defuser` |
| `turn_started` | `turn, defuser, expert` |
| `answer_submitted` | `turn, actor, answer, correct, solution, strikes` |
| `game_ended` | `outcome: won\|lost\|aborted, reason: all_resolved\|strikes\|timeout\|forfeit` |

The server writes events to the database **before** it broadcasts them. A
client never sees an event that could be lost on a restart.

## Example

```jsonc
// A → server
{ "type": "create", "topics": ["…"], "question_count": 5, "role": "defuser" }
// server → A
{ "type": "welcome", "game_id": "G", "player_id": "A", "token": "T", "seat": 0 }
{ "type": "snapshot", "state": { "status": "waiting", … } }

// B → server
{ "type": "join", "game_id": "G" }
// server → A and B
{ "type": "event", "sequence": 2, "event": { "type": "player_joined", "player_id": "B", "seat": 1, "role": null } }
{ "type": "event", "sequence": 3, "event": { "type": "game_started", "deadline": "…", "starting_defuser": "A" } }
{ "type": "event", "sequence": 4, "event": { "type": "turn_started", "turn": 0, "defuser": "A", "expert": "B" } }
// server → A only
{ "type": "briefing", "turn": 0, "role": "defuser", "task": { "type": "single_choice", "id": "…", "options": ["4", "8"] } }
// server → B only
{ "type": "briefing", "turn": 0, "role": "expert", "question_type": "single_choice", "prompt": "Wie viele Bits hat ein Byte?", "instruction": { … } }

// A → server
{ "type": "submit_answer", "turn": 0, "answer": { "type": "single_choice", "answer": 1 } }
// server → A and B
{ "type": "event", "sequence": 5, "event": { "type": "answer_submitted", "turn": 0, "actor": "A", "correct": true, "strikes": 0, … } }
{ "type": "event", "sequence": 6, "event": { "type": "turn_started", "turn": 1, "defuser": "B", "expert": "A" } }

// B's connection drops; B reconnects and only gets what it missed
{ "type": "resume", "game_id": "G", "token": "T_B", "last_sequence": 6 }
```

## Content conventions

- `tasks.content` is the question without `id` and `type` (both added by the
  server); `tasks.solution` has the same shape as the answer value (`AnswerMap`
  in `frontend/src/api/types.ts`). Exception: `coords` is `{ x, y, radius }` in
  percent.
- Text answers are trimmed and compared case-insensitively unless the question
  has `caseSensitive: true`. Multiple choice is compared as a set.
