package memory

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

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

// runWikiExtraction calls the chat model to propose concepts and applies router-lite rules (dedupe by title).
func (s *Service) runWikiExtraction(ctx context.Context, userID uuid.UUID, inst *models.MemoryInstance, sourceID uuid.UUID, plainText string) (extraTok int64, err error) {
	if s.chat == nil || len(strings.TrimSpace(plainText)) == 0 {
		return 0, nil
	}
	system := `You extract candidate knowledge concepts from the user's text for a wiki memory system.
Return ONLY a JSON array (no markdown fences), each item: {"title":"short name","description":"1-3 sentences","concept_type":"one of: fact,entity,event,goal,belief,tension,project,pattern"}.
At most 12 items. Use clear, non-overlapping titles. If nothing useful, return [].`
	user := "Text:\n" + plainText
	if len(user) > 12000 {
		user = user[:12000] + "…"
	}
	out, usage, err := s.chat.Complete(ctx, system, user)
	if err != nil {
		_ = s.wikiLog(ctx, inst.ID, "extraction", "extract.failed", "source", &sourceID, map[string]any{"error": err.Error()}, "")
		return 0, err
	}
	raw := strings.TrimSpace(out)
	raw = strings.TrimPrefix(raw, "```json")
	raw = strings.TrimPrefix(raw, "```")
	raw = strings.TrimSuffix(raw, "```")
	raw = strings.TrimSpace(raw)
	var items []extractedConceptLite
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		_ = s.wikiLog(ctx, inst.ID, "extraction", "extract.parse_failed", "source", &sourceID, map[string]any{"snippet": truncStr(raw, 200)}, err.Error())
		return 0, err
	}
	tok := usage.TotalTokens
	if tok < 1 {
		tok = 1
	}
	if err := s.bill.ConsumeTokens(ctx, userID, tok); err != nil {
		_ = s.wikiLog(ctx, inst.ID, "extraction", "extract.tokens_denied", "source", &sourceID, map[string]any{"tokens": tok}, "")
		return 0, err
	}
	extraTok = tok

	instanceID := inst.ID
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
		_ = s.wikiLog(ctx, instanceID, "router", "concept.create", "concept", &cid, map[string]any{"title": title, "concept_type": ct}, "extracted + router")
	}
	_ = s.wikiLog(ctx, instanceID, "extraction", "extract.complete", "source", &sourceID, map[string]any{"candidates": len(items), "tokens": extraTok}, "")
	return extraTok, nil
}

func truncStr(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
