// Shapes exchanged with the backend, matching schema/questions.schema.json.
// Questions contain no solutions; the backend evaluates submitted answers.
// Answers reference options/items by their index in the delivered arrays.

export type SingleChoiceQuestion = {
  type: 'single_choice'
  id: string
  prompt: string
  options: string[]
}

export type MultipleChoiceQuestion = {
  type: 'multiple_choice'
  id: string
  prompt: string
  options: string[]
}

export type TrueFalseQuestion = {
  type: 'true_false'
  id: string
  statements: string[]
}

export type TextInputQuestion = {
  type: 'text_input'
  id: string
  prompt: string
  /** Default false: case is ignored and input is sent in upper case. */
  caseSensitive?: boolean
}

export type NumberInputQuestion = {
  type: 'number_input'
  id: string
  prompt: string
  unit?: string | null
}

export type MatchingQuestion = {
  type: 'matching'
  id: string
  left: string[]
  right: string[]
}

export type GroupingQuestion = {
  type: 'grouping'
  id: string
  categories: string[]
  items: string[]
}

export type CoordsQuestion = {
  type: 'coords'
  id: string
  prompt: string
  image: string
}

export type OrderQuestion = {
  type: 'order'
  id: string
  prompt: string
  items: string[]
}

export type Question =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | TrueFalseQuestion
  | TextInputQuestion
  | NumberInputQuestion
  | MatchingQuestion
  | GroupingQuestion
  | CoordsQuestion
  | OrderQuestion

export type QuestionType = Question['type']

/** The answer value itself per question type (see schema/answer-submission.schema.json). */
export type AnswerMap = {
  /** Index of the chosen option. */
  single_choice: number
  /** Indices of the chosen options, ascending. */
  multiple_choice: number[]
  /** One value per statement, same order. */
  true_false: boolean[]
  text_input: string
  number_input: number
  /** Index into `right` per element of `left`, same order as `left`. */
  matching: number[]
  /** Category index per item, same order as items. */
  grouping: number[]
  /** Percent of the image size. */
  coords: { x: number; y: number }
  /** Item indices in the chosen order. */
  order: number[]
}

export type AnswerSubmission = {
  [T in QuestionType]: { questionId: string; type: T; answer: AnswerMap[T] }
}[QuestionType]

/** Backend response to a submitted answer. Not final yet. */
export type AnswerResult = {
  correct?: boolean
  /** Proposal: the correct answer, same shape as the submitted answer, so the UI can show what was wrong. */
  solution?: AnswerMap[QuestionType]
}

// Session protocol over the websocket /api/sessions/ws, see schema/session-protocol.md.

export type Role = 'defuser' | 'expert'

/**
 * One module as the defuser gets it: the question reduced to the defuser's half (see
 * backend/src/session/brief.rs). Depending on the type it lacks the prompt, has its answer list as
 * symbols (`glyphs`: entry i of the missing list is shown as symbol glyphs[i]), has only
 * `statementCount` instead of the statements, or carries the terminal's `user`.
 */
export type DefuserPart = {
  /** The part this module answers (`turn` of `submit_answer`). */
  position: number
  task: { id: string; type: QuestionType; prompt?: string; statementCount?: number; user?: string } & Record<string, unknown>
  glyphs?: number[]
}

/** One page of the expert's manual. It does not say which module it is for. */
export type ManualPage = {
  /** The question, when only the expert has it. */
  prompt?: string
  /** Free-text terminals: the user logged in on the defuser's terminal. */
  user?: string
  /** True/false: statement i is "Aussage i + 1" on the bomb. */
  statements?: string[]
  /** What the defuser's symbols stand for. */
  symbols?: { glyph: number; text: string }[]
}

/** Like AnswerSubmission, but the part's position (`turn`) identifies the question. */
export type SessionAnswer = {
  [T in QuestionType]: { type: T; answer: AnswerMap[T] }
}[QuestionType]

export type SessionClientMessage =
  | {
      type: 'create'
      /** Topics (houses) to draw from; ignored for a storey game. */
      topics: string[]
      question_count: number
      role?: Role
      time_limit_secs?: number
      /** Plays one storey: its tasks only, and winning passes it. Needs `island_id`. */
      skill_id?: string
      island_id?: string
      /** Only this user may join; the game is not listed in the lobby. */
      invited?: string
    }
  | { type: 'join'; game_id: string; role?: Role }
  | { type: 'resume'; game_id: string; token: string; last_sequence?: number }
  /** Ready to play; the game starts once both players are. */
  | { type: 'ready' }
  /** `turn`: the position of the part; parts can be answered in any order. */
  | { type: 'submit_answer'; turn: number; answer: SessionAnswer }
  | { type: 'forfeit' }

/** `ready`: both seats taken and roles dealt, waiting until both players sent `ready`. */
export type GameStatus = 'waiting' | 'ready' | 'active' | 'won' | 'lost' | 'aborted'
export type EndReason = 'all_resolved' | 'strikes' | 'timeout' | 'forfeit'

export type GameView = {
  game_id: string
  status: GameStatus
  topics: string[]
  /** The storey (skill) the bomb is played on, if any. */
  skill_id: string | null
  invited: string | null
  players: { player_id: string; seat: 0 | 1; online: boolean; ready: boolean }[]
  deadline: string | null
  defuser: string | null
  expert: string | null
  strikes: number
  max_strikes: number
  parts: { position: number; question_type: QuestionType; result: 'solved' | 'failed' | null }[]
  reason: EndReason | null
  last_sequence: number | null
}

/** Persisted game events; the game state is their fold. */
export type GameEvent =
  | {
      type: 'game_created'
      topics: string[]
      question_count: number
      time_limit_secs: number
      created_by: string
      parts: { position: number; task_id: string; question_type: QuestionType; glyphs?: number[] }[]
      skill_id?: string
      invited?: string
    }
  | { type: 'player_joined'; player_id: string; seat: 0 | 1; role: Role | null }
  /** Both seats taken: the roles for the whole game. */
  | { type: 'roles_assigned'; defuser: string; expert: string }
  | { type: 'player_ready'; player_id: string }
  | { type: 'game_started'; deadline: string; starting_defuser: string }
  /** Only in games from before all modules were open at once. */
  | { type: 'turn_started'; turn: number; defuser: string; expert: string }
  | {
      type: 'answer_submitted'
      turn: number
      actor: string
      answer: SessionAnswer
      correct: boolean
      solution: unknown
      strikes: number
    }
  | { type: 'game_ended'; outcome: 'won' | 'lost' | 'aborted'; reason: EndReason }

export type SessionErrorCode =
  | 'bad_message'
  | 'unknown_game'
  | 'game_full'
  | 'invalid_token'
  | 'not_your_turn'
  | 'stale_turn'
  | 'invalid_state'
  | 'no_tasks'
  | 'skill_locked'
  | 'not_island_member'
  | 'not_invited'
  | 'internal'

export type SessionServerMessage =
  | { type: 'welcome'; game_id: string; player_id: string; token: string; seat: 0 | 1 }
  | { type: 'snapshot'; state: GameView }
  | { type: 'event'; sequence: number; at: string; event: GameEvent }
  /** Private: the whole bomb (defuser) or the whole manual (expert), once the game runs. */
  | { type: 'briefing'; role: 'defuser'; parts: DefuserPart[] }
  | { type: 'briefing'; role: 'expert'; pages: ManualPage[] }
  | { type: 'presence'; player_id: string; online: boolean }
  | { type: 'error'; code: SessionErrorCode; message: string }

/** A waiting game, as `GET /api/sessions` lists them (games of the last hour, newest first). */
export type Lobby = {
  id: string
  /** House (topic) ids the questions come from. */
  topics: string[]
  question_count: number
  /** The role left for whoever joins, if the creator picked one. */
  open_role: Role | null
}

// Islands, as `GET /api/islands` returns them (backend/src/api/islands.rs).
// An island holds the documents a user uploaded and belongs to one or two users. Akasha files the
// questions it generates from the documents under topics; each topic is a house on the island.

export type UserSummary = {
  id: string
  name: string
}

/** The members of an island: its creator, then the partner if there is one. The id is the island's. */
export type LearningGroup = {
  id: string
  members: [UserSummary] | [UserSummary, UserSummary]
}

/** A skill of a topic, shown as a storey of its house. */
export type HouseSkill = {
  skill_id: string
  name: string
  /** Place in the skill tree: 0 is the ground floor. */
  position: number
  /** Playable tasks of the skill. */
  tasks: number
  /** Every member of the island won a bomb on it. */
  passed: boolean
  /** Passed, or the next storey to play. */
  unlocked: boolean
}

/** A topic of an island, shown as a house. */
export type IslandHouse = {
  topic_id: string
  name: string
  /** Number of storeys every member passed in a row from the ground floor. */
  level: number
  /** Whether the house has a storey to play. */
  unlocked: boolean
  /** The skill tree, ground floor first. */
  skills: HouseSkill[]
}

export type Island = {
  id: string
  name: string
  /** The island this one was forked from. A fork shares its origin's documents and houses. */
  origin_id: string | null
  group: LearningGroup
  houses: IslandHouse[]
  /** Uploaded documents still being turned into houses; the island shows a construction site. */
  building: number
}

/** The islands the current user is a member of; the backend enforces this. */
export type IslandsResponse = {
  me: UserSummary
  islands: Island[]
}

/** Response of `POST /upload?island_id=…`. */
export type UploadResponse = {
  /** The island that owns the files: the origin, if the upload went to a fork. */
  island_id: string
  objects: { key: string; filename: string; content_type: string; size: number }[]
  failures: { filename?: string; message: string }[]
}

export type PresenceStatus = 'online' | 'offline'

/** Live status of a user, pushed while the islands page is open. */
export type Presence = {
  userId: string
  status: PresenceStatus
}

