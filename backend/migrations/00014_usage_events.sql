-- +goose Up

CREATE TABLE IF NOT EXISTS usage_events (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation TEXT NOT NULL,
    tokens BIGINT NOT NULL CHECK (tokens > 0),
    memory_instance_id UUID REFERENCES memory_instances(id) ON DELETE SET NULL,
    memory_type TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_user_created_idx ON usage_events (user_id, created_at DESC);

-- +goose Down

DROP INDEX IF EXISTS usage_events_user_created_idx;
DROP TABLE IF EXISTS usage_events;
