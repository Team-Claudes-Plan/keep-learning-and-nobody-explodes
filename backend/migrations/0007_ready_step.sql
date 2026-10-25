-- once both seats are taken, a game waits until both players are ready
-- ('ready'); only then does the clock start ('active').

-- the status checks were added without names: drop them by their definition
DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'games'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE games DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE games
    ADD CHECK (status IN ('waiting', 'ready', 'active', 'won', 'lost', 'aborted')),
    ADD CHECK (
        (status IN ('waiting', 'ready', 'active') AND ended_at IS NULL)
        OR (status IN ('won', 'lost', 'aborted') AND ended_at IS NOT NULL)
    );

ALTER TABLE game_events DROP CONSTRAINT game_events_event_type_check;
ALTER TABLE game_events ADD CONSTRAINT game_events_event_type_check
    CHECK (event_type IN (
        'game_created',
        'player_joined',
        'roles_assigned',
        'player_ready',
        'game_started',
        'turn_started',
        'answer_submitted',
        'game_ended'
    ));
