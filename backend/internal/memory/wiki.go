package memory

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/n8node/maas/backend/internal/models"
)

// Markers embedded in wiki query snippets for UI highlighting (must match frontend WikiHighlightedSnippet).
const (
	wikiSnippetHLStart = "[[MNQ-HL]]"
	wikiSnippetHLEnd   = "[[/MNQ-HL]]"
)

func wikiTruncateRune(s string, max int) string {
	if max <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

// wikiSnippetILIKEHighlight wraps the case-insensitive match in wikiSnippetHL markers with a rune window around it (short queries).
func wikiSnippetILIKEHighlight(content, query string) string {
	query = strings.TrimSpace(query)
	if query == "" {
		return wikiTruncateRune(content, 420)
	}
	re := regexp.MustCompile(`(?is)` + regexp.QuoteMeta(query))
	loc := re.FindStringIndex(content)
	if loc == nil {
		return wikiTruncateRune(content, 420)
	}
	a, b := loc[0], loc[1]
	rs := []rune(content)
	si := utf8.RuneCountInString(content[:a])
	ei := utf8.RuneCountInString(content[:b])
	const margin = 160
	w0 := si - margin
	if w0 < 0 {
		w0 = 0
	}
	w1 := ei + margin
	if w1 > len(rs) {
		w1 = len(rs)
	}
	var out strings.Builder
	if w0 > 0 {
		out.WriteString("…")
	}
	for i := w0; i < w1; i++ {
		if i == si {
			out.WriteString(wikiSnippetHLStart)
		}
		out.WriteRune(rs[i])
		if i == ei-1 {
			out.WriteString(wikiSnippetHLEnd)
		}
	}
	if w1 < len(rs) {
		out.WriteString("…")
	}
	return out.String()
}

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
		extractNote = "Concept extraction skipped: chat model unavailable (configure LLM API access on the server)."
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

	wikiFTSSQL := fmt.Sprintf(`
		SELECT seg.id::text, seg.content,
		  ts_headline('simple', seg.content, plainto_tsquery('simple', $2),
		    'StartSel=%s, StopSel=%s, MaxWords=120, MinWords=14, MaxFragments=3, ShortWord=2, HighlightAll=TRUE') AS headline,
		  ts_rank(to_tsvector('simple', seg.content), plainto_tsquery('simple', $2))::float4 AS rank
		FROM wiki_segments seg
		INNER JOIN wiki_sources src ON src.id = seg.source_id
		WHERE src.instance_id = $1
		  AND ($3::text IS NULL OR src.user_scope IS NULL OR src.user_scope = $3::text)
		  AND to_tsvector('simple', seg.content) @@ plainto_tsquery('simple', $2)
		ORDER BY rank DESC NULLS LAST
		LIMIT $4`, wikiSnippetHLStart, wikiSnippetHLEnd)

	var rows pgx.Rows
	var errQ error
	if len(q) >= 2 {
		rows, errQ = s.pool.Query(ctx, wikiFTSSQL, instanceID, q, scope, topK)
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
	if len(q) >= 2 {
		for rows.Next() {
			var id, content, headline string
			var rank float32
			if err := rows.Scan(&id, &content, &headline, &rank); err != nil {
				return nil, err
			}
			snippet := strings.TrimSpace(headline)
			if snippet == "" {
				snippet = wikiTruncateRune(content, 450)
			}
			cites = append(cites, Citation{ChunkID: id, Snippet: snippet, Score: rank})
		}
	} else {
		for rows.Next() {
			var id, content string
			var rank float32
			if err := rows.Scan(&id, &content, &rank); err != nil {
				return nil, err
			}
			snippet := wikiSnippetILIKEHighlight(content, q)
			cites = append(cites, Citation{ChunkID: id, Snippet: snippet, Score: rank})
		}
	}
	msg := "No matching wiki segments found."
	var related []WikiRelatedConcept
	if len(cites) > 0 {
		msg = fmt.Sprintf("Found %d matching segment(s) (full-text). Citations reference segment IDs; synthesis via LLM is optional for a later release.", len(cites))
		segUUIDs := make([]uuid.UUID, 0, len(cites))
		for _, c := range cites {
			id, err := uuid.Parse(strings.TrimSpace(c.ChunkID))
			if err != nil {
				continue
			}
			segUUIDs = append(segUUIDs, id)
		}
		if len(segUUIDs) > 0 {
			r2, errRel := s.pool.Query(ctx, `
				SELECT DISTINCT c.id::text, c.title, c.state
				FROM wiki_concepts c
				INNER JOIN wiki_segments seg ON seg.source_id = c.source_id
				INNER JOIN wiki_sources src ON src.id = seg.source_id
				WHERE src.instance_id = $1 AND c.instance_id = $1 AND seg.id = ANY($2::uuid[])
				LIMIT 24`, instanceID, segUUIDs)
			if errRel == nil {
				defer r2.Close()
				for r2.Next() {
					var id, title, state string
					if err := r2.Scan(&id, &title, &state); err != nil {
						continue
					}
					related = append(related, WikiRelatedConcept{ID: id, Title: title, State: state})
				}
				_ = r2.Err()
			}
		}
	}
	return &QueryResult{Message: msg, Citations: cites, TokensUsed: tokCost, WikiRelatedConcepts: related}, rows.Err()
}
