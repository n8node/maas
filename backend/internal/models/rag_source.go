package models

import (
	"time"

	"github.com/google/uuid"
)

type RAGSource struct {
	ID              uuid.UUID
	InstanceID      uuid.UUID
	Filename        string
	ByteSize        int64
	MimeType        string
	EmbeddingModel  string
	TokensTotal     int64
	ChunkCount      int
	CreatedAt       time.Time
}
