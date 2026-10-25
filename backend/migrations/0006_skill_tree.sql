-- skills form an ordered skill tree per topic: the storeys of a house, ground
-- floor first. a storey is passed by winning a bomb on its skill.

ALTER TABLE skills ADD COLUMN position INTEGER;

UPDATE skills s
SET position = ranked.position
FROM (
    SELECT id, row_number() OVER (PARTITION BY topic_id ORDER BY created_at, id) - 1 AS position
    FROM skills
) ranked
WHERE ranked.id = s.id;

ALTER TABLE skills
    ALTER COLUMN position SET NOT NULL,
    ADD CHECK (position >= 0);

-- not unique: concurrent imports may append at the same position; readers
-- order by (position, created_at, id)
CREATE INDEX skills_topic_position_idx ON skills (topic_id, position);

-- a skill inserted without a position becomes the new top storey
CREATE FUNCTION skills_append_position() RETURNS trigger AS $$
BEGIN
    IF NEW.position IS NULL THEN
        SELECT COALESCE(max(position) + 1, 0) INTO NEW.position
        FROM skills WHERE topic_id = NEW.topic_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER skills_append_position
    BEFORE INSERT ON skills
    FOR EACH ROW EXECUTE FUNCTION skills_append_position();

-- the storey a game is played on (none for lobby games over whole topics),
-- and the only user who may join a private game
ALTER TABLE games
    ADD COLUMN skill_id UUID REFERENCES skills(id) ON DELETE SET NULL,
    ADD COLUMN invited_id UUID;

CREATE INDEX games_skill_id_idx ON games (skill_id) WHERE skill_id IS NOT NULL;

-- a bomb may repeat a task when its skill has fewer tasks than modules
ALTER TABLE game_parts DROP CONSTRAINT game_parts_game_id_task_id_key;
