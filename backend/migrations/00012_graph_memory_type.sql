-- +goose Up
ALTER TABLE memory_instances DROP CONSTRAINT IF EXISTS memory_instances_memory_type_check;
ALTER TABLE memory_instances ADD CONSTRAINT memory_instances_memory_type_check
    CHECK (memory_type IN ('rag', 'wiki', 'episodic', 'working', 'graph'));

UPDATE plans
SET allowed_memory_types = CASE
    WHEN 'graph' = ANY (allowed_memory_types) THEN allowed_memory_types
    ELSE allowed_memory_types || ARRAY['graph']::TEXT[]
END;

-- +goose Down
UPDATE plans
SET allowed_memory_types = array_remove(allowed_memory_types, 'graph');

ALTER TABLE memory_instances DROP CONSTRAINT IF EXISTS memory_instances_memory_type_check;
ALTER TABLE memory_instances ADD CONSTRAINT memory_instances_memory_type_check
    CHECK (memory_type IN ('rag', 'wiki', 'episodic', 'working'));
