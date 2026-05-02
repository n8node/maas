-- +goose Up
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE rag_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES memory_instances(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    byte_size BIGINT NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    embedding_model TEXT NOT NULL DEFAULT '',
    tokens_total BIGINT NOT NULL DEFAULT 0,
    chunk_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rag_sources_instance_idx ON rag_sources(instance_id);
CREATE INDEX rag_sources_instance_created_idx ON rag_sources(instance_id, created_at DESC);

ALTER TABLE rag_chunks ADD COLUMN source_id UUID REFERENCES rag_sources(id) ON DELETE CASCADE;
-- text-embedding-3-small / ada-002 dimension
ALTER TABLE rag_chunks ADD COLUMN embedding vector(1536);

CREATE INDEX rag_chunks_source_idx ON rag_chunks(source_id) WHERE source_id IS NOT NULL;

-- Cosine similarity search (requires rows before IVFFlat is useful; safe on empty table in pgvector)
CREATE INDEX rag_chunks_embedding_ivf_idx ON rag_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
  WHERE embedding IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS rag_chunks_embedding_ivf_idx;
DROP INDEX IF EXISTS rag_chunks_source_idx;
ALTER TABLE rag_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE rag_chunks DROP COLUMN IF EXISTS source_id;
DROP TABLE IF EXISTS rag_sources;
