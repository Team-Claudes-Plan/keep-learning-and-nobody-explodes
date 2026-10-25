-- the old "topics" were really islands: what a user creates and uploads documents into.
-- topics are now the houses on an island, created by akasha when it categorizes questions.
-- an island belongs to one or two users; a fork shares the content of its origin island.

-- existing data uses the old meaning and is not migrated
TRUNCATE topics, documents, tasks, instructions, games CASCADE;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE topics RENAME TO islands;
-- free the name for the new topics table
ALTER INDEX topics_pkey RENAME TO islands_pkey;

-- documents and topics of a fork live on its origin; forks never chain
ALTER TABLE islands
    DROP COLUMN created_by,
    ADD COLUMN created_by UUID NOT NULL REFERENCES users(id),
    ADD COLUMN origin_id UUID REFERENCES islands(id) ON DELETE CASCADE;

CREATE INDEX islands_origin_id_idx ON islands (origin_id);

-- at most two members per island, enforced by the backend
CREATE TABLE island_members (
    island_id UUID NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (island_id, user_id)
);

CREATE INDEX island_members_user_id_idx ON island_members (user_id);

ALTER TABLE documents RENAME COLUMN topic_id TO island_id;
ALTER INDEX documents_topic_id_idx RENAME TO documents_island_id_idx;

-- a topic is a house; it belongs to the island that owns the content
CREATE TABLE topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    island_id UUID NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (name <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX topics_island_name_idx ON topics (island_id, lower(name));

ALTER TABLE tasks
    ADD COLUMN topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE;

CREATE INDEX tasks_topic_id_idx ON tasks (topic_id);

-- games are played on houses; the old foreign key followed the rename to islands
ALTER TABLE game_topics
    DROP CONSTRAINT game_topics_topic_id_fkey,
    ADD FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE RESTRICT;

ALTER TABLE game_players
    ADD FOREIGN KEY (player_id) REFERENCES users(id);
