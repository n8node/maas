package memory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/n8node/maas/backend/internal/billing"
)

// WikiTriageResult is returned after gardener Phase 0 triage (heuristic + optional LLM).
type WikiTriageResult struct {
	ProposalsAdded int   `json:"proposals_added"`
	HeuristicAdded int   `json:"heuristic_added"`
	LLMAdded       int   `json:"llm_added"`
	TokensUsed     int64 `json:"tokens_used"`
}

func (s *Service) gardenerTriageModelResolved() string {
	if m := strings.TrimSpace(s.gardenerTriageModel); m != "" {
		return m
	}
	if s.chat != nil && strings.TrimSpace(s.chat.Model) != "" {
		return strings.TrimSpace(s.chat.Model)
	}
	return "openai/gpt-4o-mini"
}

func (s *Service) gardenerRefactorModelResolved() string {
	if m := strings.TrimSpace(s.gardenerRefactorModel); m != "" {
		return m
	}
	return s.gardenerTriageModelResolved()
}

func (s *Service) wikiPendingMergeForNormalizedTitle(ctx context.Context, instanceID uuid.UUID, norm string) (bool, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM wiki_gardener_proposals
		WHERE instance_id = $1 AND status = 'pending' AND proposal_type = 'merge_concepts'
		  AND payload->>'normalized_title' = $2`, instanceID, norm).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (s *Service) wikiGardenerHeuristicMerge(ctx context.Context, instanceID uuid.UUID) (int, error) {
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		SELECT %s AS t
		FROM wiki_concepts
		WHERE instance_id = $1 AND state = 'active'
		GROUP BY 1
		HAVING COUNT(*) > 1`, wikiTitleNormSQLCol), instanceID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var titles []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return 0, err
		}
		titles = append(titles, t)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	added := 0
	for _, t := range titles {
		dup, err := s.wikiPendingMergeForNormalizedTitle(ctx, instanceID, t)
		if err != nil {
			return added, err
		}
		if dup {
			continue
		}
		r2, err := s.pool.Query(ctx, fmt.Sprintf(`
			SELECT id FROM wiki_concepts
			WHERE instance_id = $1 AND %s = $2 AND state = 'active'
			ORDER BY created_at ASC`, wikiTitleNormSQLCol), instanceID, t)
		if err != nil {
			return added, err
		}
		var ids []uuid.UUID
		for r2.Next() {
			var id uuid.UUID
			if err := r2.Scan(&id); err != nil {
				r2.Close()
				return added, err
			}
			ids = append(ids, id)
		}
		if err := r2.Err(); err != nil {
			r2.Close()
			return added, err
		}
		r2.Close()
		if len(ids) < 2 {
			continue
		}
		idsStr := make([]string, len(ids))
		for i, u := range ids {
			idsStr[i] = u.String()
		}
		payload := map[string]any{
			"normalized_title": t,
			"concept_ids":      idsStr,
			"keeper_id":        ids[0].String(),
			"reason":           "Duplicate active titles (heuristic Phase 0)",
		}
		b, _ := json.Marshal(payload)
		_, err = s.pool.Exec(ctx, `
			INSERT INTO wiki_gardener_proposals (instance_id, proposal_type, status, payload)
			VALUES ($1, 'merge_concepts', 'pending', $2::jsonb)`,
			instanceID, b)
		if err != nil {
			return added, err
		}
		added++
	}
	return added, nil
}

func extractJSONArray(raw string) []byte {
	raw = strings.TrimSpace(raw)
	if i := strings.Index(raw, "["); i >= 0 {
		if j := strings.LastIndex(raw, "]"); j > i {
			return []byte(raw[i : j+1])
		}
	}
	return []byte(raw)
}

func mergeProposalDedupeKey(ids []uuid.UUID) string {
	sort.Slice(ids, func(i, j int) bool { return ids[i].String() < ids[j].String() })
	var b strings.Builder
	for i, id := range ids {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(id.String())
	}
	return b.String()
}

func (s *Service) wikiCountConceptsInInstance(ctx context.Context, instanceID uuid.UUID, ids []uuid.UUID) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*)::int FROM wiki_concepts
		WHERE instance_id = $1 AND id = ANY($2::uuid[])`, instanceID, ids).Scan(&n)
	return n, err
}

func (s *Service) wikiGardenerLLMTriage(ctx context.Context, userID, instanceID uuid.UUID) (added int, tokens int64, err error) {
	if s.chat == nil {
		return 0, 0, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, title, description, state
		FROM wiki_concepts
		WHERE instance_id = $1 AND state = 'active'
		ORDER BY created_at ASC
		LIMIT 80`, instanceID)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	type row struct {
		ID          string `json:"id"`
		Title       string `json:"title"`
		Description string `json:"description"`
		State       string `json:"state"`
	}
	var concepts []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.ID, &r.Title, &r.Description, &r.State); err != nil {
			return 0, 0, err
		}
		if len(r.Description) > 2400 {
			r.Description = r.Description[:2400] + "…"
		}
		concepts = append(concepts, r)
	}
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}
	if len(concepts) == 0 {
		return 0, 0, nil
	}
	payload, err := json.Marshal(concepts)
	if err != nil {
		return 0, 0, err
	}
	system := `You are Phase 0 Wiki Gardener (proposal-only). Proposed actions are reviewed by a human before apply.
Return ONLY a JSON array (no markdown fences). Each element is one object:
- {"type":"merge_concepts","concept_ids":["uuid",...],"keeper_id":"uuid","reason":"short reason"}
  Use when concepts clearly describe the same entity. keeper_id must appear in concept_ids (prefer the clearest or earliest concept).
- {"type":"set_concept_state","concept_id":"uuid","new_state":"stale"|"weak"|"disputed"|"archived","reason":"short reason"}
  Use for obsolete, unreliable, conflicting, or retired concepts.

Rules: use only concept ids from the input list. new_state must be one of: stale, weak, disputed, archived.
If nothing is needed, return [].`
	user := fmt.Sprintf("Concepts for instance (JSON array):\n%s", string(payload))
	model := s.gardenerTriageModelResolved()
	out, usage, err := s.chat.CompleteWithModel(ctx, model, system, user)
	if err != nil {
		return 0, 0, err
	}
	tok := usage.TotalTokens
	if tok < 1 {
		tok = 1
	}
	_ = s.bill.EnsureWelcomeSubscription(ctx, userID)
	if err := s.bill.ConsumeTokens(ctx, userID, tok); err != nil {
		return 0, 0, err
	}

	var arr []map[string]any
	if err := json.Unmarshal(extractJSONArray(out), &arr); err != nil {
		return 0, tok, fmt.Errorf("gardener triage JSON: %w", err)
	}

	seenMerge := map[string]bool{}
	added = 0
	for _, item := range arr {
		typ, _ := item["type"].(string)
		typ = strings.ToLower(strings.TrimSpace(typ))
		switch typ {
		case "merge_concepts":
			rawIDs, ok := item["concept_ids"]
			if !ok {
				continue
			}
			var idStrs []string
			switch x := rawIDs.(type) {
			case []any:
				for _, v := range x {
					if s, ok := v.(string); ok {
						idStrs = append(idStrs, s)
					}
				}
			case []string:
				idStrs = x
			default:
				continue
			}
			if len(idStrs) < 2 {
				continue
			}
			ks, _ := item["keeper_id"].(string)
			keeper, err := uuid.Parse(strings.TrimSpace(ks))
			if err != nil {
				continue
			}
			var ids []uuid.UUID
			seen := map[uuid.UUID]bool{}
			for _, sid := range idStrs {
				id, err := uuid.Parse(strings.TrimSpace(sid))
				if err != nil || seen[id] {
					continue
				}
				seen[id] = true
				ids = append(ids, id)
			}
			if len(ids) < 2 {
				continue
			}
			hasKeeper := false
			for _, id := range ids {
				if id == keeper {
					hasKeeper = true
					break
				}
			}
			if !hasKeeper {
				continue
			}
			n, err := s.wikiCountConceptsInInstance(ctx, instanceID, ids)
			if err != nil || n != len(ids) {
				continue
			}
			key := mergeProposalDedupeKey(ids)
			if seenMerge[key] {
				continue
			}
			seenMerge[key] = true
			reason, _ := item["reason"].(string)
			payload := map[string]any{
				"concept_ids": idStrings(ids),
				"keeper_id":   keeper.String(),
				"reason":      strings.TrimSpace(reason),
				"source":      "llm_phase0",
			}
			b, _ := json.Marshal(payload)
			_, err = s.pool.Exec(ctx, `
				INSERT INTO wiki_gardener_proposals (instance_id, proposal_type, status, payload)
				VALUES ($1, 'merge_concepts', 'pending', $2::jsonb)`,
				instanceID, b)
			if err != nil {
				return added, tok, err
			}
			added++

		case "set_concept_state":
			cidStr, _ := item["concept_id"].(string)
			cid, err := uuid.Parse(strings.TrimSpace(cidStr))
			if err != nil {
				continue
			}
			newState := strings.ToLower(strings.TrimSpace(fmt.Sprint(item["new_state"])))
			if !wikiGardenerAllowedTargetState(newState) {
				continue
			}
			n, err := s.wikiCountConceptsInInstance(ctx, instanceID, []uuid.UUID{cid})
			if err != nil || n != 1 {
				continue
			}
			reason, _ := item["reason"].(string)
			p := map[string]any{
				"concept_id": cid.String(),
				"new_state":  newState,
				"reason":     strings.TrimSpace(reason),
				"source":     "llm_phase0",
			}
			b, _ := json.Marshal(p)
			_, err = s.pool.Exec(ctx, `
				INSERT INTO wiki_gardener_proposals (instance_id, proposal_type, status, payload)
				VALUES ($1, 'set_concept_state', 'pending', $2::jsonb)`,
				instanceID, b)
			if err != nil {
				return added, tok, err
			}
			added++
		}
	}
	return added, tok, nil
}

func idStrings(ids []uuid.UUID) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = id.String()
	}
	return out
}

func wikiGardenerAllowedTargetState(s string) bool {
	switch s {
	case "stale", "weak", "disputed", "archived":
		return true
	default:
		return false
	}
}

// RunWikiGardenerTriage runs heuristic duplicate detection and optional LLM Phase 0 proposals (requires chat client / LLM API configured on server).
func (s *Service) RunWikiGardenerTriage(ctx context.Context, userID, instanceID uuid.UUID) (*WikiTriageResult, error) {
	_ = s.bill.EnsureWelcomeSubscription(ctx, userID)
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return nil, err
	}
	ok, err := s.bill.GardenerEnabledForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrGardenerNotAllowed
	}

	h, err := s.wikiGardenerHeuristicMerge(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	llmAdded := 0
	var tok int64
	if s.chat != nil {
		a, t, err := s.wikiGardenerLLMTriage(ctx, userID, instanceID)
		if err != nil {
			if errors.Is(err, billing.ErrTokensExhausted) {
				return nil, err
			}
			_ = s.wikiLog(ctx, instanceID, "gardener", "triage.llm_error", "instance", &instanceID, map[string]any{"error": err.Error()}, "")
		} else {
			llmAdded, tok = a, t
		}
	}

	total := h + llmAdded
	_ = s.wikiLog(ctx, instanceID, "gardener", "triage.run", "instance", &instanceID, map[string]any{
		"heuristic_added":  h,
		"llm_added":        llmAdded,
		"tokens_used":      tok,
		"proposals_added": total,
	}, "")
	return &WikiTriageResult{
		ProposalsAdded: total,
		HeuristicAdded: h,
		LLMAdded:       llmAdded,
		TokensUsed:     tok,
	}, nil
}

// ListWikiRepairConcepts returns concepts that likely need attention (stale, disputed, weak).
func (s *Service) ListWikiRepairConcepts(ctx context.Context, userID, instanceID uuid.UUID) ([]WikiConceptRow, error) {
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.title, c.description, c.concept_type, c.state, c.confidence, c.source_id, src.title, c.created_at, c.updated_at
		FROM wiki_concepts c
		LEFT JOIN wiki_sources src ON src.id = c.source_id
		WHERE c.instance_id = $1 AND c.state IN ('stale', 'disputed', 'weak')
		ORDER BY c.updated_at DESC
		LIMIT 100`, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanWikiConceptRows(rows)
}

func (s *Service) wikiSynthesizeMergedDescription(ctx context.Context, userID, instanceID, keeper uuid.UUID, keeperTitle string, texts []string) error {
	if s.chat == nil || len(texts) == 0 {
		return nil
	}
	model := s.gardenerRefactorModelResolved()
	system := "You consolidate overlapping concept descriptions into one concise paragraph (2–6 sentences). Preserve factual content and drop redundancy."
	user := fmt.Sprintf("Concept title: %s\n\nTexts to merge:\n%s", keeperTitle, strings.Join(texts, "\n---\n"))
	out, usage, err := s.chat.CompleteWithModel(ctx, model, system, user)
	if err != nil {
		return nil
	}
	tok := usage.TotalTokens
	if tok < 1 {
		tok = 1
	}
	_ = s.bill.EnsureWelcomeSubscription(ctx, userID)
	if err := s.bill.ConsumeTokens(ctx, userID, tok); err != nil {
		return nil
	}
	out = strings.TrimSpace(out)
	if out == "" {
		return nil
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE wiki_concepts SET description = $1, updated_at = now()
		WHERE instance_id = $2 AND id = $3`, out, instanceID, keeper)
	return err
}

// ApproveWikiProposal applies an approved gardener proposal.
func (s *Service) ApproveWikiProposal(ctx context.Context, userID, instanceID, proposalID uuid.UUID) error {
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return err
	}
	var ptype string
	var raw []byte
	err := s.pool.QueryRow(ctx, `
		SELECT proposal_type, payload FROM wiki_gardener_proposals
		WHERE id = $1 AND instance_id = $2 AND status = 'pending'`, proposalID, instanceID).Scan(&ptype, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	var payload map[string]any
	_ = json.Unmarshal(raw, &payload)
	rationale := ""
	if r, ok := payload["reason"].(string); ok {
		rationale = strings.TrimSpace(r)
	}

	switch ptype {
	case "merge_concepts":
		rawIDs, ok := payload["concept_ids"]
		if !ok {
			return fmt.Errorf("invalid proposal payload")
		}
		var idStrs []string
		switch x := rawIDs.(type) {
		case []any:
			for _, v := range x {
				if s, ok := v.(string); ok {
					idStrs = append(idStrs, s)
				}
			}
		case []string:
			idStrs = x
		default:
			return fmt.Errorf("invalid concept_ids in payload")
		}
		if len(idStrs) < 2 {
			return fmt.Errorf("invalid proposal payload")
		}
		ks, _ := payload["keeper_id"].(string)
		keeper, err := uuid.Parse(ks)
		if err != nil {
			return fmt.Errorf("invalid keeper")
		}
		type snap struct {
			id          uuid.UUID
			title       string
			description string
		}
		var snaps []snap
		for _, sid := range idStrs {
			id, err := uuid.Parse(sid)
			if err != nil {
				continue
			}
			var title, desc string
			err = s.pool.QueryRow(ctx, `
				SELECT title, description FROM wiki_concepts
				WHERE instance_id = $1 AND id = $2`, instanceID, id).Scan(&title, &desc)
			if err != nil {
				continue
			}
			snaps = append(snaps, snap{id: id, title: title, description: desc})
		}
		keeperOK := false
		for _, sn := range snaps {
			if sn.id == keeper {
				keeperOK = true
				break
			}
		}
		if !keeperOK {
			return fmt.Errorf("keeper concept not found for merge proposal")
		}
		var keeperTitle string
		var mergeTexts []string
		for _, sn := range snaps {
			if sn.id == keeper {
				keeperTitle = sn.title
			}
			t := strings.TrimSpace(sn.description)
			if t != "" {
				mergeTexts = append(mergeTexts, sn.title+": "+t)
			}
		}
		for _, sid := range idStrs {
			id, err := uuid.Parse(sid)
			if err != nil || id == keeper {
				continue
			}
			_, err = s.pool.Exec(ctx, `
				UPDATE wiki_concepts SET state = 'archived', updated_at = now()
				WHERE instance_id = $1 AND id = $2`, instanceID, id)
			if err != nil {
				return err
			}
		}
		if len(mergeTexts) > 1 {
			_ = s.wikiSynthesizeMergedDescription(ctx, userID, instanceID, keeper, keeperTitle, mergeTexts)
		}

	case "set_concept_state":
		cidStr, _ := payload["concept_id"].(string)
		cid, err := uuid.Parse(strings.TrimSpace(cidStr))
		if err != nil {
			return fmt.Errorf("invalid concept_id")
		}
		ns := strings.ToLower(strings.TrimSpace(fmt.Sprint(payload["new_state"])))
		if !wikiGardenerAllowedTargetState(ns) {
			return fmt.Errorf("invalid new_state")
		}
		ct, err := s.pool.Exec(ctx, `
			UPDATE wiki_concepts SET state = $3, updated_at = now()
			WHERE instance_id = $1 AND id = $2`, instanceID, cid, ns)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return ErrNotFound
		}

	default:
		return fmt.Errorf("unsupported proposal type: %s", ptype)
	}

	_, err = s.pool.Exec(ctx, `
		UPDATE wiki_gardener_proposals SET status = 'approved', resolved_at = now()
		WHERE id = $1 AND instance_id = $2`, proposalID, instanceID)
	if err != nil {
		return err
	}
	return s.wikiLog(ctx, instanceID, "user", "gardener.approve", "proposal", &proposalID, map[string]any{"type": ptype}, rationale)
}

// DismissWikiProposal marks a proposal as dismissed without applying it (user hides Phase 0 noise).
func (s *Service) DismissWikiProposal(ctx context.Context, userID, instanceID, proposalID uuid.UUID) error {
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return err
	}
	ct, err := s.pool.Exec(ctx, `
		UPDATE wiki_gardener_proposals SET status = 'dismissed', resolved_at = now()
		WHERE id = $1 AND instance_id = $2 AND status = 'pending'`, proposalID, instanceID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return s.wikiLog(ctx, instanceID, "user", "gardener.dismiss", "proposal", &proposalID, map[string]any{}, "")
}

// RejectWikiProposal marks a proposal as rejected.
func (s *Service) RejectWikiProposal(ctx context.Context, userID, instanceID, proposalID uuid.UUID) error {
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return err
	}
	ct, err := s.pool.Exec(ctx, `
		UPDATE wiki_gardener_proposals SET status = 'rejected', resolved_at = now()
		WHERE id = $1 AND instance_id = $2 AND status = 'pending'`, proposalID, instanceID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return s.wikiLog(ctx, instanceID, "user", "gardener.reject", "proposal", &proposalID, map[string]any{}, "")
}
