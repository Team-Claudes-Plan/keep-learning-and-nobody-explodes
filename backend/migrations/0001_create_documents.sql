CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    etag TEXT,
    filename TEXT,
    content_type TEXT,
    ocr_status TEXT NOT NULL DEFAULT 'queued'
        CHECK (ocr_status IN ('queued', 'processing', 'completed', 'failed')),
    ocr_text TEXT,
    ocr_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bucket, object_key)
);
