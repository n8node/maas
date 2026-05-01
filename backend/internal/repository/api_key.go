package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/n8node/maas/backend/internal/models"
)

type APIKeyRepo struct {
	pool *pgxpool.Pool
}

func NewAPIKeyRepo(pool *pgxpool.Pool) *APIKeyRepo {
	return &APIKeyRepo{pool: pool}
}

func (r *APIKeyRepo) Create(ctx context.Context, userID uuid.UUID, name, keyHash, keyPrefix string) (*models.APIKey, error) {
	id := uuid.New()
	q := `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, user_id, name, key_hash, key_prefix, created_at, last_used_at`
	row := r.pool.QueryRow(ctx, q, id, userID, name, keyHash, keyPrefix)
	var k models.APIKey
	if err := row.Scan(&k.ID, &k.UserID, &k.Name, &k.KeyHash, &k.KeyPrefix, &k.CreatedAt, &k.LastUsedAt); err != nil {
		return nil, fmt.Errorf("insert api_key: %w", err)
	}
	return &k, nil
}

func (r *APIKeyRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]models.APIKey, error) {
	q := `SELECT id, user_id, name, key_hash, key_prefix, created_at, last_used_at
		FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("list api_keys: %w", err)
	}
	defer rows.Close()
	var out []models.APIKey
	for rows.Next() {
		var k models.APIKey
		if err := rows.Scan(&k.ID, &k.UserID, &k.Name, &k.KeyHash, &k.KeyPrefix, &k.CreatedAt, &k.LastUsedAt); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (r *APIKeyRepo) Delete(ctx context.Context, userID, keyID uuid.UUID) (bool, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM api_keys WHERE id = $1 AND user_id = $2`, keyID, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (r *APIKeyRepo) FindByKeyPrefix(ctx context.Context, prefix string) (*models.APIKey, error) {
	q := `SELECT id, user_id, name, key_hash, key_prefix, created_at, last_used_at FROM api_keys WHERE key_prefix = $1`
	row := r.pool.QueryRow(ctx, q, prefix)
	var k models.APIKey
	if err := row.Scan(&k.ID, &k.UserID, &k.Name, &k.KeyHash, &k.KeyPrefix, &k.CreatedAt, &k.LastUsedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &k, nil
}

func (r *APIKeyRepo) Touch(ctx context.Context, keyID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE api_keys SET last_used_at = $2 WHERE id = $1`, keyID, time.Now().UTC())
	return err
}
