-- +goose Up

CREATE TABLE episodic_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES memory_instances(id) ON DELETE CASCADE,
    user_scope TEXT NULL,
    session_scope TEXT NULL,
    content TEXT NOT NULL,
    token_estimate INT NOT NULL DEFAULT 0,
    decay_weight REAL NOT NULL DEFAULT 1.0 CHECK (decay_weight >= 0 AND decay_weight <= 1),
    valid_from TIMESTAMPTZ NULL,
    valid_until TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX episodic_memories_instance_idx ON episodic_memories(instance_id);
CREATE INDEX episodic_memories_scope_idx ON episodic_memories(instance_id, user_scope, session_scope);
CREATE INDEX episodic_memories_fts_idx ON episodic_memories USING gin (to_tsvector('simple', content));

-- +goose Down

DROP TABLE IF EXISTS episodic_memories;
