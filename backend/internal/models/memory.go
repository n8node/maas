package models

import (
	"time"

	"github.com/google/uuid"
)

type MemoryInstance struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Name        string
	MemoryType  string
	Status      string
	Config      map[string]any
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type RAGChunk struct {
	ID            uuid.UUID
	InstanceID    uuid.UUID
	UserScope     *string
	SourceLabel   string
	Content       string
	TokenEstimate int
	CreatedAt     time.Time
}
