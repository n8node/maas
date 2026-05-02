-- +goose Up

ALTER TABLE memory_instances DROP CONSTRAINT IF EXISTS memory_instances_memory_type_check;
ALTER TABLE memory_instances ADD CONSTRAINT memory_instances_memory_type_check
    CHECK (memory_type IN ('rag', 'wiki'));

UPDATE plans
SET allowed_memory_types = CASE
    WHEN 'wiki' = ANY (allowed_memory_types) THEN allowed_memory_types
    ELSE allowed_memory_types || ARRAY['wiki']::TEXT[]
END;

CREATE TABLE wiki_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES memory_instances(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wiki_sources_instance_idx ON wiki_sources(instance_id);

CREATE TABLE wiki_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES wiki_sources(id) ON DELETE CASCADE,
    ordinal INT NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    token_estimate INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wiki_segments_source_idx ON wiki_segments(source_id);
CREATE INDEX wiki_segments_fts_idx ON wiki_segments USING gin (to_tsvector('simple', content));

CREATE TABLE wiki_concepts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES memory_instances(id) ON DELETE CASCADE,
    source_id UUID REFERENCES wiki_sources(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'weak', 'archived')),
    confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wiki_concepts_instance_idx ON wiki_concepts(instance_id);

-- +goose Down

DROP TABLE IF EXISTS wiki_concepts;
DROP TABLE IF EXISTS wiki_segments;
DROP TABLE IF EXISTS wiki_sources;

UPDATE plans
SET allowed_memory_types = array_remove(allowed_memory_types, 'wiki');

ALTER TABLE memory_instances DROP CONSTRAINT IF EXISTS memory_instances_memory_type_check;
ALTER TABLE memory_instances ADD CONSTRAINT memory_instances_memory_type_check
    CHECK (memory_type IN ('rag'));
