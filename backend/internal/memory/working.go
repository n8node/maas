package memory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/n8node/maas/backend/internal/models"
)

var (
	ErrWorkingType       = errors.New("instance must be working memory")
	ErrWorkingKeyLimit   = errors.New("max keys per session reached")
	ErrWorkingJSONValue  = errors.New("value must be valid JSON")
	ErrWorkingEmptyKey   = errors.New("key must not be empty")
	ErrWorkingEmptyValue = errors.New("value is required")
)

// WorkingStats is returned by GET .../working/stats (dashboard KPIs).
type WorkingStats struct {
	SessionsTotal       int     `json:"sessions_total"`
	SessionsActive      int     `json:"sessions_active"`
	KeysTotal           int     `json:"keys_total"`
	DefaultTTLMinutes   int     `json:"default_ttl_minutes"`
	DefaultTTLLabel     string  `json:"default_ttl_label"`
	MaxTTLLabel         string  `json:"max_ttl_label"`
	HitRatePct          *int    `json:"hit_rate_pct,omitempty"`
	StorageUsedBytes    int64   `json:"storage_used_bytes"`
	MaxStorageMB        int64   `json:"max_storage_mb"`
}

type WorkingSessionRow struct {
	SessionID    string    `json:"session_id"`
	ScopeUserID  string    `json:"scope_user_id"`
	KeyCount     int       `json:"key_count"`
	LastActiveAt time.Time `json:"last_active_at"`
	Status       string    `json:"status"` // Active | Expiring | Expired
}

type WorkingKeyRow struct {
	Key         string          `json:"key"`
	Value       json.RawMessage `json:"value"`
	ExpiresAt   *time.Time      `json:"expires_at"`
	IsCore      bool            `json:"is_core"`
	ScopeUserID string          `json:"scope_user_id"`
}

type WorkingPutInput struct {
	Value         json.RawMessage
	TTLSeconds    *int64
	ScopeUserID   *string
}

func workingParseConfig(cfg map[string]any) (defaultMin int, maxCeiling string, maxKeys int) {
	defaultMin = 15
	maxCeiling = "24h"
	maxKeys = 100
	if cfg == nil {
		return
	}
	if ttl, ok := cfg["ttl"].(map[string]any); ok {
		if v, ok := ttl["default_minutes"].(float64); ok {
			defaultMin = int(v)
		}
		if s, ok := ttl["max_ceiling"].(string); ok && strings.TrimSpace(s) != "" {
			maxCeiling = strings.TrimSpace(s)
		}
	}
	if lim, ok := cfg["limits"].(map[string]any); ok {
		if v, ok := lim["max_keys_per_session"].(float64); ok {
			maxKeys = int(v)
		}
	}
	return
}

func workingMaxTTLSeconds(ceiling string) int64 {
	switch strings.ToLower(strings.TrimSpace(ceiling)) {
	case "4h":
		return 4 * 3600
	case "24h":
		return 24 * 3600
	case "72h":
		return 72 * 3600
	case "none":
		return 86400 * 365 * 10 // soft cap 10y
	default:
		return 24 * 3600
	}
}

func workingFormatTTLLabel(minutes int) string {
	if minutes >= 60 && minutes%60 == 0 {
		h := minutes / 60
		if h == 1 {
			return "1h"
		}
		return fmt.Sprintf("%dh", h)
	}
	if minutes == 1 {
		return "1m"
	}
	return fmt.Sprintf("%dm", minutes)
}

func workingMaxTTLDisplay(ceiling string) string {
	switch strings.ToLower(strings.TrimSpace(ceiling)) {
	case "4h":
		return "max: 4h"
	case "24h":
		return "max: 24h"
	case "72h":
		return "max: 72h"
	case "none":
		return "no ceiling"
	default:
		return "max: 24h"
	}
}

func (s *Service) workingGetInstance(ctx context.Context, userID, instanceID uuid.UUID) (*models.MemoryInstance, error) {
	m, err := s.Get(ctx, userID, instanceID)
	if err != nil {
		return nil, err
	}
	if m.MemoryType != "working" {
		return nil, ErrWorkingType
	}
	return m, nil
}

// WorkingStats aggregates row counts and config defaults for the dashboard.
func (s *Service) WorkingStats(ctx context.Context, userID, instanceID uuid.UUID) (*WorkingStats, error) {
	m, err := s.workingGetInstance(ctx, userID, instanceID)
	if err != nil {
		return nil, err
	}
	defMin, maxCeil, _ := workingParseConfig(m.Config)

	var sessionsTotal, sessionsActive, keysTotal int
	var storageBytes int64
	err = s.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(DISTINCT session_id) FROM working_memory_entries WHERE instance_id = $1),
			(SELECT COUNT(*) FROM (
				SELECT session_id FROM working_memory_entries WHERE instance_id = $1
				GROUP BY session_id
				HAVING BOOL_OR(expires_at IS NULL OR expires_at > now())
			) t),
			(SELECT COUNT(*)::int FROM working_memory_entries WHERE instance_id = $1),
			(SELECT COALESCE(SUM(pg_column_size(value) + pg_column_size(key) + pg_column_size(session_id)), 0)::bigint FROM working_memory_entries WHERE instance_id = $1)
	`, instanceID).Scan(&sessionsTotal, &sessionsActive, &keysTotal, &storageBytes)
	if err != nil {
		return nil, err
	}

	return &WorkingStats{
		SessionsTotal:     sessionsTotal,
		SessionsActive:    sessionsActive,
		KeysTotal:         keysTotal,
		DefaultTTLMinutes: defMin,
		DefaultTTLLabel:   workingFormatTTLLabel(defMin),
		MaxTTLLabel:       workingMaxTTLDisplay(maxCeil),
		HitRatePct:        nil,
		StorageUsedBytes:  storageBytes,
		MaxStorageMB:      0,
	}, nil
}

// WorkingListSessions returns grouped session rows for the Sessions tab.
func (s *Service) WorkingListSessions(ctx context.Context, userID, instanceID uuid.UUID, search, filter string) ([]WorkingSessionRow, error) {
	if _, err := s.workingGetInstance(ctx, userID, instanceID); err != nil {
		return nil, err
	}
	search = strings.TrimSpace(search)
	activeOnly := strings.EqualFold(strings.TrimSpace(filter), "active")

	q := `
		SELECT session_id,
			COALESCE(MAX(NULLIF(TRIM(scope_user_id), '')), '') AS scope_uid,
			COUNT(*)::int AS key_count,
			MAX(updated_at) AS last_active,
			BOOL_OR(expires_at IS NULL OR expires_at > now()) AS has_active,
			BOOL_OR(expires_at IS NOT NULL AND expires_at > now() AND expires_at <= now() + interval '15 minutes') AS expiring_soon
		FROM working_memory_entries
		WHERE instance_id = $1
		  AND ($2 = '' OR session_id ILIKE '%' || $2 || '%' OR COALESCE(scope_user_id, '') ILIKE '%' || $2 || '%')
		GROUP BY session_id
	`
	if activeOnly {
		q += ` HAVING BOOL_OR(expires_at IS NULL OR expires_at > now())`
	}
	q += ` ORDER BY MAX(updated_at) DESC LIMIT 500`

	rows, err := s.pool.Query(ctx, q, instanceID, search)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []WorkingSessionRow
	for rows.Next() {
		var sid, scopeUID string
		var kc int
		var lastActive time.Time
		var hasActive, expiringSoon bool
		if err := rows.Scan(&sid, &scopeUID, &kc, &lastActive, &hasActive, &expiringSoon); err != nil {
			return nil, err
		}
		st := "Expired"
		if hasActive {
			st = "Active"
			if expiringSoon {
				st = "Expiring"
			}
		}
		out = append(out, WorkingSessionRow{
			SessionID:    sid,
			ScopeUserID:  scopeUID,
			KeyCount:     kc,
			LastActiveAt: lastActive,
			Status:       st,
		})
	}
	return out, rows.Err()
}

// WorkingListKeys lists keys for one session (Keys tab).
func (s *Service) WorkingListKeys(ctx context.Context, userID, instanceID uuid.UUID, sessionID, keyPrefix string) ([]WorkingKeyRow, error) {
	if _, err := s.workingGetInstance(ctx, userID, instanceID); err != nil {
		return nil, err
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("session_id required")
	}
	keyPrefix = strings.TrimSpace(keyPrefix)

	q := `
		SELECT key, value, expires_at, (key = '__core__') AS is_core, COALESCE(scope_user_id, '')
		FROM working_memory_entries
		WHERE instance_id = $1 AND session_id = $2
		  AND ($3 = '' OR key ILIKE '%' || $3 || '%')
		ORDER BY key = '__core__' DESC, key ASC
	`
	rows, err := s.pool.Query(ctx, q, instanceID, sessionID, keyPrefix)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []WorkingKeyRow
	for rows.Next() {
		var r WorkingKeyRow
		var raw []byte
		if err := rows.Scan(&r.Key, &raw, &r.ExpiresAt, &r.IsCore, &r.ScopeUserID); err != nil {
			return nil, err
		}
		r.Value = json.RawMessage(raw)
		out = append(out, r)
	}
	return out, rows.Err()
}

// WorkingPutKey inserts or updates a key.
func (s *Service) WorkingPutKey(ctx context.Context, userID, instanceID uuid.UUID, sessionID, key string, in WorkingPutInput) error {
	m, err := s.workingGetInstance(ctx, userID, instanceID)
	if err != nil {
		return err
	}
	sessionID = strings.TrimSpace(sessionID)
	key = strings.TrimSpace(key)
	if sessionID == "" || key == "" {
		return ErrWorkingEmptyKey
	}
	if len(in.Value) == 0 {
		return ErrWorkingEmptyValue
	}
	if !json.Valid(in.Value) {
		return ErrWorkingJSONValue
	}

	defMin, maxCeil, maxKeys := workingParseConfig(m.Config)
	maxSecs := workingMaxTTLSeconds(maxCeil)

	var exp *time.Time
	if key == "__core__" || sessionID == "__persistent__" {
		exp = nil
	} else {
		var secs int64
		if in.TTLSeconds != nil && *in.TTLSeconds >= 0 {
			secs = *in.TTLSeconds
		} else {
			secs = int64(defMin) * 60
		}
		if secs > maxSecs {
			secs = maxSecs
		}
		if secs <= 0 {
			exp = nil
		} else {
			t := time.Now().UTC().Add(time.Duration(secs) * time.Second)
			exp = &t
		}
	}

	var scopePtr *string
	if in.ScopeUserID != nil {
		su := strings.TrimSpace(*in.ScopeUserID)
		if su != "" {
			scopePtr = &su
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var cnt int
	err = tx.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM working_memory_entries
		WHERE instance_id = $1 AND session_id = $2`, instanceID, sessionID).Scan(&cnt)
	if err != nil {
		return err
	}

	var keyExists bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM working_memory_entries
			WHERE instance_id = $1 AND session_id = $2 AND key = $3
		)`, instanceID, sessionID, key).Scan(&keyExists); err != nil {
		return err
	}

	if !keyExists && maxKeys > 0 && cnt >= maxKeys {
		return ErrWorkingKeyLimit
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO working_memory_entries (instance_id, session_id, key, value, expires_at, scope_user_id, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, now())
		ON CONFLICT (instance_id, session_id, key) DO UPDATE SET
			value = EXCLUDED.value,
			expires_at = EXCLUDED.expires_at,
			scope_user_id = COALESCE(EXCLUDED.scope_user_id, working_memory_entries.scope_user_id),
			updated_at = now()`,
		instanceID, sessionID, key, in.Value, exp, scopePtr)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// WorkingDeleteKey removes one key.
func (s *Service) WorkingDeleteKey(ctx context.Context, userID, instanceID uuid.UUID, sessionID, key string) error {
	if _, err := s.workingGetInstance(ctx, userID, instanceID); err != nil {
		return err
	}
	ct, err := s.pool.Exec(ctx, `
		DELETE FROM working_memory_entries
		WHERE instance_id = $1 AND session_id = $2 AND key = $3`,
		instanceID, strings.TrimSpace(sessionID), strings.TrimSpace(key))
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// WorkingDeleteSession removes all keys in a session.
func (s *Service) WorkingDeleteSession(ctx context.Context, userID, instanceID uuid.UUID, sessionID string) error {
	if _, err := s.workingGetInstance(ctx, userID, instanceID); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `
		DELETE FROM working_memory_entries WHERE instance_id = $1 AND session_id = $2`,
		instanceID, strings.TrimSpace(sessionID))
	return err
}

// WorkingFlushExpired deletes expired rows.
func (s *Service) WorkingFlushExpired(ctx context.Context, userID, instanceID uuid.UUID) (int64, error) {
	if _, err := s.workingGetInstance(ctx, userID, instanceID); err != nil {
		return 0, err
	}
	ct, err := s.pool.Exec(ctx, `
		DELETE FROM working_memory_entries
		WHERE instance_id = $1
		  AND expires_at IS NOT NULL
		  AND expires_at <= now()`, instanceID)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}
