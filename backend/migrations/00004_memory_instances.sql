-- +goose Up
CREATE TABLE memory_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    memory_type TEXT NOT NULL CHECK (memory_type IN ('rag')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX memory_instances_user_idx ON memory_instances(user_id);
CREATE INDEX memory_instances_user_active_idx ON memory_instances(user_id) WHERE status = 'active';

CREATE TABLE rag_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES memory_instances(id) ON DELETE CASCADE,
    user_scope TEXT,
    source_label TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    token_estimate INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rag_chunks_instance_idx ON rag_chunks(instance_id);
CREATE INDEX rag_chunks_fts_idx ON rag_chunks USING gin (to_tsvector('simple', content));

-- +goose Down
DROP TABLE IF EXISTS rag_chunks;
DROP TABLE IF EXISTS memory_instances;
