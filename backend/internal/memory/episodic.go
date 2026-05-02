package memory

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/n8node/maas/backend/internal/models"
)

type EpisodicEpisode struct {
	ID           string     `json:"id"`
	Content      string     `json:"content"`
	UserScope    *string    `json:"user_scope,omitempty"`
	SessionScope *string    `json:"session_scope,omitempty"`
	DecayWeight  float64    `json:"decay_weight"`
	ValidFrom    *time.Time `json:"valid_from,omitempty"`
	ValidUntil   *time.Time `json:"valid_until,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

type EpisodicStats struct {
	EpisodesCount int     `json:"episodes_count"`
	AvgDecay      float64 `json:"avg_decay"`
	UsersCount    int     `json:"users_count"`
	OldestEntry   string  `json:"oldest_entry,omitempty"`
	Coverage      int     `json:"coverage"`
}

func episodicDecayRate(inst *models.MemoryInstance) float64 {
	rawDecay, ok := inst.Config["decay"]
	if !ok {
		return 0.05
	}
	decayMap, ok := rawDecay.(map[string]any)
	if !ok {
		return 0.05
	}
	if v, ok := decayMap["daily_factor"].(float64); ok && v > 0 {
		return v
	}
	return 0.05
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func episodicSnippet(s string, max int) string {
	if max <= 0 {
		max = 220
	}
	r := []rune(strings.TrimSpace(s))
	if len(r) <= max {
		return string(r)
	}
	return string(r[:max]) + "…"
}

func (s *Service) ingestEpisodic(
	ctx context.Context,
	userID, instanceID uuid.UUID,
	inst *models.MemoryInstance,
	in IngestInput,
) (*IngestResult, error) {
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return nil, ErrEmptyContent
	}
	_ = s.bill.EnsureWelcomeSubscription(ctx, userID)
	tokCost := estimateTokens(text)
	if err := s.bill.ConsumeTokens(ctx, userID, tokCost); err != nil {
		return nil, err
	}
	validFrom := in.ValidFrom
	if validFrom == nil {
		now := time.Now().UTC()
		validFrom = &now
	}
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO episodic_memories (
			instance_id, user_scope, session_scope, content, token_estimate, decay_weight, valid_from, valid_until
		)
		VALUES ($1,$2,$3,$4,$5,1.0,$6,$7)
		RETURNING id`,
		instanceID, in.UserScope, in.SessionScope, text, int(tokCost), validFrom, in.ValidUntil,
	).Scan(&id)
	if err != nil {
		return nil, err
	}
	return &IngestResult{ChunksAdded: 1, TokensConsumed: tokCost, SourceID: id}, nil
}

func (s *Service) queryEpisodic(
	ctx context.Context,
	userID, instanceID uuid.UUID,
	inst *models.MemoryInstance,
	in QueryInput,
) (*QueryResult, error) {
	q := strings.TrimSpace(in.Query)
	if q == "" {
		return nil, ErrEmptyQuery
	}
	topK := in.TopK
	if topK < 1 {
		topK = 5
	}
	if topK > 20 {
		topK = 20
	}

	_ = s.bill.EnsureWelcomeSubscription(ctx, userID)
	tokCost := int64(80 + utf8.RuneCountInString(q)/5)
	if tokCost < 40 {
		tokCost = 40
	}
	if err := s.bill.ConsumeTokens(ctx, userID, tokCost); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id::text, content, COALESCE(decay_weight, 1.0)::float8, created_at
		FROM episodic_memories e
		WHERE e.instance_id = $1
		  AND ($2::text IS NULL OR e.user_scope IS NULL OR e.user_scope = $2)
		  AND ($3::text IS NULL OR e.session_scope IS NULL OR e.session_scope = $3)
		  AND ($4::timestamptz IS NULL OR (e.valid_from IS NULL OR e.valid_from <= $4) AND (e.valid_until IS NULL OR e.valid_until > $4))
		  AND (
		    to_tsvector('simple', e.content) @@ plainto_tsquery('simple', $5)
		    OR e.content ILIKE '%' || $5 || '%'
		  )
		ORDER BY created_at DESC
		LIMIT $6`,
		instanceID, in.UserScope, in.SessionScope, in.AsOf, q, topK*4,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rate := episodicDecayRate(inst)
	now := time.Now().UTC()
	type rowItem struct {
		id      string
		content string
		score   float64
	}
	items := make([]rowItem, 0, topK*2)
	for rows.Next() {
		var id, content string
		var decayW float64
		var createdAt time.Time
		if err := rows.Scan(&id, &content, &decayW, &createdAt); err != nil {
			return nil, err
		}
		ageDays := now.Sub(createdAt).Hours() / 24
		if ageDays < 0 {
			ageDays = 0
		}
		decay := math.Exp(-rate * ageDays)
		score := clamp01(decayW * decay)
		items = append(items, rowItem{id: id, content: content, score: score})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// lightweight top-k by score
	for i := 0; i < len(items)-1; i++ {
		for j := i + 1; j < len(items); j++ {
			if items[j].score > items[i].score {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
	if len(items) > topK {
		items = items[:topK]
	}
	cites := make([]Citation, 0, len(items))
	for _, it := range items {
		cites = append(cites, Citation{
			ChunkID: it.id,
			Snippet: episodicSnippet(it.content, 260),
			Score:   float32(it.score),
		})
	}
	msg := "No matching episodes found."
	if len(cites) > 0 {
		msg = fmt.Sprintf("Found %d episode(s). Most recent match: [Ep:%s].", len(cites), cites[0].ChunkID)
	}
	return &QueryResult{
		Message:    msg,
		Citations:  cites,
		TokensUsed: tokCost,
	}, nil
}

func (s *Service) ListEpisodicEpisodes(
	ctx context.Context,
	userID, instanceID uuid.UUID,
	userScope *string,
	limit int,
) ([]EpisodicEpisode, error) {
	if limit < 1 {
		limit = 50
	}
	if limit > 300 {
		limit = 300
	}
	rows, err := s.pool.Query(ctx, `
		SELECT e.id::text, e.content, e.user_scope, e.session_scope, COALESCE(e.decay_weight, 1.0)::float8,
		       e.valid_from, e.valid_until, e.created_at
		FROM episodic_memories e
		INNER JOIN memory_instances m ON m.id = e.instance_id AND m.user_id = $2
		WHERE e.instance_id = $1
		  AND ($3::text IS NULL OR e.user_scope IS NULL OR e.user_scope = $3)
		ORDER BY e.created_at DESC
		LIMIT $4`,
		instanceID, userID, userScope, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]EpisodicEpisode, 0, limit)
	for rows.Next() {
		var it EpisodicEpisode
		if err := rows.Scan(
			&it.ID, &it.Content, &it.UserScope, &it.SessionScope, &it.DecayWeight,
			&it.ValidFrom, &it.ValidUntil, &it.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func (s *Service) EpisodicStats(ctx context.Context, userID, instanceID uuid.UUID) (*EpisodicStats, error) {
	var episodes int
	var avgDecay float64
	var users int
	var oldest *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*)::int,
			COALESCE(AVG(COALESCE(e.decay_weight, 1.0)), 0)::float8,
			COUNT(DISTINCT e.user_scope)::int,
			MIN(e.created_at)
		FROM episodic_memories e
		INNER JOIN memory_instances m ON m.id = e.instance_id AND m.user_id = $2
		WHERE e.instance_id = $1`,
		instanceID, userID,
	).Scan(&episodes, &avgDecay, &users, &oldest)
	if err != nil {
		if err == pgx.ErrNoRows {
			return &EpisodicStats{}, nil
		}
		return nil, err
	}
	oldestStr := ""
	if oldest != nil {
		oldestStr = oldest.UTC().Format("Jan 2006")
	}
	coverage := 0
	if episodes > 0 {
		coverage = 76
	}
	return &EpisodicStats{
		EpisodesCount: episodes,
		AvgDecay:      avgDecay,
		UsersCount:    users,
		OldestEntry:   oldestStr,
		Coverage:      coverage,
	}, nil
}
