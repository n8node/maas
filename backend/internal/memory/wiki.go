package memory

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// WikiConceptInput is optional structured knowledge attached to a wiki ingest.
type WikiConceptInput struct {
	Title       string
	Description string
}

func (s *Service) ingestWiki(ctx context.Context, userID, instanceID uuid.UUID, in IngestInput) (*IngestResult, error) {
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
		INSERT INTO wiki_sources (instance_id, title) VALUES ($1, $2) RETURNING id`,
		instanceID, title).Scan(&srcID)
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
			INSERT INTO wiki_concepts (instance_id, source_id, title, description, state, confidence)
			VALUES ($1, $2, $3, $4, 'active', 1.0) RETURNING id`,
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
	if err := s.bill.ConsumeTokens(ctx, userID, totalTok); err != nil {
		for _, sid := range insertedSeg {
			_, _ = s.pool.Exec(ctx, `DELETE FROM wiki_segments WHERE id = $1`, sid)
		}
		for _, cid := range insertedConcept {
			_, _ = s.pool.Exec(ctx, `DELETE FROM wiki_concepts WHERE id = $1`, cid)
		}
		_, _ = s.pool.Exec(ctx, `DELETE FROM wiki_sources WHERE id = $1`, srcID)
		return nil, err
	}

	_ = insertedConcept
	return &IngestResult{ChunksAdded: nChunks, TokensConsumed: totalTok}, nil
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

	var rows pgx.Rows
	var errQ error
	if len(q) >= 2 {
		rows, errQ = s.pool.Query(ctx, `
			SELECT seg.id::text, seg.content,
			  ts_rank(to_tsvector('simple', seg.content), plainto_tsquery('simple', $2))::float4 AS rank
			FROM wiki_segments seg
			INNER JOIN wiki_sources src ON src.id = seg.source_id
			WHERE src.instance_id = $1
			  AND to_tsvector('simple', seg.content) @@ plainto_tsquery('simple', $2)
			ORDER BY rank DESC NULLS LAST
			LIMIT $3`, instanceID, q, topK)
	} else {
		rows, errQ = s.pool.Query(ctx, `
			SELECT seg.id::text, seg.content, 1.0::float4 AS rank
			FROM wiki_segments seg
			INNER JOIN wiki_sources src ON src.id = seg.source_id
			WHERE src.instance_id = $1
			  AND seg.content ILIKE '%' || $2 || '%'
			LIMIT $3`, instanceID, q, topK)
	}
	if errQ != nil {
		return nil, errQ
	}
	defer rows.Close()
	var cites []Citation
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
		msg = fmt.Sprintf("Found %d wiki segment(s). Full Concept Hypothesis pipeline (extraction, router, gardener) comes in a later milestone.", len(cites))
	}
	return &QueryResult{Message: msg, Citations: cites, TokensUsed: tokCost}, rows.Err()
}
