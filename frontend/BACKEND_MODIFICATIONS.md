# Backend changes the frontend needs

The frontend now starts co-op games from a storey: the player clicks a room and then "Session starten". The partner gets an invite, and when they accept, both players land in the game. The inviter gets the bomb and the invitee gets the handbook.

The game itself already runs over `GET /api/sessions/ws` (see `schema/session-protocol.md`). What's missing is a channel **outside** a game, for knowing who is online and for passing invites along. The frontend talks to it already (`frontend/src/api/invites.ts`). Until the endpoint exists, every partner shows as offline, and the storey view says so.

## 1. User channel: `GET /api/users/ws?user_id=<uuid>` (new, required)

- This is a websocket, authenticated like the session socket: `user_id` query or `X-User-Id`, and 401 for unknown users before the upgrade.
- The frontend keeps it open the whole time the app is open, and reconnects with a backoff of 1, 2, 5, 10 and 30 s.
- **A user counts as online while they have at least one open user channel.** Several tabs are possible.
- Every message is a JSON text frame with a `type` field, the same as the session socket.

### Server → client

| type | fields | when |
|---|---|---|
| `presence` | `user_id, online: bool` | Right after connecting, once for **every user who shares an island with me**. After that, on every change. |
| `invite_sent` | `request_id, invite_id` | Replies to my `invite`: the invite was delivered. |
| `invite` | `invite_id, from: {id, name}, island_id, topic_id, storey_id, game_id` | Someone invites me. Right after connecting, also every invite to me that is still open. |
| `invite_answered` | `invite_id, accepted: bool` | Goes to the inviter when the invitee answers. |
| `invite_cancelled` | `invite_id` | Goes to the invitee when the inviter takes the invite back or disconnects, or when the game behind it ended. It may also go to the inviter if the server drops the invite. |
| `error` | `request_id?, code, message` | Replies to a single message. The connection stays open. |

Error codes the frontend handles:
- `partner_offline`: shown as "X ist offline".
- `not_island_member`: the invitee doesn't share `island_id` with me.
- `unknown_invite`.
- `bad_message`.

Any other code is shown with its `message`.

### Client → server

| type | fields | notes |
|---|---|---|
| `invite` | `request_id, to, island_id, topic_id, storey_id, game_id` | `request_id` is chosen by the client and echoed in `invite_sent` / `error`. Reject the invite if `to` is offline (`partner_offline`) or isn't a member of `island_id` together with me. The server should check that `game_id` is a `waiting` game created by me. |
| `answer_invite` | `invite_id, accept: bool` | Only the invitee may send it. Forward it as `invite_answered` to the inviter. Afterwards the invite is closed. |
| `cancel_invite` | `invite_id` | Only the inviter may send it. Send `invite_cancelled` to the invitee. |

`storey_id` is a frontend id (`ground`, `first`, …) that the frontend uses only for display. The server only needs to pass it along unchanged.

### Lifetime

- If the inviter's last user channel closes, cancel their open invites.
- If the invitee is offline, `invite` fails. There is no need to queue invites.
- Invites don't need to survive a server restart. The frontend takes an invite back after 60 s without an answer.

### Example

```jsonc
// A → server
{ "type": "invite", "request_id": "r1", "to": "B", "island_id": "I", "topic_id": "T", "storey_id": "ground", "game_id": "G" }
// server → A
{ "type": "invite_sent", "request_id": "r1", "invite_id": "V" }
// server → B
{ "type": "invite", "invite_id": "V", "from": { "id": "A", "name": "Alex" }, "island_id": "I", "topic_id": "T", "storey_id": "ground", "game_id": "G" }
// B → server
{ "type": "answer_invite", "invite_id": "V", "accept": true }
// server → A
{ "type": "invite_answered", "invite_id": "V", "accepted": true }
// B then joins game G over /api/sessions/ws (join, role expert); A already sits in it as defuser.
```

## 2. How the game is opened (works today, for context)

1. The inviter's frontend opens the game on the **existing** session socket: `create { topics: [topic_id], question_count: 5, role: "defuser", time_limit_secs: 300 }`.
2. It invites the partner with the resulting `game_id`.
3. On accept, the invitee sends `join { game_id, role: "expert" }`.
4. The inviter treats `player_joined` / `game_started` on its session socket as accepted, too.

On decline, timeout or cancel, the inviter sends `forfeit`, so the waiting game ends as `aborted`.

## 3. Nice to have

- **Private games:** `create` with an `invited: <user_id>` field. That game doesn't show up in `GET /api/sessions` and only that user may `join` it (otherwise `game_full` or a new `not_invited`). Right now an invite game is briefly visible in the public lobby list.
- **Questions per storey:** storeys stand for the key concepts of a topic. If tasks get a concept, `create` could take `concept` (or `storey`) to pick only that storey's questions. Right now the whole topic is used.
- **Error for a game that's gone:** if the invite's game has already ended when the invitee joins, `join` answers `invalid_state` today. That's fine. The frontend shows the error on the game page.
