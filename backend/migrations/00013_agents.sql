-- +goose Up
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    config JSONB NOT NULL DEFAULT '{"merge_strategy": "all", "max_context_tokens": 8000}'::JSONB,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX agents_user_idx ON agents(user_id);

CREATE TABLE agent_layers (
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    instance_id UUID NOT NULL REFERENCES memory_instances(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT '',
    priority INT NOT NULL DEFAULT 1,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, instance_id)
);

CREATE INDEX agent_layers_instance_idx ON agent_layers(instance_id);

ALTER TABLE memory_instances ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS memory_instances_agent_id_idx ON memory_instances(agent_id) WHERE agent_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS memory_instances_agent_id_idx;

ALTER TABLE memory_instances DROP COLUMN IF EXISTS agent_id;

DROP TABLE IF EXISTS agent_layers;

DROP TABLE IF EXISTS agents;
