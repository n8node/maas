package memory

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/n8node/maas/backend/internal/models"
)

// WikiConceptInput is optional structured knowledge attached to a wiki ingest.
type WikiConceptInput struct {
	Title       string
	Description string
}

func (s *Service) ingestWiki(ctx context.Context, userID uuid.UUID, inst *models.MemoryInstance, in IngestInput) (*IngestResult, error) {
	instanceID := inst.ID
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return nil, ErrEmptyContent
	}
	title := strings.TrimSpace(in.SourceTitle)
	if title == "" {
		title = strings.TrimSpace(in.SourceLabel)
	}
	if title == "" {
		title = "Untitled source"
	}

	chunks := splitChunks(text)
	if len(chunks) == 0 {
		return nil, ErrEmptyContent
	}

	var totalTok int64
	for _, c := range chunks {
		totalTok += estimateTokens(c)
	}
	for _, co := range in.Concepts {
		totalTok += estimateTokens(co.Title + "\n" + co.Description)
	}

	_ = s.bill.EnsureWelcomeSubscription(ctx, userID)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var srcID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO wiki_sources (instance_id, title, user_scope) VALUES ($1, $2, $3) RETURNING id`,
		instanceID, title, in.UserScope).Scan(&srcID)
	if err != nil {
		return nil, err
	}

	var insertedSeg []uuid.UUID
	for i, content := range chunks {
		te := int(estimateTokens(content))
		var sid uuid.UUID
		err := tx.QueryRow(ctx, `
			INSERT INTO wiki_segments (source_id, ordinal, content, token_estimate)
			VALUES ($1, $2, $3, $4) RETURNING id`,
			srcID, i, content, te).Scan(&sid)
		if err != nil {
			return nil, err
		}
		insertedSeg = append(insertedSeg, sid)
	}

	var insertedConcept []uuid.UUID
	for _, co := range in.Concepts {
		t := strings.TrimSpace(co.Title)
		if t == "" {
			continue
		}
		desc := strings.TrimSpace(co.Description)
		var cid uuid.UUID
		err := tx.QueryRow(ctx, `
			INSERT INTO wiki_concepts (instance_id, source_id, title, description, concept_type, state, confidence)
			VALUES ($1, $2, $3, $4, 'fact', 'active', 1.0) RETURNING id`,
			instanceID, srcID, t, desc).Scan(&cid)
		if err != nil {
			return nil, err
		}
		insertedConcept = append(insertedConcept, cid)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	nChunks := len(insertedSeg)
	_ = s.wikiLog(ctx, instanceID, "ingest", "ingest.complete", "source", &srcID, map[string]any{
		"segments": len(insertedSeg), "manual_concepts": len(insertedConcept), "title": title,
	}, "")

	var conceptsAdded int
	var extractNote string
	var llmTok int64
	var candidates []extractedConceptLite

	if wikiConfigAutoExtract(inst.Config) && s.chat != nil {
		items, tok, err := s.wikiLLMExtractCandidates(ctx, inst, srcID, text)
		if err != nil {
			extractNote = "Concept extraction failed: " + humanShortErr(err)
			llmTok = 0
		} else {
			candidates = items
			llmTok = tok
			if llmTok < 1 {
				llmTok = 1
			}
		}
	} else if wikiConfigAutoExtract(inst.Config) && s.chat == nil {
		extractNote = "Concept extraction skipped: chat model unavailable (set OPENROUTER_API_KEY on the server)."
	}

	if err := s.bill.ConsumeTokens(ctx, userID, totalTok+llmTok); err != nil {
		_, _ = s.pool.Exec(ctx, `DELETE FROM wiki_concepts WHERE source_id = $1`, srcID)
		_, _ = s.pool.Exec(ctx, `DELETE FROM wiki_sources WHERE id = $1`, srcID)
		return nil, err
	}

	if len(candidates) > 0 {
		conceptsAdded = s.wikiApplyCandidates(ctx, instanceID, srcID, candidates)
		_ = s.wikiLog(ctx, instanceID, "extraction", "extract.complete", "source", &srcID, map[string]any{
			"candidates": len(candidates), "inserted": conceptsAdded, "tokens": llmTok,
		}, "")
	}

	return &IngestResult{
		ChunksAdded:        nChunks,
		TokensConsumed:     totalTok + llmTok,
		SourceID:           srcID,
		WikiConceptsAdded:  conceptsAdded + len(insertedConcept),
		WikiExtractionNote: extractNote,
	}, nil
}

func (s *Service) queryWiki(ctx context.Context, userID, instanceID uuid.UUID, in QueryInput) (*QueryResult, error) {
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

	var scope any
	if in.UserScope != nil && strings.TrimSpace(*in.UserScope) != "" {
		scope = strings.TrimSpace(*in.UserScope)
	}

	var rows pgx.Rows
	var errQ error
	if len(q) >= 2 {
		rows, errQ = s.pool.Query(ctx, `
			SELECT seg.id::text, seg.content,
			  ts_rank(to_tsvector('simple', seg.content), plainto_tsquery('simple', $2))::float4 AS rank
			FROM wiki_segments seg
			INNER JOIN wiki_sources src ON src.id = seg.source_id
			WHERE src.instance_id = $1
			  AND ($3::text IS NULL OR src.user_scope IS NULL OR src.user_scope = $3::text)
			  AND to_tsvector('simple', seg.content) @@ plainto_tsquery('simple', $2)
			ORDER BY rank DESC NULLS LAST
			LIMIT $4`, instanceID, q, scope, topK)
	} else {
		rows, errQ = s.pool.Query(ctx, `
			SELECT seg.id::text, seg.content, 1.0::float4 AS rank
			FROM wiki_segments seg
			INNER JOIN wiki_sources src ON src.id = seg.source_id
			WHERE src.instance_id = $1
			  AND ($3::text IS NULL OR src.user_scope IS NULL OR src.user_scope = $3::text)
			  AND seg.content ILIKE '%' || $2 || '%'
			LIMIT $4`, instanceID, q, scope, topK)
	}
	if errQ != nil {
		return nil, errQ
	}
	defer rows.Close()
	cites := make([]Citation, 0)
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
	msg := "No matching wiki segments found."
	if len(cites) > 0 {
		msg = fmt.Sprintf("Found %d matching segment(s) (full-text). Citations reference segment IDs; synthesis via LLM is optional for a later release.", len(cites))
	}
	return &QueryResult{Message: msg, Citations: cites, TokensUsed: tokCost}, rows.Err()
}
