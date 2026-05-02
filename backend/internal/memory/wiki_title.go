package memory

// PostgreSQL expressions for canonical wiki title comparison (collapse whitespace, lowercase).
// Used for heuristic duplicate detection, ingest dedupe, and health purity metrics.
const (
	wikiTitleNormSQLCol = `lower(trim(regexp_replace(title, E'\\s+', ' ', 'g')))`
	wikiTitleNormSQLArg = `lower(trim(regexp_replace($2::text, E'\\s+', ' ', 'g')))`
)
