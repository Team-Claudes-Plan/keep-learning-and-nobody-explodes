-- topics are language-specific variants of a house. Skills and tasks inherit
-- the language through their topic. Reading clients only see topics of their
-- configured language; a missing variant simply does not exist for them.

-- generated content from before the language split cannot be assigned reliably
TRUNCATE topics, skills, tasks, instructions, games CASCADE;

ALTER TABLE topics
    ADD COLUMN language TEXT NOT NULL
    CHECK (language IN ('german', 'english'));

DROP INDEX topics_island_name_idx;
CREATE UNIQUE INDEX topics_island_language_name_idx
    ON topics (island_id, language, lower(name));
