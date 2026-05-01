package models

import (
	"time"

	"github.com/google/uuid"
)

type Plan struct {
	ID                  uuid.UUID
	Name                string
	Slug                string
	PriceMonthlyRUB     int
	PriceYearlyRUB      int
	MaxInstances        int
	MonthlyTokens       int64
	MaxStorageMB        int64
	AllowedMemoryTypes  []string
	GardenerEnabled     bool
	ReflectiveEnabled   bool
	BiTemporalEnabled   bool
	CustomModels        bool
	PriorityWorkers     bool
	SupportLevel        string
	IsPublic            bool
	IsArchived          bool
	SortOrder           int
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type Subscription struct {
	ID                   uuid.UUID
	UserID               uuid.UUID
	PlanID               uuid.UUID
	Status               string
	CurrentPeriodStart   time.Time
	CurrentPeriodEnd     time.Time
	CancelAtPeriodEnd    bool
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

type TokenBalance struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	BucketType      string
	SubscriptionID  *uuid.UUID
	PaymentID       *uuid.UUID
	TokensTotal     int64
	TokensUsed      int64
	ExpiresAt       *time.Time
	CreatedAt       time.Time
}

type TokenPackage struct {
	ID        uuid.UUID
	Name      string
	Tokens    int64
	PriceRUB  int
	IsActive  bool
	SortOrder int
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Payment struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	Type           string
	AmountKopecks  int
	Currency       string
	Status         string
	PlanID         *uuid.UUID
	PackageID      *uuid.UUID
	ExternalID     *string
	Notes          *string
	Metadata       map[string]any
	CreatedAt      time.Time
	CompletedAt    *time.Time
}
