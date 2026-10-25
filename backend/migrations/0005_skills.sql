-- skills are the storeys of a topic (house) and the unit of knowledge.
-- tasks belong to exactly one skill; the topic follows from the skill.

CREATE TABLE skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (name <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX skills_topic_name_idx ON skills (topic_id, lower(name));

ALTER TABLE tasks
    ADD COLUMN skill_id UUID REFERENCES skills(id) ON DELETE CASCADE;

-- existing tasks stay playable: one provisional skill per topic with tasks,
-- named like the topic
INSERT INTO skills (topic_id, name)
SELECT t.id, t.name
FROM topics t
WHERE EXISTS (SELECT 1 FROM tasks k WHERE k.topic_id = t.id);

UPDATE tasks t
SET skill_id = s.id
FROM skills s
WHERE s.topic_id = t.topic_id;

ALTER TABLE tasks ALTER COLUMN skill_id SET NOT NULL;

-- the topic of a task now follows from its skill
ALTER TABLE tasks DROP COLUMN topic_id;

CREATE INDEX tasks_skill_id_idx ON tasks (skill_id);
