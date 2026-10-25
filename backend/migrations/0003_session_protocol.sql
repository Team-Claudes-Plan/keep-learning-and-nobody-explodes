-- session protocol: roles swap every turn, so games no longer have a fixed
-- defuser/expert. players live in game_players, topics in game_topics.
-- game_events is the source of truth, the games/game_parts columns are projections.

-- drop every CHECK on games, the old status/ended_at check does not allow 'waiting'
DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'games'::regclass AND contype = 'c'
    LOOP
        EXECUTE format('ALTER TABLE games DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE games
    DROP COLUMN topic_id,
    DROP COLUMN defuser_id,
    DROP COLUMN expert_id,
    ADD COLUMN question_count SMALLINT NOT NULL DEFAULT 5,
    ADD COLUMN time_limit_secs INTEGER NOT NULL DEFAULT 300,
    ADD COLUMN deadline TIMESTAMPTZ,
    ALTER COLUMN status SET DEFAULT 'waiting',
    ADD CHECK (status IN ('waiting', 'active', 'won', 'lost', 'aborted')),
    ADD CHECK (failure_count BETWEEN 0 AND 3),
    ADD CHECK (next_event_sequence >= 0),
    ADD CHECK (question_count > 0),
    ADD CHECK (time_limit_secs > 0),
    ADD CHECK (
        (status IN ('waiting', 'active') AND ended_at IS NULL)
        OR (status IN ('won', 'lost', 'aborted') AND ended_at IS NOT NULL)
    );

CREATE TABLE game_topics (
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
    PRIMARY KEY (game_id, topic_id)
);

CREATE INDEX game_topics_topic_id_idx ON game_topics (topic_id);

-- seat 0 created the game, seat 1 joined it
CREATE TABLE game_players (
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id UUID NOT NULL,
    seat SMALLINT NOT NULL CHECK (seat IN (0, 1)),
    rejoin_token UUID NOT NULL UNIQUE,
    preferred_role TEXT CHECK (preferred_role IN ('defuser', 'expert')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (game_id, player_id),
    UNIQUE (game_id, seat)
);

ALTER TABLE game_parts
    ADD COLUMN failed_at TIMESTAMPTZ,
    ADD CHECK (solved_at IS NULL OR failed_at IS NULL);

ALTER TABLE game_events DROP CONSTRAINT game_events_event_type_check;
ALTER TABLE game_events ADD CONSTRAINT game_events_event_type_check
    CHECK (event_type IN (
        'game_created',
        'player_joined',
        'game_started',
        'turn_started',
        'answer_submitted',
        'game_ended'
    ));
