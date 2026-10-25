import type { SessionError } from '../api/session'

/**
 * What the player reads for a refused request, on the session socket or the user channel (they
 * share some codes); other codes show the server's message.
 */
const TEXTS: Partial<Record<SessionError['code'] | 'unknown_invite', string>> = {
  skill_locked: 'Dieses Stockwerk ist noch zu. Schafft erst die Stockwerke darunter.',
  not_island_member: 'Ihr müsst beide auf dieser Insel wohnen, um hier zu spielen.',
  not_invited: 'Dieses Spiel ist für jemand anderen gedacht.',
  no_tasks: 'Für dieses Stockwerk gibt es noch keine Fragen.',
  game_full: 'Das Spiel ist schon voll.',
  unknown_game: 'Dieses Spiel gibt es nicht (mehr).',
  invalid_state: 'Das Spiel läuft nicht mehr.',
  invalid_token: 'Kein Zugang zu diesem Spiel.',
  unknown_invite: 'Die Einladung gilt nicht mehr.',
}

export function sessionErrorText(error: { code: string; message: string }): string {
  return TEXTS[error.code as keyof typeof TEXTS] ?? error.message
}
