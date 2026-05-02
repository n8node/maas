-- +goose Up

ALTER TABLE memory_instances DROP CONSTRAINT IF EXISTS memory_instances_memory_type_check;
ALTER TABLE memory_instances ADD CONSTRAINT memory_instances_memory_type_check
    CHECK (memory_type IN ('rag', 'wiki', 'episodic', 'working'));

UPDATE plans
SET allowed_memory_types = CASE
    WHEN 'working' = ANY (allowed_memory_types) THEN allowed_memory_types
    ELSE allowed_memory_types || ARRAY['working']::TEXT[]
END;

CREATE TABLE working_memory_entries (
    id BIGSERIAL PRIMARY KEY,
    instance_id UUID NOT NULL REFERENCES memory_instances(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (instance_id, session_id, key)
);

CREATE INDEX working_memory_instance_session_idx ON working_memory_entries (instance_id, session_id);

-- +goose Down

DROP TABLE IF EXISTS working_memory_entries;

UPDATE plans
SET allowed_memory_types = array_remove(allowed_memory_types, 'working');

ALTER TABLE memory_instances DROP CONSTRAINT IF EXISTS memory_instances_memory_type_check;
ALTER TABLE memory_instances ADD CONSTRAINT memory_instances_memory_type_check
    CHECK (memory_type IN ('rag', 'wiki', 'episodic'));
