-- +goose Up
ALTER TABLE working_memory_entries ADD COLUMN IF NOT EXISTS scope_user_id TEXT;
CREATE INDEX IF NOT EXISTS working_memory_scope_idx ON working_memory_entries (instance_id, scope_user_id);

-- +goose Down
DROP INDEX IF EXISTS working_memory_scope_idx;
ALTER TABLE working_memory_entries DROP COLUMN IF EXISTS scope_user_id;
