-- +goose Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'superadmin'));

ALTER TABLE api_keys ADD CONSTRAINT api_keys_key_prefix_key UNIQUE (key_prefix);

-- +goose Down
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_key_prefix_key;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users DROP COLUMN IF EXISTS role;
