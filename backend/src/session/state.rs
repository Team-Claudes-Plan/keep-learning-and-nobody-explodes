//! Pure game rules: `decide` validates a command and returns the events it
//! causes, `apply` folds an event into the state. No IO happens here, so the
//! same code serves live games and replays from the event log.

use chrono::{DateTime, TimeDelta, Utc};
use serde_json::Value;
use uuid::Uuid;

use super::{
    SessionError, glyphs, judge,
    protocol::{
        Answer, Brief, EndReason, ErrorCode, GameEvent, GameView, MAX_STRIKES, Outcome, PartInfo,
        PartResult, PartView, PlayerView, Role, ServerMessage, Status, Symbol,
    },
    task,
};
use crate::db::PartDetails;

#[derive(Debug)]
pub enum Command {
    /// `coin` breaks the tie when neither player picked a role.
    Join {
        player: Uuid,
        role: Option<Role>,
        coin: bool,
    },
    /// The player is ready; the second one starts the game.
    Ready {
        player: Uuid,
    },
    Submit {
        player: Uuid,
        turn: u32,
        answer: Answer,
    },
    Forfeit {
        player: Uuid,
    },
    Timeout,
}

#[derive(Debug)]
struct Player {
    id: Uuid,
    role: Option<Role>,
    ready: bool,
}

#[derive(Debug)]
pub struct GameState {
    pub id: Uuid,
    pub status: Status,
    pub topics: Vec<Uuid>,
    pub skill_id: Option<Uuid>,
    pub invited: Option<Uuid>,
    pub time_limit_secs: u32,
    players: Vec<Player>,
    parts: Vec<(PartInfo, Option<PartResult>)>,
    starting_defuser: Option<Uuid>,
    pub deadline: Option<DateTime<Utc>>,
    turn: Option<u32>,
    strikes: u8,
    reason: Option<EndReason>,
    pub last_sequence: Option<u32>,
}

impl GameState {
    #[must_use]
    pub fn new(id: Uuid) -> Self {
        Self {
            id,
            status: Status::Waiting,
            topics: Vec::new(),
            skill_id: None,
            invited: None,
            time_limit_secs: 0,
            players: Vec::new(),
            parts: Vec::new(),
            starting_defuser: None,
            deadline: None,
            turn: None,
            strikes: 0,
            reason: None,
            last_sequence: None,
        }
    }

    pub fn replay<'a>(id: Uuid, events: impl IntoIterator<Item = (u32, &'a GameEvent)>) -> Self {
        let mut state = Self::new(id);
        for (sequence, event) in events {
            state.apply(sequence, event);
        }
        state
    }

    #[must_use]
    pub fn players(&self) -> Vec<Uuid> {
        self.players.iter().map(|p| p.id).collect()
    }

    #[must_use]
    pub fn is_player(&self, player: Uuid) -> bool {
        self.players.iter().any(|p| p.id == player)
    }

    #[must_use]
    pub fn is_ended(&self) -> bool {
        matches!(self.status, Status::Won | Status::Lost | Status::Aborted)
    }

    /// `(defuser, expert)`: the roles dealt on join hold for every turn of the game.
    #[must_use]
    pub fn roles(&self) -> Option<(Uuid, Uuid)> {
        let defuser = self.starting_defuser?;
        let expert = self
            .players
            .iter()
            .map(|p| p.id)
            .find(|&id| id != defuser)?;
        Some((defuser, expert))
    }

    pub fn decide(
        &self,
        command: Command,
        now: DateTime<Utc>,
        details: &[PartDetails],
    ) -> Result<Vec<GameEvent>, SessionError> {
        match command {
            Command::Join { player, role, coin } => self.decide_join(player, role, coin),
            Command::Ready { player } => self.decide_ready(player, now),
            Command::Submit {
                player,
                turn,
                answer,
            } => self.decide_submit(player, turn, answer, now, details),
            Command::Forfeit { player } => {
                if !self.is_player(player) {
                    return Err(SessionError::new(
                        ErrorCode::InvalidToken,
                        "not a player of this game",
                    ));
                }
                if self.is_ended() {
                    return Err(SessionError::new(ErrorCode::InvalidState, "game is over"));
                }
                Ok(vec![GameEvent::GameEnded {
                    outcome: Outcome::Aborted,
                    reason: EndReason::Forfeit,
                }])
            }
            Command::Timeout => Ok(self.timed_out(now).into_iter().collect()),
        }
    }

    fn timed_out(&self, now: DateTime<Utc>) -> Option<GameEvent> {
        (self.status == Status::Active && self.deadline.is_some_and(|d| d <= now)).then_some(
            GameEvent::GameEnded {
                outcome: Outcome::Lost,
                reason: EndReason::Timeout,
            },
        )
    }

    fn decide_join(
        &self,
        player: Uuid,
        role: Option<Role>,
        coin: bool,
    ) -> Result<Vec<GameEvent>, SessionError> {
        if self.status != Status::Waiting {
            return Err(SessionError::new(
                ErrorCode::InvalidState,
                "game is not waiting for players",
            ));
        }
        let [creator] = self.players.as_slice() else {
            return Err(SessionError::new(ErrorCode::GameFull, "game is full"));
        };
        if creator.id == player {
            return Err(SessionError::new(
                ErrorCode::InvalidState,
                "already in this game",
            ));
        }
        if self.invited.is_some_and(|invited| invited != player) {
            return Err(SessionError::new(
                ErrorCode::NotInvited,
                "this game is private to another player",
            ));
        }

        let joiner_defuses = match (creator.role, role) {
            (Some(creator_role), _) => creator_role == Role::Expert,
            (None, Some(role)) => role == Role::Defuser,
            (None, None) => coin,
        };
        let starting_defuser = if joiner_defuses { player } else { creator.id };
        let expert = if joiner_defuses { creator.id } else { player };

        Ok(vec![
            GameEvent::PlayerJoined {
                player_id: player,
                seat: 1,
                role,
            },
            GameEvent::RolesAssigned {
                defuser: starting_defuser,
                expert,
            },
        ])
    }

    /// Marks `player` ready; when the other player already is, the clock
    /// starts and so does the first turn. Repeated or late `ready`s change
    /// nothing.
    fn decide_ready(
        &self,
        player: Uuid,
        now: DateTime<Utc>,
    ) -> Result<Vec<GameEvent>, SessionError> {
        let Some(me) = self.players.iter().find(|p| p.id == player) else {
            return Err(SessionError::new(
                ErrorCode::InvalidToken,
                "not a player of this game",
            ));
        };
        match self.status {
            Status::Ready => {}
            Status::Active => return Ok(Vec::new()),
            _ => {
                return Err(SessionError::new(
                    ErrorCode::InvalidState,
                    "game is not waiting for players to be ready",
                ));
            }
        }
        if me.ready {
            return Ok(Vec::new());
        }
        let mut events = vec![GameEvent::PlayerReady { player_id: player }];
        let others_ready = self
            .players
            .iter()
            .filter(|p| p.id != player)
            .all(|p| p.ready);
        if others_ready && let Some((defuser, expert)) = self.roles() {
            events.push(GameEvent::GameStarted {
                deadline: now + TimeDelta::seconds(i64::from(self.time_limit_secs)),
                starting_defuser: defuser,
            });
            events.push(GameEvent::TurnStarted {
                turn: 0,
                defuser,
                expert,
            });
        }
        Ok(events)
    }

    fn decide_submit(
        &self,
        player: Uuid,
        turn: u32,
        answer: Answer,
        now: DateTime<Utc>,
        details: &[PartDetails],
    ) -> Result<Vec<GameEvent>, SessionError> {
        if self.status != Status::Active {
            return Err(SessionError::new(
                ErrorCode::InvalidState,
                "game is not active",
            ));
        }
        if let Some(timeout) = self.timed_out(now) {
            return Ok(vec![timeout]);
        }
        let current = self.turn.unwrap_or_default();
        if turn != current {
            return Err(SessionError::new(
                ErrorCode::StaleTurn,
                format!("turn {turn} is not the current turn {current}"),
            ));
        }
        let Some((defuser, _)) = self.roles() else {
            return Err(SessionError::internal("game has no roles"));
        };
        if player != defuser {
            return Err(SessionError::new(
                ErrorCode::NotYourTurn,
                "only the defuser can answer",
            ));
        }
        let Some(part) = usize::try_from(turn).ok().and_then(|i| details.get(i)) else {
            return Err(SessionError::internal("missing part details"));
        };
        if part.question_type != answer.question_type() {
            return Err(SessionError::new(
                ErrorCode::BadMessage,
                format!("answer type must be {}", part.question_type),
            ));
        }

        let correct = judge::judge(&part.content, &part.solution, &answer).map_err(|error| {
            tracing::error!(%error, game = %self.id, turn, "malformed task solution");
            SessionError::internal("could not evaluate answer")
        })?;
        let strikes = if correct {
            self.strikes
        } else {
            self.strikes + 1
        };

        let mut events = vec![GameEvent::AnswerSubmitted {
            turn,
            actor: player,
            answer,
            correct,
            solution: task::answer_value(&part.solution).clone(),
            strikes,
        }];

        let next = turn + 1;
        if strikes >= MAX_STRIKES {
            events.push(GameEvent::GameEnded {
                outcome: Outcome::Lost,
                reason: EndReason::Strikes,
            });
        } else if usize::try_from(next).is_ok_and(|n| n >= self.parts.len()) {
            events.push(GameEvent::GameEnded {
                outcome: Outcome::Won,
                reason: EndReason::AllResolved,
            });
        } else if let Some((defuser, expert)) = self.roles() {
            events.push(GameEvent::TurnStarted {
                turn: next,
                defuser,
                expert,
            });
        }
        Ok(events)
    }

    pub fn apply(&mut self, sequence: u32, event: &GameEvent) {
        self.last_sequence = Some(sequence);
        match event {
            GameEvent::GameCreated {
                topics,
                time_limit_secs,
                parts,
                skill_id,
                invited,
                ..
            } => {
                self.topics.clone_from(topics);
                self.skill_id = *skill_id;
                self.invited = *invited;
                self.time_limit_secs = *time_limit_secs;
                self.parts = parts.iter().map(|p| (p.clone(), None)).collect();
            }
            GameEvent::PlayerJoined {
                player_id, role, ..
            } => self.players.push(Player {
                id: *player_id,
                role: *role,
                ready: false,
            }),
            GameEvent::RolesAssigned { defuser, .. } => {
                self.status = Status::Ready;
                self.starting_defuser = Some(*defuser);
            }
            GameEvent::PlayerReady { player_id } => {
                if let Some(player) = self.players.iter_mut().find(|p| p.id == *player_id) {
                    player.ready = true;
                }
            }
            GameEvent::GameStarted {
                deadline,
                starting_defuser,
            } => {
                self.status = Status::Active;
                self.deadline = Some(*deadline);
                self.starting_defuser = Some(*starting_defuser);
            }
            GameEvent::TurnStarted { turn, .. } => self.turn = Some(*turn),
            GameEvent::AnswerSubmitted {
                turn,
                correct,
                strikes,
                ..
            } => {
                if let Some((_, result)) = usize::try_from(*turn)
                    .ok()
                    .and_then(|i| self.parts.get_mut(i))
                {
                    *result = Some(if *correct {
                        PartResult::Solved
                    } else {
                        PartResult::Failed
                    });
                }
                self.strikes = *strikes;
            }
            GameEvent::GameEnded { outcome, reason } => {
                self.status = (*outcome).into();
                self.reason = Some(*reason);
            }
        }
    }

    pub fn view(&self, online: impl Fn(Uuid) -> bool) -> GameView {
        let roles = match self.status {
            // before the start too, so each player gets to their side of the table
            Status::Ready | Status::Active => self.roles(),
            _ => None,
        };
        // games started before the ready step had no `player_ready` events
        let started = self.deadline.is_some();
        GameView {
            game_id: self.id,
            status: self.status,
            topics: self.topics.clone(),
            skill_id: self.skill_id,
            invited: self.invited,
            players: self
                .players
                .iter()
                .zip(0..)
                .map(|(p, seat)| PlayerView {
                    player_id: p.id,
                    seat,
                    online: online(p.id),
                    ready: p.ready || started,
                })
                .collect(),
            deadline: self.deadline,
            turn: self.turn,
            defuser: roles.map(|(defuser, _)| defuser),
            expert: roles.map(|(_, expert)| expert),
            strikes: self.strikes,
            max_strikes: MAX_STRIKES,
            parts: self
                .parts
                .iter()
                .map(|(info, result)| PartView {
                    position: info.position,
                    question_type: info.question_type.clone(),
                    result: *result,
                })
                .collect(),
            reason: self.reason,
            last_sequence: self.last_sequence,
        }
    }

    /// What `player` gets to see in the current turn, if one is running.
    pub fn briefing(&self, player: Uuid, details: &[PartDetails]) -> Option<ServerMessage> {
        if self.status != Status::Active {
            return None;
        }
        let turn = self.turn?;
        let (defuser, expert) = self.roles()?;
        let index = usize::try_from(turn).ok()?;
        let (info, _) = self.parts.get(index)?;
        let part = details.get(index)?;
        let mut content = task::content_object(&part.content);
        let mut instruction = task::instruction_object(&part.instruction);
        let prompt = content
            .get("prompt")
            .cloned()
            .or_else(|| instruction.get("prompt").cloned());

        if let Value::Object(fields) = &mut instruction {
            fields.remove("prompt");
        }

        let brief = if player == defuser {
            content.remove("prompt");
            if !info.glyphs.is_empty()
                && let Some(field) = glyphs::symbol_field(&part.question_type)
            {
                content.remove(field);
            }
            content.insert("id".to_owned(), info.task_id.to_string().into());
            content.insert("type".to_owned(), part.question_type.clone().into());
            Brief::Defuser {
                task: Value::Object(content),
                glyphs: info.glyphs.clone(),
            }
        } else if player == expert {
            let symbols = info
                .glyphs
                .iter()
                .zip(glyphs::symbol_texts(&part.question_type, &part.content))
                .map(|(&glyph, text)| Symbol { glyph, text })
                .collect();
            Brief::Expert {
                question_type: part.question_type.clone(),
                prompt,
                instruction,
                symbols,
            }
        } else {
            return None;
        };
        Some(ServerMessage::Briefing { turn, brief })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const CREATOR: Uuid = Uuid::from_u128(1);
    const JOINER: Uuid = Uuid::from_u128(2);

    fn details(count: u32) -> Vec<PartDetails> {
        (0..count)
            .map(|_| PartDetails {
                question_type: "single_choice".to_owned(),
                content: json!({ "prompt": "?", "options": ["a", "b"] }),
                instruction: json!({ "text": "pick b" }),
                solution: json!(1),
            })
            .collect()
    }

    struct Game {
        state: GameState,
        log: Vec<GameEvent>,
        details: Vec<PartDetails>,
        now: DateTime<Utc>,
    }

    impl Game {
        fn new(parts: u32, creator_role: Option<Role>) -> Self {
            Self::create(parts, creator_role, None)
        }

        fn create(parts: u32, creator_role: Option<Role>, invited: Option<Uuid>) -> Self {
            let mut game = Self {
                state: GameState::new(Uuid::from_u128(99)),
                log: Vec::new(),
                details: details(parts),
                now: DateTime::from_timestamp(1_000_000, 0).expect("valid timestamp"),
            };
            game.push(vec![
                GameEvent::GameCreated {
                    topics: vec![Uuid::from_u128(7)],
                    question_count: u16::try_from(parts).expect("small"),
                    time_limit_secs: 300,
                    created_by: CREATOR,
                    parts: (0..parts)
                        .map(|position| PartInfo {
                            position,
                            task_id: Uuid::from_u128(u128::from(position) + 100),
                            question_type: "single_choice".to_owned(),
                            glyphs: vec![position * 2, position * 2 + 1]
                                .into_iter()
                                .map(|glyph| u8::try_from(glyph).expect("small"))
                                .collect(),
                        })
                        .collect(),
                    skill_id: Some(Uuid::from_u128(8)),
                    invited,
                },
                GameEvent::PlayerJoined {
                    player_id: CREATOR,
                    seat: 0,
                    role: creator_role,
                },
            ]);
            game
        }

        fn push(&mut self, events: Vec<GameEvent>) {
            for event in events {
                let sequence = u32::try_from(self.log.len()).expect("small");
                self.state.apply(sequence, &event);
                self.log.push(event);
            }
        }

        fn run(&mut self, command: Command) -> Result<Vec<GameEvent>, SessionError> {
            let events = self.state.decide(command, self.now, &self.details)?;
            self.push(events.clone());
            Ok(events)
        }

        /// Joins and gets both players ready, which starts the game.
        fn join(&mut self, role: Option<Role>, coin: bool) {
            self.seat(role, coin);
            for player in [CREATOR, JOINER] {
                self.run(Command::Ready { player }).expect("ready");
            }
        }

        /// Takes the second seat; the game then waits for both to be ready.
        fn seat(&mut self, role: Option<Role>, coin: bool) {
            self.run(Command::Join {
                player: JOINER,
                role,
                coin,
            })
            .expect("join");
        }

        fn answer(
            &mut self,
            player: Uuid,
            turn: u32,
            choice: u32,
        ) -> Result<Vec<GameEvent>, SessionError> {
            self.run(Command::Submit {
                player,
                turn,
                answer: Answer::SingleChoice(choice),
            })
        }

        fn defuser(&self) -> Uuid {
            self.state.view(|_| true).defuser.expect("active")
        }
    }

    fn code(result: Result<Vec<GameEvent>, SessionError>) -> ErrorCode {
        result.expect_err("should fail").code
    }

    #[test]
    fn starting_role_rules() {
        let cases = [
            (Some(Role::Defuser), Some(Role::Defuser), false, CREATOR),
            (Some(Role::Expert), None, false, JOINER),
            (None, Some(Role::Defuser), false, JOINER),
            (None, Some(Role::Expert), true, CREATOR),
            (None, None, true, JOINER),
            (None, None, false, CREATOR),
        ];
        for (creator_role, joiner_role, coin, expected) in cases {
            let mut game = Game::new(3, creator_role);
            game.join(joiner_role, coin);
            assert_eq!(game.state.status, Status::Active);
            assert_eq!(
                game.defuser(),
                expected,
                "{creator_role:?} {joiner_role:?} {coin}"
            );
        }
    }

    #[test]
    fn roles_hold_for_the_whole_game() {
        let mut game = Game::new(3, Some(Role::Defuser));
        game.join(None, false);
        assert_eq!(game.defuser(), CREATOR);
        game.answer(CREATOR, 0, 1).expect("answer");
        assert_eq!(game.defuser(), CREATOR);
        assert_eq!(code(game.answer(JOINER, 1, 0)), ErrorCode::NotYourTurn);
        game.answer(CREATOR, 1, 0).expect("answer");
        assert_eq!(game.defuser(), CREATOR);
    }

    #[test]
    fn only_current_defuser_and_turn() {
        let mut game = Game::new(3, Some(Role::Defuser));
        game.join(None, false);
        assert_eq!(code(game.answer(JOINER, 0, 1)), ErrorCode::NotYourTurn);
        assert_eq!(code(game.answer(CREATOR, 1, 1)), ErrorCode::StaleTurn);
        game.answer(CREATOR, 0, 0).expect("answer");
        // a resent answer for the old turn must not cost a second strike
        assert_eq!(code(game.answer(CREATOR, 0, 0)), ErrorCode::StaleTurn);
        assert_eq!(game.state.view(|_| true).strikes, 1);
    }

    #[test]
    fn wrong_answer_type_is_rejected() {
        let mut game = Game::new(1, Some(Role::Defuser));
        game.join(None, false);
        let result = game.run(Command::Submit {
            player: CREATOR,
            turn: 0,
            answer: Answer::NumberInput(1.0),
        });
        assert_eq!(code(result), ErrorCode::BadMessage);
    }

    #[test]
    fn three_strikes_lose() {
        let mut game = Game::new(5, Some(Role::Defuser));
        game.join(None, false);
        for turn in 0..3 {
            let defuser = game.defuser();
            game.answer(defuser, turn, 0).expect("answer");
        }
        assert_eq!(game.state.status, Status::Lost);
        assert_eq!(game.state.view(|_| true).reason, Some(EndReason::Strikes));
    }

    #[test]
    fn resolving_all_parts_wins() {
        let mut game = Game::new(2, Some(Role::Defuser));
        game.join(None, false);
        game.answer(CREATOR, 0, 0).expect("answer");
        game.answer(CREATOR, 1, 1).expect("answer");
        let view = game.state.view(|_| true);
        assert_eq!(view.status, Status::Won);
        assert_eq!(
            view.parts.iter().map(|p| p.result).collect::<Vec<_>>(),
            [Some(PartResult::Failed), Some(PartResult::Solved)]
        );
    }

    #[test]
    fn deadline_loses() {
        let mut game = Game::new(2, Some(Role::Defuser));
        game.join(None, false);
        assert_eq!(game.run(Command::Timeout).expect("timeout"), []);
        game.now += TimeDelta::seconds(300);
        game.run(Command::Timeout).expect("timeout");
        assert_eq!(game.state.status, Status::Lost);
        assert_eq!(code(game.answer(CREATOR, 0, 1)), ErrorCode::InvalidState);
    }

    #[test]
    fn late_answer_times_out() {
        let mut game = Game::new(2, Some(Role::Defuser));
        game.join(None, false);
        game.now += TimeDelta::seconds(301);
        let events = game.answer(CREATOR, 0, 1).expect("timeout");
        assert!(matches!(
            events.as_slice(),
            [GameEvent::GameEnded {
                reason: EndReason::Timeout,
                ..
            }]
        ));
    }

    #[test]
    fn game_starts_once_both_are_ready() {
        let mut game = Game::new(2, Some(Role::Expert));
        game.seat(None, false);
        let view = game.state.view(|_| true);
        assert_eq!(view.status, Status::Ready);
        assert_eq!((view.defuser, view.expert), (Some(JOINER), Some(CREATOR)));
        assert_eq!(view.deadline, None);
        assert!(game.state.briefing(JOINER, &game.details).is_none());
        // no clock before the start
        game.now += TimeDelta::seconds(1000);
        assert_eq!(game.run(Command::Timeout).expect("timeout"), []);
        assert_eq!(code(game.answer(JOINER, 0, 1)), ErrorCode::InvalidState);

        let first = game.run(Command::Ready { player: JOINER }).expect("ready");
        assert_eq!(first, [GameEvent::PlayerReady { player_id: JOINER }]);
        // pressing twice changes nothing
        assert_eq!(
            game.run(Command::Ready { player: JOINER }).expect("again"),
            []
        );
        let view = game.state.view(|_| true);
        assert_eq!(view.status, Status::Ready);
        assert_eq!(
            view.players.iter().map(|p| p.ready).collect::<Vec<_>>(),
            [false, true]
        );

        let second = game.run(Command::Ready { player: CREATOR }).expect("ready");
        assert!(matches!(
            second.as_slice(),
            [
                GameEvent::PlayerReady { .. },
                GameEvent::GameStarted { starting_defuser, .. },
                GameEvent::TurnStarted { turn: 0, .. },
            ] if *starting_defuser == JOINER
        ));
        let view = game.state.view(|_| true);
        assert_eq!(view.status, Status::Active);
        assert_eq!(view.deadline, Some(game.now + TimeDelta::seconds(300)));
        assert!(game.state.briefing(JOINER, &game.details).is_some());
        // a late ready after the start is ignored
        assert_eq!(
            game.run(Command::Ready { player: CREATOR }).expect("late"),
            []
        );
    }

    #[test]
    fn ready_rules() {
        let mut game = Game::new(1, None);
        // alone in the game, nobody to be ready with
        assert_eq!(
            code(game.run(Command::Ready { player: CREATOR })),
            ErrorCode::InvalidState
        );
        game.seat(None, false);
        assert_eq!(
            code(game.run(Command::Ready {
                player: Uuid::from_u128(3)
            })),
            ErrorCode::InvalidToken
        );
        // giving up before the start ends the game
        game.run(Command::Forfeit { player: JOINER })
            .expect("forfeit");
        assert_eq!(game.state.status, Status::Aborted);
        assert_eq!(
            code(game.run(Command::Ready { player: CREATOR })),
            ErrorCode::InvalidState
        );
    }

    #[test]
    fn games_started_before_the_ready_step_still_replay() {
        let mut game = Game::new(2, Some(Role::Defuser));
        game.push(vec![
            GameEvent::PlayerJoined {
                player_id: JOINER,
                seat: 1,
                role: None,
            },
            GameEvent::GameStarted {
                deadline: game.now + TimeDelta::seconds(300),
                starting_defuser: CREATOR,
            },
            GameEvent::TurnStarted {
                turn: 0,
                defuser: CREATOR,
                expert: JOINER,
            },
        ]);
        let view = game.state.view(|_| true);
        assert_eq!(view.status, Status::Active);
        assert!(view.players.iter().all(|p| p.ready));
        game.answer(CREATOR, 0, 1).expect("answer");
    }

    #[test]
    fn join_rules() {
        let mut game = Game::new(1, None);
        let own = game.run(Command::Join {
            player: CREATOR,
            role: None,
            coin: false,
        });
        assert_eq!(code(own), ErrorCode::InvalidState);
        game.join(None, false);
        let third = game.run(Command::Join {
            player: Uuid::from_u128(3),
            role: None,
            coin: false,
        });
        assert_eq!(code(third), ErrorCode::InvalidState);
    }

    #[test]
    fn briefings_follow_roles() {
        let mut game = Game::new(2, Some(Role::Expert));
        game.join(None, false);
        let Some(ServerMessage::Briefing {
            brief: Brief::Defuser { task, glyphs },
            ..
        }) = game.state.briefing(JOINER, &game.details)
        else {
            panic!("joiner defuses turn 0");
        };
        assert!(task.get("prompt").is_none());
        assert_eq!(task["type"], "single_choice");
        // the answers only exist as symbols for the defuser
        assert!(task.get("options").is_none());
        assert_eq!(glyphs, [0, 1]);

        let Some(ServerMessage::Briefing {
            brief: Brief::Expert { symbols, .. },
            ..
        }) = game.state.briefing(CREATOR, &game.details)
        else {
            panic!("creator is the expert");
        };
        assert_eq!(
            symbols,
            [
                Symbol {
                    glyph: 0,
                    text: json!("a")
                },
                Symbol {
                    glyph: 1,
                    text: json!("b")
                }
            ]
        );
    }

    #[test]
    fn parts_without_symbols_stay_text() {
        let mut game = Game::new(1, Some(Role::Expert));
        game.join(None, false);
        // as if the game had run out of symbols
        game.state.parts[0].0.glyphs.clear();
        let Some(ServerMessage::Briefing {
            brief: Brief::Defuser { task, glyphs },
            ..
        }) = game.state.briefing(JOINER, &game.details)
        else {
            panic!("joiner defuses turn 0");
        };
        assert_eq!(glyphs, Vec::<u8>::new());
        assert_eq!(task["options"], json!(["a", "b"]));
        let Some(ServerMessage::Briefing {
            brief: Brief::Expert { symbols, .. },
            ..
        }) = game.state.briefing(CREATOR, &game.details)
        else {
            panic!("creator is the expert");
        };
        assert_eq!(symbols, Vec::<Symbol>::new());
    }

    #[test]
    fn events_without_glyphs_still_decode() {
        let part: PartInfo = serde_json::from_value(json!({
            "position": 0,
            "task_id": Uuid::from_u128(1),
            "question_type": "order",
        }))
        .expect("old event");
        assert_eq!(part.glyphs, Vec::<u8>::new());
    }

    #[test]
    fn briefing_strips_legacy_solution_fields_from_content() {
        let mut game = Game::new(1, Some(Role::Expert));
        game.join(None, false);
        // without symbols, the options stay readable for the defuser
        game.state.parts[0].0.glyphs.clear();
        game.details[0].content = json!({
            "type": "single_choice",
            "id": "legacy-id",
            "prompt": "Question?",
            "options": ["a", "b"],
            "correct_answer": 1,
            "solution": 1
        });

        let Some(ServerMessage::Briefing {
            brief: Brief::Defuser { task, .. },
            ..
        }) = game.state.briefing(JOINER, &game.details)
        else {
            panic!("joiner defuses turn 0");
        };

        assert!(task.get("prompt").is_none());
        assert!(task.get("correct_answer").is_none());
        assert!(task.get("solution").is_none());
        assert_eq!(task["type"], "single_choice");
        assert_eq!(task["id"], game.state.parts[0].0.task_id.to_string());
        assert_eq!(task["options"], json!(["a", "b"]));
    }

    #[test]
    fn briefing_reads_prompt_from_instruction_for_manual_types() {
        let mut game = Game::new(1, Some(Role::Expert));
        game.join(None, false);
        game.details[0].question_type = "text_input".to_owned();
        game.details[0].content = json!({ "caseSensitive": true });
        game.details[0].instruction = json!({ "prompt": "Wie heißt die Hauptstadt?" });

        let Some(ServerMessage::Briefing {
            brief:
                Brief::Expert {
                    prompt,
                    instruction,
                    ..
                },
            ..
        }) = game.state.briefing(CREATOR, &game.details)
        else {
            panic!("creator is expert on turn 0");
        };
        assert_eq!(prompt, Some(json!("Wie heißt die Hauptstadt?")));
        assert!(instruction.get("prompt").is_none());

        let Some(ServerMessage::Briefing {
            brief: Brief::Defuser { task, .. },
            ..
        }) = game.state.briefing(JOINER, &game.details)
        else {
            panic!("joiner defuses turn 0");
        };
        assert_eq!(task["caseSensitive"], true);
        assert!(task.get("prompt").is_none());
    }

    #[test]
    fn answer_event_stores_unwrapped_solution() {
        let mut game = Game::new(2, Some(Role::Expert));
        game.join(None, false);
        game.details[0].solution = json!({ "correct_answer": 1 });

        let events = game.answer(JOINER, 0, 1).expect("answer");
        let solution = events
            .iter()
            .find_map(|event| match event {
                GameEvent::AnswerSubmitted { solution, .. } => Some(solution),
                _ => None,
            })
            .expect("answer event");

        assert_eq!(solution, &json!(1));
    }

    #[test]
    fn replay_matches_live_state() {
        let mut game = Game::new(3, None);
        game.join(Some(Role::Expert), false);
        game.answer(CREATOR, 0, 1).expect("answer");
        game.answer(CREATOR, 1, 0).expect("answer");

        // events survive the round trip through the database representation
        let log: Vec<GameEvent> = game
            .log
            .iter()
            .map(|e| {
                serde_json::from_value(serde_json::to_value(e).expect("serialize"))
                    .expect("deserialize")
            })
            .collect();
        let replayed = GameState::replay(game.state.id, (0..).zip(&log));
        let live = serde_json::to_value(game.state.view(|_| true)).expect("serialize");
        assert_eq!(
            serde_json::to_value(replayed.view(|_| true)).expect("serialize"),
            live
        );
    }

    #[test]
    fn only_the_invited_player_joins_a_private_game() {
        let mut game = Game::create(3, None, Some(JOINER));
        let stranger = Uuid::from_u128(3);
        assert_eq!(
            code(game.run(Command::Join {
                player: stranger,
                role: None,
                coin: false,
            })),
            ErrorCode::NotInvited
        );
        assert_eq!(game.state.status, Status::Waiting);
        game.join(None, false);
        assert_eq!(game.state.status, Status::Active);
        let view = game.state.view(|_| true);
        assert_eq!(view.invited, Some(JOINER));
        assert_eq!(view.skill_id, Some(Uuid::from_u128(8)));
    }

    #[test]
    fn games_created_before_skills_still_replay() {
        let legacy: GameEvent = serde_json::from_value(json!({
            "type": "game_created",
            "topics": [Uuid::from_u128(7)],
            "question_count": 1,
            "time_limit_secs": 300,
            "created_by": CREATOR,
            "parts": [{ "position": 0, "task_id": Uuid::from_u128(100), "question_type": "single_choice" }]
        }))
        .expect("an event without skill_id and invited");
        let state = GameState::replay(Uuid::from_u128(99), [(0, &legacy)]);
        assert_eq!((state.skill_id, state.invited), (None, None));
    }
}
