-- +goose Up

-- Scoping: isolate sources per end-user (Wiki extensions)
ALTER TABLE wiki_sources ADD COLUMN IF NOT EXISTS user_scope TEXT NULL;
CREATE INDEX IF NOT EXISTS wiki_sources_instance_user_idx ON wiki_sources(instance_id, user_scope);

ALTER TABLE wiki_concepts ADD COLUMN IF NOT EXISTS concept_type TEXT NOT NULL DEFAULT 'fact';

ALTER TABLE wiki_concepts DROP CONSTRAINT IF EXISTS wiki_concepts_state_check;
ALTER TABLE wiki_concepts ADD CONSTRAINT wiki_concepts_state_check
  CHECK (state IN ('active', 'weak', 'archived', 'stale', 'disputed'));

CREATE TABLE wiki_action_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES memory_instances(id) ON DELETE CASCADE,
    actor TEXT NOT NULL DEFAULT 'system',
    action TEXT NOT NULL,
    target_kind TEXT NOT NULL DEFAULT '',
    target_id UUID NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    rationale TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wiki_action_log_instance_idx ON wiki_action_log(instance_id, created_at DESC);

CREATE TABLE wiki_gardener_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES memory_instances(id) ON DELETE CASCADE,
    proposal_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ NULL,
    CONSTRAINT wiki_gardener_proposals_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'dismissed'))
);

CREATE INDEX wiki_gardener_proposals_instance_idx ON wiki_gardener_proposals(instance_id, status, created_at DESC);

-- +goose Down

DROP TABLE IF EXISTS wiki_gardener_proposals;
DROP TABLE IF EXISTS wiki_action_log;

ALTER TABLE wiki_concepts DROP CONSTRAINT IF EXISTS wiki_concepts_state_check;
ALTER TABLE wiki_concepts ADD CONSTRAINT wiki_concepts_state_check
  CHECK (state IN ('active', 'weak', 'archived'));

ALTER TABLE wiki_concepts DROP COLUMN IF EXISTS concept_type;

DROP INDEX IF EXISTS wiki_sources_instance_user_idx;
ALTER TABLE wiki_sources DROP COLUMN IF EXISTS user_scope;
