package billing

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

var (
	ErrTokensExhausted = errors.New("tokens exhausted")
	ErrPlanDeleteInUse = errors.New("plan has subscriptions; cannot delete")
	ErrPlanNotFound    = errors.New("plan not found")
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) EnsureWelcomeSubscription(ctx context.Context, userID uuid.UUID) error {
	var exists bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM subscriptions WHERE user_id = $1 AND status = 'active'
		)`, userID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("check subscription: %w", err)
	}
	if exists {
		return nil
	}
	var planID uuid.UUID
	err = s.pool.QueryRow(ctx, `SELECT id FROM plans WHERE slug = 'free' AND is_archived = false LIMIT 1`).Scan(&planID)
	if err != nil {
		return fmt.Errorf("free plan: %w", err)
	}
	start := time.Now().UTC()
	end := start.AddDate(0, 1, 0)
	var monthly int64
	err = s.pool.QueryRow(ctx, `SELECT monthly_tokens FROM plans WHERE id = $1`, planID).Scan(&monthly)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var subID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
		VALUES ($1, $2, 'active', $3, $4) RETURNING id`,
		userID, planID, start, end).Scan(&subID)
	if err != nil {
		return fmt.Errorf("insert subscription: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO token_balances (user_id, bucket_type, subscription_id, tokens_total, tokens_used, expires_at)
		VALUES ($1, 'plan', $2, $3, 0, $4)`,
		userID, subID, monthly, end)
	if err != nil {
		return fmt.Errorf("insert plan bucket: %w", err)
	}
	return tx.Commit(ctx)
}

func (s *Service) ConsumeTokens(ctx context.Context, userID uuid.UUID, amount int64) error {
	if amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	remaining := amount
	for remaining > 0 {
		var id uuid.UUID
		var total, used int64
		err = tx.QueryRow(ctx, `
			SELECT tb.id, tb.tokens_total, tb.tokens_used
			FROM token_balances tb
			LEFT JOIN subscriptions s ON s.id = tb.subscription_id
			WHERE tb.user_id = $1
			  AND tb.tokens_used < tb.tokens_total
			  AND (tb.expires_at IS NULL OR tb.expires_at > now())
			  AND (
			    tb.bucket_type = 'purchase'
			    OR (tb.bucket_type = 'plan' AND s.status = 'active')
			  )
			ORDER BY CASE tb.bucket_type WHEN 'plan' THEN 0 ELSE 1 END, tb.created_at ASC
			LIMIT 1
			FOR UPDATE OF tb
		`, userID).Scan(&id, &total, &used)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrTokensExhausted
			}
			return err
		}
		avail := total - used
		take := remaining
		if take > avail {
			take = avail
		}
		_, err = tx.Exec(ctx, `
			UPDATE token_balances SET tokens_used = tokens_used + $2 WHERE id = $1`,
			id, take)
		if err != nil {
			return err
		}
		remaining -= take
	}
	return tx.Commit(ctx)
}

type Summary struct {
	Subscription *models.Subscription
	Plan         *models.Plan
	Buckets      []BucketSummary
	TokensLeft   int64
}

type BucketSummary struct {
	ID             uuid.UUID  `json:"id"`
	BucketType     string     `json:"bucket_type"`
	TokensTotal    int64      `json:"tokens_total"`
	TokensUsed     int64      `json:"tokens_used"`
	TokensRemaining int64     `json:"tokens_remaining"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
}

func (s *Service) GetSummary(ctx context.Context, userID uuid.UUID) (*Summary, error) {
	_ = s.EnsureWelcomeSubscription(ctx, userID)

	var sub models.Subscription
	var plan models.Plan
	err := s.pool.QueryRow(ctx, `
		SELECT s.id, s.user_id, s.plan_id, s.status, s.current_period_start, s.current_period_end,
		       s.cancel_at_period_end, s.created_at, s.updated_at,
		       p.id, p.name, p.slug, p.price_monthly_rub, p.price_yearly_rub, p.max_instances,
		       p.monthly_tokens, p.max_storage_mb, p.allowed_memory_types,
		       p.gardener_enabled, p.reflective_enabled, p.bi_temporal_enabled,
		       p.custom_models, p.priority_workers, p.support_level,
		       p.is_public, p.is_archived, p.sort_order, p.created_at, p.updated_at
		FROM subscriptions s
		JOIN plans p ON p.id = s.plan_id
		WHERE s.user_id = $1 AND s.status = 'active'
		LIMIT 1`, userID).Scan(
		&sub.ID, &sub.UserID, &sub.PlanID, &sub.Status, &sub.CurrentPeriodStart, &sub.CurrentPeriodEnd,
		&sub.CancelAtPeriodEnd, &sub.CreatedAt, &sub.UpdatedAt,
		&plan.ID, &plan.Name, &plan.Slug, &plan.PriceMonthlyRUB, &plan.PriceYearlyRUB, &plan.MaxInstances,
		&plan.MonthlyTokens, &plan.MaxStorageMB, &plan.AllowedMemoryTypes,
		&plan.GardenerEnabled, &plan.ReflectiveEnabled, &plan.BiTemporalEnabled,
		&plan.CustomModels, &plan.PriorityWorkers, &plan.SupportLevel,
		&plan.IsPublic, &plan.IsArchived, &plan.SortOrder, &plan.CreatedAt, &plan.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &Summary{Buckets: nil, TokensLeft: 0}, nil
		}
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT tb.id, tb.bucket_type, tb.tokens_total, tb.tokens_used, tb.expires_at
		FROM token_balances tb
		LEFT JOIN subscriptions s ON s.id = tb.subscription_id
		WHERE tb.user_id = $1
		  AND tb.tokens_used < tb.tokens_total
		  AND (tb.expires_at IS NULL OR tb.expires_at > now())
		  AND (
		    tb.bucket_type = 'purchase'
		    OR (tb.bucket_type = 'plan' AND s.status = 'active')
		  )
		ORDER BY CASE tb.bucket_type WHEN 'plan' THEN 0 ELSE 1 END, tb.created_at ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var buckets []BucketSummary
	var totalLeft int64
	for rows.Next() {
		var b BucketSummary
		if err := rows.Scan(&b.ID, &b.BucketType, &b.TokensTotal, &b.TokensUsed, &b.ExpiresAt); err != nil {
			return nil, err
		}
		b.TokensRemaining = b.TokensTotal - b.TokensUsed
		totalLeft += b.TokensRemaining
		buckets = append(buckets, b)
	}
	return &Summary{Subscription: &sub, Plan: &plan, Buckets: buckets, TokensLeft: totalLeft}, rows.Err()
}

type SubscribeInput struct {
	PlanSlug string
}

func (s *Service) Subscribe(ctx context.Context, userID uuid.UUID, in SubscribeInput) error {
	slug := in.PlanSlug
	if slug == "" {
		return fmt.Errorf("plan_slug required")
	}
	var planID uuid.UUID
	var monthly int64
	err := s.pool.QueryRow(ctx, `
		SELECT id, monthly_tokens FROM plans WHERE slug = $1 AND is_archived = false`, slug,
	).Scan(&planID, &monthly)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("unknown plan")
		}
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
		UPDATE subscriptions SET status = 'canceled', updated_at = now()
		WHERE user_id = $1 AND status = 'active'`, userID)
	if err != nil {
		return err
	}
	start := time.Now().UTC()
	end := start.AddDate(0, 1, 0)
	var subID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
		VALUES ($1, $2, 'active', $3, $4) RETURNING id`,
		userID, planID, start, end).Scan(&subID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO token_balances (user_id, bucket_type, subscription_id, tokens_total, tokens_used, expires_at)
		VALUES ($1, 'plan', $2, $3, 0, $4)`,
		userID, subID, monthly, end)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type CancelInput struct {
	CancelAtPeriodEnd bool
}

func (s *Service) Cancel(ctx context.Context, userID uuid.UUID, in CancelInput) error {
	if in.CancelAtPeriodEnd {
		_, err := s.pool.Exec(ctx, `
			UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now()
			WHERE user_id = $1 AND status = 'active'`, userID)
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var sid uuid.UUID
	err = tx.QueryRow(ctx, `
		UPDATE subscriptions SET status = 'canceled', updated_at = now()
		WHERE user_id = $1 AND status = 'active'
		RETURNING id`, userID).Scan(&sid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tx.Commit(ctx)
		}
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM token_balances WHERE subscription_id = $1 AND bucket_type = 'plan'`, sid)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) ListPlansPublic(ctx context.Context) ([]models.Plan, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, slug, price_monthly_rub, price_yearly_rub, max_instances, monthly_tokens, max_storage_mb,
		       allowed_memory_types, gardener_enabled, reflective_enabled, bi_temporal_enabled,
		       custom_models, priority_workers, support_level, is_public, is_archived, sort_order, created_at, updated_at
		FROM plans WHERE is_public = true AND is_archived = false ORDER BY sort_order ASC, name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPlans(rows)
}

func (s *Service) ListPlansAdmin(ctx context.Context) ([]models.Plan, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, slug, price_monthly_rub, price_yearly_rub, max_instances, monthly_tokens, max_storage_mb,
		       allowed_memory_types, gardener_enabled, reflective_enabled, bi_temporal_enabled,
		       custom_models, priority_workers, support_level, is_public, is_archived, sort_order, created_at, updated_at
		FROM plans ORDER BY sort_order ASC, name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPlans(rows)
}

func scanPlans(rows pgx.Rows) ([]models.Plan, error) {
	var out []models.Plan
	for rows.Next() {
		var p models.Plan
		if err := rows.Scan(
			&p.ID, &p.Name, &p.Slug, &p.PriceMonthlyRUB, &p.PriceYearlyRUB, &p.MaxInstances,
			&p.MonthlyTokens, &p.MaxStorageMB, &p.AllowedMemoryTypes,
			&p.GardenerEnabled, &p.ReflectiveEnabled, &p.BiTemporalEnabled,
			&p.CustomModels, &p.PriorityWorkers, &p.SupportLevel,
			&p.IsPublic, &p.IsArchived, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type PlanUpsert struct {
	Name               string
	Slug               string
	PriceMonthlyRUB    int
	PriceYearlyRUB     int
	MaxInstances       int
	MonthlyTokens      int64
	MaxStorageMB       int64
	AllowedMemoryTypes []string
	SortOrder          int
	IsPublic           bool
	IsArchived         bool
}

func (s *Service) AdminCreatePlan(ctx context.Context, in PlanUpsert) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO plans (name, slug, price_monthly_rub, price_yearly_rub, max_instances, monthly_tokens, max_storage_mb,
			allowed_memory_types, sort_order, is_public, is_archived)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
		in.Name, in.Slug, in.PriceMonthlyRUB, in.PriceYearlyRUB, in.MaxInstances, in.MonthlyTokens, in.MaxStorageMB,
		in.AllowedMemoryTypes, in.SortOrder, in.IsPublic, in.IsArchived,
	).Scan(&id)
	return id, err
}

func (s *Service) AdminUpdatePlan(ctx context.Context, id uuid.UUID, in PlanUpsert) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE plans SET
			name = $2, slug = $3, price_monthly_rub = $4, price_yearly_rub = $5,
			max_instances = $6, monthly_tokens = $7, max_storage_mb = $8,
			allowed_memory_types = $9, sort_order = $10, is_public = $11, is_archived = $12,
			updated_at = now()
		WHERE id = $1`,
		id, in.Name, in.Slug, in.PriceMonthlyRUB, in.PriceYearlyRUB, in.MaxInstances, in.MonthlyTokens, in.MaxStorageMB,
		in.AllowedMemoryTypes, in.SortOrder, in.IsPublic, in.IsArchived,
	)
	return err
}

func (s *Service) AdminDeletePlan(ctx context.Context, id uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var n int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM subscriptions WHERE plan_id = $1`, id).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return ErrPlanDeleteInUse
	}
	if _, err := tx.Exec(ctx, `UPDATE payments SET plan_id = NULL WHERE plan_id = $1`, id); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM plans WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrPlanNotFound
	}
	return tx.Commit(ctx)
}

func (s *Service) ListTokenPackages(ctx context.Context, activeOnly bool) ([]models.TokenPackage, error) {
	q := `SELECT id, name, tokens, price_rub, is_active, sort_order, created_at, updated_at FROM token_packages`
	if activeOnly {
		q += ` WHERE is_active = true`
	}
	q += ` ORDER BY sort_order ASC, name ASC`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.TokenPackage
	for rows.Next() {
		var p models.TokenPackage
		if err := rows.Scan(&p.ID, &p.Name, &p.Tokens, &p.PriceRUB, &p.IsActive, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type PackageUpsert struct {
	Name      string
	Tokens    int64
	PriceRUB  int
	SortOrder int
	IsActive  bool
}

func (s *Service) AdminCreatePackage(ctx context.Context, in PackageUpsert) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO token_packages (name, tokens, price_rub, sort_order, is_active)
		VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		in.Name, in.Tokens, in.PriceRUB, in.SortOrder, in.IsActive).Scan(&id)
	return id, err
}

func (s *Service) AdminUpdatePackage(ctx context.Context, id uuid.UUID, in PackageUpsert) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE token_packages SET name=$2, tokens=$3, price_rub=$4, sort_order=$5, is_active=$6, updated_at=now()
		WHERE id=$1`,
		id, in.Name, in.Tokens, in.PriceRUB, in.SortOrder, in.IsActive)
	return err
}

type ManualPaymentInput struct {
	UserID        uuid.UUID
	PackageID     *uuid.UUID
	PlanID        *uuid.UUID
	AmountKopecks int
	Notes         string
}

func (s *Service) RecordManualPayment(ctx context.Context, in ManualPaymentInput) (uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	payType := "manual"
	if in.PackageID != nil {
		payType = "token_package"
	}
	var payID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO payments (user_id, type, amount_kopecks, status, plan_id, package_id, notes, completed_at)
		VALUES ($1, $2, $3, 'completed', $4, $5, $6, now())
		RETURNING id`,
		in.UserID, payType, in.AmountKopecks, in.PlanID, in.PackageID, nullIfEmpty(in.Notes),
	).Scan(&payID)
	if err != nil {
		return uuid.Nil, err
	}
	if in.PackageID != nil {
		var tok int64
		err = tx.QueryRow(ctx, `SELECT tokens FROM token_packages WHERE id = $1 AND is_active = true`, *in.PackageID).Scan(&tok)
		if err != nil {
			return uuid.Nil, fmt.Errorf("package: %w", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO token_balances (user_id, bucket_type, subscription_id, payment_id, tokens_total, tokens_used, expires_at)
			VALUES ($1, 'purchase', NULL, $2, $3, 0, NULL)`,
			in.UserID, payID, tok)
		if err != nil {
			return uuid.Nil, err
		}
	}
	return payID, tx.Commit(ctx)
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// MarshalMetadata helper for payments list - skip for MVP

func (s *Service) ListPaymentsUser(ctx context.Context, userID uuid.UUID, limit int) ([]paymentRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, type, amount_kopecks, currency, status, created_at, completed_at, notes
		FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []paymentRow
	for rows.Next() {
		var r paymentRow
		if err := rows.Scan(&r.ID, &r.Type, &r.AmountKopecks, &r.Currency, &r.Status, &r.CreatedAt, &r.CompletedAt, &r.Notes); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type paymentRow struct {
	ID            uuid.UUID  `json:"id"`
	Type          string     `json:"type"`
	AmountKopecks int        `json:"amount_kopecks"`
	Currency      string     `json:"currency"`
	Status        string     `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
	CompletedAt   *time.Time `json:"completed_at,omitempty"`
	Notes         *string    `json:"notes,omitempty"`
}

func (s *Service) ListPaymentsAdmin(ctx context.Context, limit int) ([]paymentAdminRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, type, amount_kopecks, currency, status, created_at, completed_at, notes
		FROM payments ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []paymentAdminRow
	for rows.Next() {
		var r paymentAdminRow
		if err := rows.Scan(&r.ID, &r.UserID, &r.Type, &r.AmountKopecks, &r.Currency, &r.Status, &r.CreatedAt, &r.CompletedAt, &r.Notes); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type paymentAdminRow struct {
	ID            uuid.UUID  `json:"id"`
	UserID        uuid.UUID  `json:"user_id"`
	Type          string     `json:"type"`
	AmountKopecks int        `json:"amount_kopecks"`
	Currency      string     `json:"currency"`
	Status        string     `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
	CompletedAt   *time.Time `json:"completed_at,omitempty"`
	Notes         *string    `json:"notes,omitempty"`
}

// PlanToJSON maps plan to API shape
func PlanToJSON(p models.Plan) map[string]any {
	return map[string]any{
		"id":                    p.ID.String(),
		"name":                  p.Name,
		"slug":                  p.Slug,
		"price_monthly_rub":     p.PriceMonthlyRUB,
		"price_yearly_rub":      p.PriceYearlyRUB,
		"max_instances":         p.MaxInstances,
		"monthly_tokens":        p.MonthlyTokens,
		"max_storage_mb":        p.MaxStorageMB,
		"allowed_memory_types":  p.AllowedMemoryTypes,
		"gardener_enabled":      p.GardenerEnabled,
		"reflective_enabled":    p.ReflectiveEnabled,
		"bi_temporal_enabled":   p.BiTemporalEnabled,
		"custom_models":         p.CustomModels,
		"priority_workers":      p.PriorityWorkers,
		"support_level":         p.SupportLevel,
		"is_public":             p.IsPublic,
		"is_archived":           p.IsArchived,
		"sort_order":            p.SortOrder,
		"created_at":            p.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updated_at":            p.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}
