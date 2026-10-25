-- whether Akasha turned a document into houses yet. 'pending' while OCR or
-- Akasha still work on it; the island shows a construction site meanwhile.
-- documents from before this migration count as done.
ALTER TABLE documents
    ADD COLUMN trials_status TEXT NOT NULL DEFAULT 'completed'
        CHECK (trials_status IN ('pending', 'completed', 'failed'));

ALTER TABLE documents ALTER COLUMN trials_status SET DEFAULT 'pending';

-- tells the backend (LISTEN island_documents) that a document of an island
-- finished processing, either way. The payload is the island id.
CREATE FUNCTION notify_island_documents() RETURNS trigger AS $$
BEGIN
    IF (NEW.trials_status <> 'pending' AND NEW.trials_status IS DISTINCT FROM OLD.trials_status)
        OR (NEW.ocr_status = 'failed' AND OLD.ocr_status IS DISTINCT FROM 'failed') THEN
        PERFORM pg_notify('island_documents', NEW.island_id::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_notify_island
    AFTER UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION notify_island_documents();
