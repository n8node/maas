package memory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/n8node/maas/backend/internal/billing"
	"github.com/n8node/maas/backend/internal/models"
	"github.com/n8node/maas/backend/internal/openrouter"
)

var (
	ErrNotFound           = errors.New("instance not found")
	ErrLimitReached       = errors.New("instance limit reached for your plan")
	ErrInvalidType        = errors.New("memory type not allowed on your plan")
	ErrEmptyContent       = errors.New("content must not be empty")
	ErrEmptyQuery         = errors.New("query must not be empty")
	ErrEmbeddingsDisabled = errors.New("file ingestion requires embeddings and LLM API configuration on the server")
	ErrGardenerNotAllowed = errors.New("gardener is not enabled on your plan")
)

const maxChunkRunes = 8000

type Service struct {
	pool  *pgxpool.Pool
	bill  *billing.Service
	embed *openrouter.EmbeddingClient
	chat  *openrouter.ChatClient
	// Optional; from config. Empty means fall back to chat client model in helpers.
	gardenerTriageModel   string
	gardenerRefactorModel string
}

func NewService(pool *pgxpool.Pool, bill *billing.Service, opts ...ServiceOption) *Service {
	s := &Service{pool: pool, bill: bill}
	for _, o := range opts {
		o(s)
	}
	return s
}

func estimateTokens(s string) int64 {
	n := utf8.RuneCountInString(s)
	if n == 0 {
		return 1
	}
	t := int64(n / 4)
	if t < 1 {
		t = 1
	}
	return t
}

func splitChunks(text string) []string {
	t := strings.TrimSpace(text)
	if t == "" {
		return nil
	}
	runes := []rune(t)
	if len(runes) <= maxChunkRunes {
		return []string{t}
	}
	var out []string
	for i := 0; i < len(runes); i += maxChunkRunes {
		j := i + maxChunkRunes
		if j > len(runes) {
			j = len(runes)
		}
		out = append(out, string(runes[i:j]))
	}
	return out
}

func decodeConfig(raw []byte) map[string]any {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return map[string]any{}
	}
	return m
}

func (s *Service) countActiveInstances(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM memory_instances WHERE user_id = $1 AND status = 'active'`,
		userID).Scan(&n)
	return n, err
}

func (s *Service) planAllowsMemoryType(ctx context.Context, userID uuid.UUID, want string) (bool, error) {
	sum, err := s.bill.GetSummary(ctx, userID)
	if err != nil {
		return false, err
	}
	if sum.Plan == nil {
		return false, fmt.Errorf("no active plan")
	}
	want = strings.ToLower(strings.TrimSpace(want))
	for _, t := range sum.Plan.AllowedMemoryTypes {
		if strings.EqualFold(strings.TrimSpace(t), want) {
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) canCreateInstance(ctx context.Context, userID uuid.UUID) error {
	sum, err := s.bill.GetSummary(ctx, userID)
	if err != nil {
		return err
	}
	if sum.Plan == nil {
		return fmt.Errorf("no active plan")
	}
	n, err := s.countActiveInstances(ctx, userID)
	if err != nil {
		return err
	}
	maxI := sum.Plan.MaxInstances
	if maxI >= 100000 {
		return nil
	}
	if n >= maxI {
		return ErrLimitReached
	}
	return nil
}

func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]models.MemoryInstance, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, name, memory_type, status, config, created_at, updated_at
		FROM memory_instances
		WHERE user_id = $1 AND status != 'archived'
		ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.MemoryInstance
	for rows.Next() {
		var m models.MemoryInstance
		var raw []byte
		if err := rows.Scan(&m.ID, &m.UserID, &m.Name, &m.MemoryType, &m.Status, &raw, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		m.Config = decodeConfig(raw)
		out = append(out, m)
	}
	return out, rows.Err()
}

type CreateInput struct {
	Name       string
	MemoryType string
	Config     map[string]any
}

func (s *Service) Create(ctx context.Context, userID uuid.UUID, in CreateInput) (uuid.UUID, error) {
	_ = s.bill.EnsureWelcomeSubscription(ctx, userID)
	mt := strings.ToLower(strings.TrimSpace(in.MemoryType))
	var allowed bool
	var err error
	switch mt {
	case "rag":
		allowed, err = s.planAllowsMemoryType(ctx, userID, "rag")
	case "wiki":
		allowed, err = s.planAllowsMemoryType(ctx, userID, "wiki")
	case "episodic":
		allowed, err = s.planAllowsMemoryType(ctx, userID, "episodic")
	case "working":
		allowed, err = s.planAllowsMemoryType(ctx, userID, "working")
	default:
		return uuid.Nil, ErrInvalidType
	}
	if err != nil {
		return uuid.Nil, err
	}
	if !allowed {
		return uuid.Nil, ErrInvalidType
	}
	if err := s.canCreateInstance(ctx, userID); err != nil {
		return uuid.Nil, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return uuid.Nil, fmt.Errorf("name required")
	}
	cfg := in.Config
	if cfg == nil {
		cfg = map[string]any{}
	}
	cfgBytes, err := json.Marshal(cfg)
	if err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = s.pool.QueryRow(ctx, `
		INSERT INTO memory_instances (user_id, name, memory_type, status, config)
		VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
		userID, name, mt, cfgBytes).Scan(&id)
	return id, err
}

func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (*models.MemoryInstance, error) {
	var m models.MemoryInstance
	var raw []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, name, memory_type, status, config, created_at, updated_at
		FROM memory_instances WHERE id = $1 AND user_id = $2`,
		id, userID).Scan(&m.ID, &m.UserID, &m.Name, &m.MemoryType, &m.Status, &raw, &m.CreatedAt, &m.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	m.Config = decodeConfig(raw)
	return &m, nil
}

type PatchInput struct {
	Name   *string
	Status *string
	Config map[string]any
}

func (s *Service) Patch(ctx context.Context, userID, id uuid.UUID, in PatchInput) error {
	m, err := s.Get(ctx, userID, id)
	if err != nil {
		return err
	}
	name := m.Name
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
		if name == "" {
			return fmt.Errorf("name required")
		}
	}
	status := m.Status
	if in.Status != nil {
		st := strings.TrimSpace(*in.Status)
		if st != "active" && st != "paused" && st != "archived" {
			return fmt.Errorf("invalid status")
		}
		status = st
	}
	cfg := m.Config
	if in.Config != nil {
		cfg = in.Config
	}
	if cfg == nil {
		cfg = map[string]any{}
	}
	cfgBytes, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	ct, err := s.pool.Exec(ctx, `
		UPDATE memory_instances SET name = $3, status = $4, config = $5, updated_at = now()
		WHERE id = $1 AND user_id = $2`,
		id, userID, name, status, cfgBytes)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) Delete(ctx context.Context, userID, id uuid.UUID) error {
	ct, err := s.pool.Exec(ctx, `
		DELETE FROM memory_instances WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type IngestInput struct {
	Text         string
	UserScope    *string
	SessionScope *string
	ValidFrom    *time.Time
	ValidUntil   *time.Time
	SourceLabel  string
	// Wiki: optional display title for the source (falls back to SourceLabel).
	SourceTitle string
	Concepts    []WikiConceptInput
}

type IngestResult struct {
	ChunksAdded        int
	TokensConsumed     int64
	SourceID           uuid.UUID // wiki_sources.id for wiki ingests; zero for RAG JSON ingest.
	WikiConceptsAdded  int       // concepts inserted by auto-extract (wiki only)
	WikiExtractionNote string    // non-empty if extraction skipped/failed (wiki only)
}

func (s *Service) Ingest(ctx context.Context, userID, instanceID uuid.UUID, in IngestInput) (*IngestResult, error) {
	inst, err := s.Get(ctx, userID, instanceID)
	if err != nil {
		return nil, err
	}
	switch inst.MemoryType {
	case "rag":
		return s.ingestRAG(ctx, userID, instanceID, in)
	case "wiki":
		return s.ingestWiki(ctx, userID, inst, in)
	case "episodic":
		return s.ingestEpisodic(ctx, userID, instanceID, inst, in)
	case "working":
		return nil, fmt.Errorf("working memory: use session key API (PUT /sessions/:session_id/keys/:key), not text ingest")
	default:
		return nil, ErrInvalidType
	}
}

func (s *Service) ingestRAG(ctx context.Context, userID, instanceID uuid.UUID, in IngestInput) (*IngestResult, error) {
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return nil, ErrEmptyContent
	}
	chunks := splitChunks(text)
	if len(chunks) == 0 {
		return nil, ErrEmptyContent
	}
	var totalTok int64
	for _, c := range chunks {
		totalTok += estimateTokens(c)
	}
	_ = s.bill.EnsureWelcomeSubscription(ctx, userID)

	label := strings.TrimSpace(in.SourceLabel)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var inserted []uuid.UUID
	for _, content := range chunks {
		te := int(estimateTokens(content))
		var cid uuid.UUID
		err := tx.QueryRow(ctx, `
			INSERT INTO rag_chunks (instance_id, user_scope, source_label, content, token_estimate)
			VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			instanceID, in.UserScope, label, content, te).Scan(&cid)
		if err != nil {
			return nil, err
		}
		inserted = append(inserted, cid)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	if err := s.bill.ConsumeTokens(ctx, userID, totalTok); err != nil {
		for _, cid := range inserted {
			_, _ = s.pool.Exec(ctx, `DELETE FROM rag_chunks WHERE id = $1`, cid)
		}
		return nil, err
	}

	return &IngestResult{ChunksAdded: len(inserted), TokensConsumed: totalTok}, nil
}

type Citation struct {
	ChunkID string  `json:"chunk_id"`
	Snippet string  `json:"snippet"`
	Score   float32 `json:"score"`
}

// WikiRelatedConcept is returned for wiki queries when citations link to sources that have concepts.
type WikiRelatedConcept struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	State string `json:"state"`
}

type QueryResult struct {
	Message             string               `json:"message"`
	Citations           []Citation           `json:"citations"`
	TokensUsed          int64                `json:"tokens_used"`
	Synthesized         bool                 `json:"synthesized,omitempty"`
	WikiRelatedConcepts []WikiRelatedConcept `json:"wiki_related_concepts,omitempty"`
}

type QueryInput struct {
	Query        string
	TopK         int
	UserScope    *string
	SessionScope *string
	AsOf         *time.Time
	Synthesize   *bool // nil or true: synthesize when chat is configured; false: citations only
}

func (s *Service) Query(ctx context.Context, userID, instanceID uuid.UUID, in QueryInput) (*QueryResult, error) {
	inst, err := s.Get(ctx, userID, instanceID)
	if err != nil {
		return nil, err
	}
	switch inst.MemoryType {
	case "rag":
		return s.queryRAG(ctx, userID, instanceID, in)
	case "wiki":
		return s.queryWiki(ctx, userID, instanceID, in)
	case "episodic":
		return s.queryEpisodic(ctx, userID, instanceID, inst, in)
	case "working":
		return nil, fmt.Errorf("working memory: use session key API for reads, not text query")
	default:
		return nil, ErrInvalidType
	}
}

func (s *Service) queryRAG(ctx context.Context, userID, instanceID uuid.UUID, in QueryInput) (*QueryResult, error) {
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
	tokCost := int64(100 + utf8.RuneCountInString(q)/4)
	if tokCost < 50 {
		tokCost = 50
	}
	if err := s.bill.ConsumeTokens(ctx, userID, tokCost); err != nil {
		return nil, err
	}

	useVec := s.embed != nil
	if useVec {
		has, err := s.instanceHasVectorChunks(ctx, instanceID)
		if err != nil {
			return nil, err
		}
		useVec = has
	}

	var rows pgx.Rows
	var errQ error

	if useVec {
		qemb, err := s.embed.EmbedOne(ctx, q)
		if err != nil {
			useVec = false
		} else {
			vecStr := vectorLiteral(qemb)
			rows, errQ = s.pool.Query(ctx, `
				SELECT id::text, content,
				  (embedding <=> $3::vector)::float8 AS dist
				FROM rag_chunks
				WHERE instance_id = $1
				  AND embedding IS NOT NULL
				  AND ($2::text IS NULL OR user_scope IS NULL OR user_scope = $2)
				ORDER BY embedding <=> $3::vector
				LIMIT $4`, instanceID, in.UserScope, vecStr, topK)
			if errQ != nil {
				useVec = false
			}
		}
	}

	if !useVec {
		if rows != nil {
			rows.Close()
		}
		if len(q) >= 2 {
			rows, errQ = s.pool.Query(ctx, `
				SELECT id::text, content,
				  ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $3))::float4 AS rank
				FROM rag_chunks
				WHERE instance_id = $1
				  AND ($2::text IS NULL OR user_scope IS NULL OR user_scope = $2)
				  AND to_tsvector('simple', content) @@ plainto_tsquery('simple', $3)
				ORDER BY rank DESC NULLS LAST
				LIMIT $4`, instanceID, in.UserScope, q, topK)
		} else {
			rows, errQ = s.pool.Query(ctx, `
				SELECT id::text, content, 1.0::float4 AS rank
				FROM rag_chunks
				WHERE instance_id = $1
				  AND ($2::text IS NULL OR user_scope IS NULL OR user_scope = $2)
				  AND content ILIKE '%' || $3 || '%'
				LIMIT $4`, instanceID, in.UserScope, q, topK)
		}
	}

	if errQ != nil {
		return nil, errQ
	}
	defer rows.Close()
	cites := make([]Citation, 0)
	if useVec {
		for rows.Next() {
			var id, content string
			var dist float64
			if err := rows.Scan(&id, &content, &dist); err != nil {
				return nil, err
			}
			snippet := content
			runes := []rune(snippet)
			if len(runes) > 400 {
				snippet = string(runes[:400]) + "…"
			}
			score := float32(1.0 - dist)
			if score < 0 {
				score = 0
			}
			if score > 1 {
				score = 1
			}
			cites = append(cites, Citation{ChunkID: id, Snippet: snippet, Score: score})
		}
	} else {
		for rows.Next() {
			var id, content string
			var rank float32
			if err := rows.Scan(&id, &content, &rank); err != nil {
				return nil, err
			}
			snippet := content
			runes := []rune(snippet)
			if len(runes) > 400 {
				snippet = string(runes[:400]) + "…"
			}
			cites = append(cites, Citation{ChunkID: id, Snippet: snippet, Score: rank})
		}
	}
	msg := "No matching passages found in this instance."
	synthesized := false
	totalTok := tokCost

	if len(cites) > 0 {
		wantSynth := in.Synthesize == nil || (in.Synthesize != nil && *in.Synthesize)
		retrievalHint := "full-text / keyword search"
		if useVec {
			retrievalHint = "vector similarity"
		}
		if wantSynth && s.chat != nil {
			ans, synthTok, err := s.ragSynthesizeAnswer(ctx, userID, q, cites)
			switch {
			case err == nil && ans != "":
				msg = ans
				synthesized = true
				totalTok = tokCost + synthTok
			case err == nil && ans == "":
				msg = fmt.Sprintf("Found %d passage(s) via %s. The model returned an empty answer; see citations below.", len(cites), retrievalHint)
			case errors.Is(err, billing.ErrTokensExhausted):
				msg = fmt.Sprintf("Found %d passage(s) via %s. Insufficient tokens to generate a synthesized answer; see citations below.", len(cites), retrievalHint)
			default:
				msg = fmt.Sprintf("Found %d passage(s) via %s. Answer synthesis failed; see citations below.", len(cites), retrievalHint)
			}
		} else if wantSynth && s.chat == nil {
			msg = fmt.Sprintf("Found %d passage(s) via %s. LLM synthesis requires OPENROUTER_API_KEY on the server; see citations below.", len(cites), retrievalHint)
		} else {
			msg = fmt.Sprintf("Found %d passage(s) via %s. Synthesis disabled for this request; see citations below.", len(cites), retrievalHint)
		}
	}

	return &QueryResult{
		Message:     msg,
		Citations:   cites,
		TokensUsed:  totalTok,
		Synthesized: synthesized,
	}, rows.Err()
}

func InstanceToJSON(m models.MemoryInstance) map[string]any {
	return map[string]any{
		"id":          m.ID.String(),
		"name":        m.Name,
		"memory_type": m.MemoryType,
		"status":      m.Status,
		"config":      m.Config,
		"created_at":  m.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updated_at":  m.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}
