package models

import (
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID           uuid.UUID
	Email        string
	Role         string
	PasswordHash string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type APIKey struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Name        string
	KeyPrefix   string
	KeyHash     string
	CreatedAt   time.Time
	LastUsedAt  *time.Time
}
