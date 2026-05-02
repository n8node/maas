-- +goose Up

ALTER TABLE memory_instances DROP CONSTRAINT IF EXISTS memory_instances_memory_type_check;
ALTER TABLE memory_instances ADD CONSTRAINT memory_instances_memory_type_check
    CHECK (memory_type IN ('rag', 'wiki', 'episodic'));

UPDATE plans
SET allowed_memory_types = CASE
    WHEN 'episodic' = ANY (allowed_memory_types) THEN allowed_memory_types
    ELSE allowed_memory_types || ARRAY['episodic']::TEXT[]
END;

-- +goose Down

UPDATE plans
SET allowed_memory_types = array_remove(allowed_memory_types, 'episodic');

ALTER TABLE memory_instances DROP CONSTRAINT IF EXISTS memory_instances_memory_type_check;
ALTER TABLE memory_instances ADD CONSTRAINT memory_instances_memory_type_check
    CHECK (memory_type IN ('rag', 'wiki'));
