# User channel

One websocket per signed-in user while the app is open. It tells who of the
user's island partners is online and carries game invites between them. The
game itself runs over the [session protocol](session-protocol.md).

- Endpoint: `GET /api/users/ws?user_id=<uuid>` (or the `X-User-Id` header).
  Unknown users are refused with 401 before the upgrade.
- Every message is a JSON text frame with a `type` field. The server pings
  every 15 s.
- A user is **online** while they have at least one open channel; several tabs
  are fine.
- State lives in memory: a server restart drops open invites, clients
  reconnect and get presence again.
- Implementation: `backend/src/presence/` (the hub, wire types in
  `protocol.rs`) and `backend/src/api/presence.rs` (checks and transport).
  Client: `frontend/src/api/invites.ts`.

## Server → client

| type | fields | when |
|---|---|---|
| `presence` | `user_id, online` | on connect once for every island partner, then on every change |
| `invite_sent` | `request_id, invite_id` | reply to your `invite` |
| `invite` | `invite_id, from: { id, name }, island_id, topic_id, storey_id, game_id` | someone invites you; on connect again for every invite still open |
| `invite_answered` | `invite_id, accepted` | to the inviter |
| `invite_cancelled` | `invite_id` | the invite is gone: taken back, answered in another tab, or the inviter or invitee went offline |
| `added_to_island` | `island_id, by: { id, name }` | someone made you a member of an island: created it with you, added you, or forked one to learn with you. The two of you are partners from now on, so a `presence` for them follows if it is news |
| `island_updated` | `island_id` | a document uploaded to this island (or the island it was forked from) finished processing, with or without new houses (OCR failed, Akasha could not be reached, or Akasha is done). Sent to every member of the root island and its forks; `island_id` is the root. Refetch `GET /api/islands` (its `building` count drops). The frontend also refetches after a reconnect, since pushes sent while offline are lost |
| `error` | `request_id?, code, message` | answers one message; the connection stays open |

Error codes: `bad_message`, `partner_offline` (no open channel),
`not_island_member` (sender or invitee not on the island), `unknown_game` (no
waiting game of the sender that the invitee may join), `unknown_invite`,
`internal`.

## Client → server

| type | fields | notes |
|---|---|---|
| `invite` | `request_id, to, island_id, topic_id, storey_id, game_id` | `game_id` is a waiting game the sender created (see `create` in the session protocol); `storey_id` is the skill of a storey game |
| `answer_invite` | `invite_id, accept` | invitee only |
| `cancel_invite` | `invite_id` | inviter only |

Accepting an invite whose game is no longer waiting fails with `unknown_game`
and withdraws the invite.

## Starting a storey game together

1. The inviter opens the game on the session socket:
   `create { skill_id, island_id, invited: <partner>, question_count, role: "defuser" }`.
2. The inviter sends `invite { to: <partner>, game_id, … }` on the user channel.
3. The invitee accepts with `answer_invite` and joins on the session socket:
   `join { game_id, role: "expert" }`. That starts the game; the inviter also
   treats `player_joined`/`game_started` as accepted.
4. On decline, timeout (the frontend takes an invite back after 60 s) or
   cancel, the inviter sends `forfeit`, so the game ends as `aborted`.
