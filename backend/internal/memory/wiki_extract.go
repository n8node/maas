package memory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/n8node/maas/backend/internal/models"
)

type extractedConceptLite struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	ConceptType string `json:"concept_type"`
}

// wikiConfigAutoExtract returns whether to run LLM concept extraction after wiki text ingest.
// Default is true when unset so concepts are created whenever OpenRouter/chat is configured.
// Set config.auto_extract to false (or extraction.auto) to disable.
func wikiConfigAutoExtract(cfg map[string]any) bool {
	if cfg == nil {
		return true
	}
	if v, ok := cfg["auto_extract"]; ok {
		return cfgTruthyAutoExtract(v)
	}
	if m, ok := cfg["extraction"].(map[string]any); ok {
		if v, ok := m["auto"]; ok {
			return cfgTruthyAutoExtract(v)
		}
	}
	return true
}

func cfgTruthyAutoExtract(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case float64:
		return x != 0
	case int:
		return x != 0
	case int64:
		return x != 0
	case string:
		s := strings.ToLower(strings.TrimSpace(x))
		if s == "false" || s == "0" || s == "no" || s == "off" {
			return false
		}
		if s == "true" || s == "1" || s == "yes" || s == "on" {
			return true
		}
		return true
	case nil:
		return true
	default:
		return true
	}
}

func normConceptType(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	allowed := map[string]bool{
		"fact": true, "entity": true, "event": true, "goal": true, "belief": true,
		"tension": true, "project": true, "pattern": true,
	}
	if allowed[t] {
		return t
	}
	return "fact"
}

func stripMarkdownFences(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "\ufeff")
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```JSON")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	return strings.TrimSpace(s)
}

// parseExtractedConceptsJSON tolerates markdown fences, BOM, and wrapper objects.
func parseExtractedConceptsJSON(raw string) ([]extractedConceptLite, error) {
	raw = stripMarkdownFences(raw)
	var items []extractedConceptLite
	if err := json.Unmarshal([]byte(raw), &items); err == nil {
		return items, nil
	}
	var wrap struct {
		Items    []extractedConceptLite `json:"items"`
		Concepts []extractedConceptLite `json:"concepts"`
		Data     []extractedConceptLite `json:"data"`
	}
	if err := json.Unmarshal([]byte(raw), &wrap); err == nil {
		if len(wrap.Items) > 0 {
			return wrap.Items, nil
		}
		if len(wrap.Concepts) > 0 {
			return wrap.Concepts, nil
		}
		if len(wrap.Data) > 0 {
			return wrap.Data, nil
		}
	}
	i := strings.Index(raw, "[")
	j := strings.LastIndex(raw, "]")
	if i >= 0 && j > i {
		slice := raw[i : j+1]
		if err := json.Unmarshal([]byte(slice), &items); err == nil {
			return items, nil
		}
	}
	return nil, fmt.Errorf("could not parse JSON array of concepts")
}

// wikiLLMExtractCandidates calls the chat model; does not write DB or bill tokens.
func (s *Service) wikiLLMExtractCandidates(ctx context.Context, inst *models.MemoryInstance, sourceID uuid.UUID, plainText string) ([]extractedConceptLite, int64, error) {
	if s.chat == nil || len(strings.TrimSpace(plainText)) == 0 {
		return nil, 0, fmt.Errorf("chat not configured")
	}
	system := `You extract candidate knowledge concepts from the user's text for a wiki memory system.
Return ONLY a JSON array (no markdown fences), each item: {"title":"short name","description":"1-3 sentences","concept_type":"one of: fact,entity,event,goal,belief,tension,project,pattern"}.
Use UTF-8. At most 12 items. Use clear, non-overlapping titles. If nothing useful, return [].`
	user := "Text:\n" + plainText
	if len(user) > 12000 {
		user = user[:12000] + "…"
	}
	out, usage, err := s.chat.Complete(ctx, system, user)
	if err != nil {
		_ = s.wikiLog(ctx, inst.ID, "extraction", "extract.failed", "source", &sourceID, map[string]any{"error": err.Error()}, "")
		return nil, 0, err
	}
	tok := usage.TotalTokens
	if tok < 1 {
		tok = 1
	}
	items, err := parseExtractedConceptsJSON(out)
	if err != nil {
		_ = s.wikiLog(ctx, inst.ID, "extraction", "extract.parse_failed", "source", &sourceID, map[string]any{"snippet": truncStr(stripMarkdownFences(out), 200)}, err.Error())
		return nil, 0, err
	}
	return items, tok, nil
}

// wikiApplyCandidates inserts extracted concepts (dedupe by title); returns rows inserted.
func (s *Service) wikiApplyCandidates(ctx context.Context, instanceID, sourceID uuid.UUID, items []extractedConceptLite) int {
	inserted := 0
	for _, it := range items {
		title := strings.TrimSpace(it.Title)
		if title == "" {
			continue
		}
		desc := strings.TrimSpace(it.Description)
		ct := normConceptType(it.ConceptType)
		var existing uuid.UUID
		err := s.pool.QueryRow(ctx, `
			SELECT id FROM wiki_concepts
			WHERE instance_id = $1 AND lower(trim(title)) = lower(trim($2::text)) AND state = 'active'
			LIMIT 1`,
			instanceID, title).Scan(&existing)
		if err == nil {
			if desc != "" {
				_, _ = s.pool.Exec(ctx, `
					UPDATE wiki_concepts SET description = CASE WHEN length(trim(description)) < length($3::text) THEN $3 ELSE description END,
					  updated_at = now()
					WHERE id = $1 AND instance_id = $2`, existing, instanceID, desc)
			}
			_ = s.wikiLog(ctx, instanceID, "router", "concept.attach_evidence", "concept", &existing, map[string]any{"source_id": sourceID.String(), "title": title}, "duplicate title — enriched description if longer")
			continue
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		var cid uuid.UUID
		err = s.pool.QueryRow(ctx, `
			INSERT INTO wiki_concepts (instance_id, source_id, title, description, concept_type, state, confidence)
			VALUES ($1, $2, $3, $4, $5, 'active', 0.85) RETURNING id`,
			instanceID, sourceID, title, desc, ct).Scan(&cid)
		if err != nil {
			continue
		}
		inserted++
		_ = s.wikiLog(ctx, instanceID, "router", "concept.create", "concept", &cid, map[string]any{"title": title, "concept_type": ct}, "extracted + router")
	}
	return inserted
}

func truncStr(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func humanShortErr(err error) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	const max = 160
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max]) + "…"
}
