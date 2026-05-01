package migrations

import "embed"

// FS holds goose SQL migration files.
//
//go:embed *.sql
var FS embed.FS
