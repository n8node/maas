package memory

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/n8node/maas/backend/internal/models"
)

// ErrWikiOnly is returned when an operation requires a wiki instance.
var ErrWikiOnly = errors.New("operation requires wiki memory instance")

func (s *Service) requireWikiInstance(ctx context.Context, userID, id uuid.UUID) (*models.MemoryInstance, error) {
	m, err := s.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if m.MemoryType != "wiki" {
		return nil, ErrWikiOnly
	}
	return m, nil
}

func (s *Service) wikiLog(ctx context.Context, instanceID uuid.UUID, actor, action, targetKind string, targetID *uuid.UUID, payload map[string]any, rationale string) error {
	if payload == nil {
		payload = map[string]any{}
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO wiki_action_log (instance_id, actor, action, target_kind, target_id, payload, rationale)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		instanceID, actor, action, targetKind, targetID, b, rationale)
	return err
}

// WikiSourceRow is a wiki source with aggregates for API.
type WikiSourceRow struct {
	ID           uuid.UUID `json:"id"`
	Title        string    `json:"title"`
	UserScope    *string   `json:"user_scope,omitempty"`
	SegmentCount int       `json:"segment_count"`
	CreatedAt    time.Time `json:"created_at"`
}

func (s *Service) ListWikiSources(ctx context.Context, userID, instanceID uuid.UUID) ([]WikiSourceRow, error) {
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT s.id, s.title, s.user_scope, s.created_at,
		  (SELECT COUNT(*) FROM wiki_segments seg WHERE seg.source_id = s.id)::int
		FROM wiki_sources s
		WHERE s.instance_id = $1
		ORDER BY s.created_at DESC`, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WikiSourceRow
	for rows.Next() {
		var r WikiSourceRow
		var scope *string
		if err := rows.Scan(&r.ID, &r.Title, &scope, &r.CreatedAt, &r.SegmentCount); err != nil {
			return nil, err
		}
		r.UserScope = scope
		out = append(out, r)
	}
	return out, rows.Err()
}

// WikiConceptRow for list/detail API.
type WikiConceptRow struct {
	ID           uuid.UUID  `json:"id"`
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	ConceptType  string     `json:"concept_type"`
	State        string     `json:"state"`
	Confidence   float64    `json:"confidence"`
	SourceID     *uuid.UUID `json:"source_id,omitempty"`
	SourceTitle  *string    `json:"source_title,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

func (s *Service) ListWikiConcepts(ctx context.Context, userID, instanceID uuid.UUID, search string, limit int) ([]WikiConceptRow, error) {
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}
	search = strings.TrimSpace(search)
	var rows pgx.Rows
	var err error
	if search == "" {
		rows, err = s.pool.Query(ctx, `
			SELECT c.id, c.title, c.description, c.concept_type, c.state, c.confidence, c.source_id, src.title, c.created_at, c.updated_at
			FROM wiki_concepts c
			LEFT JOIN wiki_sources src ON src.id = c.source_id
			WHERE c.instance_id = $1
			ORDER BY c.updated_at DESC LIMIT $2`,
			instanceID, limit)
	} else {
		pat := "%" + search + "%"
		rows, err = s.pool.Query(ctx, `
			SELECT c.id, c.title, c.description, c.concept_type, c.state, c.confidence, c.source_id, src.title, c.created_at, c.updated_at
			FROM wiki_concepts c
			LEFT JOIN wiki_sources src ON src.id = c.source_id
			WHERE c.instance_id = $1 AND (c.title ILIKE $2 OR c.description ILIKE $2)
			ORDER BY c.updated_at DESC LIMIT $3`,
			instanceID, pat, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanWikiConceptRows(rows)
}

func scanWikiConceptRows(rows pgx.Rows) ([]WikiConceptRow, error) {
	var out []WikiConceptRow
	for rows.Next() {
		var r WikiConceptRow
		var src *uuid.UUID
		var conf float64
		var srcTitle sql.NullString
		if err := rows.Scan(&r.ID, &r.Title, &r.Description, &r.ConceptType, &r.State, &conf, &src, &srcTitle, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		r.Confidence = conf
		r.SourceID = src
		if srcTitle.Valid && strings.TrimSpace(srcTitle.String) != "" {
			t := strings.TrimSpace(srcTitle.String)
			r.SourceTitle = &t
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Service) GetWikiConcept(ctx context.Context, userID, instanceID, conceptID uuid.UUID) (*WikiConceptRow, error) {
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return nil, err
	}
	var r WikiConceptRow
	var src *uuid.UUID
	var conf float64
	var srcTitle sql.NullString
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, c.title, c.description, c.concept_type, c.state, c.confidence, c.source_id, src.title, c.created_at, c.updated_at
		FROM wiki_concepts c
		LEFT JOIN wiki_sources src ON src.id = c.source_id
		WHERE c.instance_id = $1 AND c.id = $2`,
		instanceID, conceptID).Scan(&r.ID, &r.Title, &r.Description, &r.ConceptType, &r.State, &conf, &src, &srcTitle, &r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	r.Confidence = conf
	r.SourceID = src
	if srcTitle.Valid && strings.TrimSpace(srcTitle.String) != "" {
		t := strings.TrimSpace(srcTitle.String)
		r.SourceTitle = &t
	}
	return &r, nil
}
	State       *string
	Description *string
}

func (s *Service) PatchWikiConcept(ctx context.Context, userID, instanceID, conceptID uuid.UUID, in PatchWikiConceptInput) error {
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return err
	}
	if in.State == nil && in.Description == nil {
		return nil
	}
	if in.State != nil && in.Description != nil {
		ct, err := s.pool.Exec(ctx, `
			UPDATE wiki_concepts SET state = $3, description = $4, updated_at = now()
			WHERE instance_id = $1 AND id = $2`,
			instanceID, conceptID, *in.State, *in.Description)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return ErrNotFound
		}
		return s.wikiLog(ctx, instanceID, "user", "concept.patch", "concept", &conceptID, map[string]any{"state": *in.State}, "")
	}
	if in.State != nil {
		ct, err := s.pool.Exec(ctx, `
			UPDATE wiki_concepts SET state = $3, updated_at = now() WHERE instance_id = $1 AND id = $2`,
			instanceID, conceptID, *in.State)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return ErrNotFound
		}
		return s.wikiLog(ctx, instanceID, "user", "concept.patch", "concept", &conceptID, map[string]any{"state": *in.State}, "")
	}
	ct, err := s.pool.Exec(ctx, `
		UPDATE wiki_concepts SET description = $3, updated_at = now() WHERE instance_id = $1 AND id = $2`,
		instanceID, conceptID, *in.Description)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return s.wikiLog(ctx, instanceID, "user", "concept.patch", "concept", &conceptID, map[string]any{}, "")
}

// WikiHealthMetrics computed for dashboard.
type WikiHealthMetrics struct {
	Coverage   float64 `json:"coverage"`    // 0–1 share of segments linked to at least one concept (approx)
	Purity     float64 `json:"purity"`      // inverse of duplicate-title pressure (1 - dup_ratio)
	StaleRatio float64 `json:"stale_ratio"` // fraction of concepts in stale|weak|disputed
	SegmentCount int   `json:"segment_count"`
	ConceptCount int   `json:"concept_count"`
	SourceCount  int   `json:"source_count"`
	// Exact counts for dashboard KPI subtitles (stale · disputed).
	StaleConceptCount    int `json:"stale_concept_count"`
	DisputedConceptCount int `json:"disputed_concept_count"`
}

func (s *Service) WikiHealth(ctx context.Context, userID, instanceID uuid.UUID) (*WikiHealthMetrics, error) {
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return nil, err
	}
	var segN, concN, srcN int
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM wiki_segments seg JOIN wiki_sources src ON src.id = seg.source_id WHERE src.instance_id = $1`, instanceID).Scan(&segN)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM wiki_concepts WHERE instance_id = $1`, instanceID).Scan(&concN)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM wiki_sources WHERE instance_id = $1`, instanceID).Scan(&srcN)

	var linked int
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT seg.id) FROM wiki_segments seg
		JOIN wiki_sources src ON src.id = seg.source_id
		JOIN wiki_concepts c ON c.source_id = src.id AND c.instance_id = src.instance_id
		WHERE src.instance_id = $1`, instanceID).Scan(&linked)

	coverage := 0.0
	if segN > 0 {
		coverage = float64(linked) / float64(segN)
		if coverage > 1 {
			coverage = 1
		}
	}

	var dupGroups int
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM (
		  SELECT lower(trim(title)) t FROM wiki_concepts WHERE instance_id = $1 GROUP BY lower(trim(title)) HAVING COUNT(*) > 1
		) x`, instanceID).Scan(&dupGroups)

	purity := 1.0
	if concN > 0 {
		purity = 1.0 - float64(dupGroups)/float64(concN)
		if purity < 0 {
			purity = 0
		}
	}

	var staleN int
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM wiki_concepts
		WHERE instance_id = $1 AND state IN ('weak', 'stale', 'disputed', 'archived')`, instanceID).Scan(&staleN)
	staleR := 0.0
	if concN > 0 {
		staleR = float64(staleN) / float64(concN)
	}

	var staleExact, disputedExact int
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM wiki_concepts WHERE instance_id = $1 AND state = 'stale'`, instanceID).Scan(&staleExact)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM wiki_concepts WHERE instance_id = $1 AND state = 'disputed'`, instanceID).Scan(&disputedExact)

	return &WikiHealthMetrics{
		Coverage:             coverage,
		Purity:               purity,
		StaleRatio:           staleR,
		SegmentCount:         segN,
		ConceptCount:         concN,
		SourceCount:          srcN,
		StaleConceptCount:    staleExact,
		DisputedConceptCount: disputedExact,
	}, nil
}

// WikiActionLogRow for API.
type WikiActionLogRow struct {
	ID         uuid.UUID      `json:"id"`
	Actor      string         `json:"actor"`
	Action     string         `json:"action"`
	TargetKind string         `json:"target_kind"`
	TargetID   *uuid.UUID     `json:"target_id,omitempty"`
	Payload    map[string]any `json:"payload"`
	Rationale  string         `json:"rationale"`
	CreatedAt  time.Time      `json:"created_at"`
}

func (s *Service) ListWikiActionLog(ctx context.Context, userID, instanceID uuid.UUID, limit int) ([]WikiActionLogRow, error) {
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 500 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, actor, action, target_kind, target_id, payload, rationale, created_at
		FROM wiki_action_log WHERE instance_id = $1 ORDER BY created_at DESC LIMIT $2`,
		instanceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WikiActionLogRow
	for rows.Next() {
		var r WikiActionLogRow
		var raw []byte
		var tid *uuid.UUID
		if err := rows.Scan(&r.ID, &r.Actor, &r.Action, &r.TargetKind, &tid, &raw, &r.Rationale, &r.CreatedAt); err != nil {
			return nil, err
		}
		r.TargetID = tid
		_ = json.Unmarshal(raw, &r.Payload)
		if r.Payload == nil {
			r.Payload = map[string]any{}
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// WikiProposalRow for gardener API.
type WikiProposalRow struct {
	ID           uuid.UUID      `json:"id"`
	ProposalType string         `json:"proposal_type"`
	Status       string         `json:"status"`
	Payload      map[string]any `json:"payload"`
	CreatedAt    time.Time      `json:"created_at"`
	ResolvedAt   *time.Time     `json:"resolved_at,omitempty"`
}

func (s *Service) ListWikiProposals(ctx context.Context, userID, instanceID uuid.UUID, status string) ([]WikiProposalRow, error) {
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return nil, err
	}
	status = strings.TrimSpace(strings.ToLower(status))
	var rows pgx.Rows
	var err error
	if status == "" || status == "all" {
		rows, err = s.pool.Query(ctx, `
			SELECT id, proposal_type, status, payload, created_at, resolved_at
			FROM wiki_gardener_proposals WHERE instance_id = $1 ORDER BY created_at DESC LIMIT 200`, instanceID)
	} else {
		rows, err = s.pool.Query(ctx, `
			SELECT id, proposal_type, status, payload, created_at, resolved_at
			FROM wiki_gardener_proposals WHERE instance_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 200`,
			instanceID, status)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WikiProposalRow
	for rows.Next() {
		var r WikiProposalRow
		var raw []byte
		var res *time.Time
		if err := rows.Scan(&r.ID, &r.ProposalType, &r.Status, &raw, &r.CreatedAt, &res); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(raw, &r.Payload)
		if r.Payload == nil {
			r.Payload = map[string]any{}
		}
		r.ResolvedAt = res
		out = append(out, r)
	}
	return out, rows.Err()
}

// RunWikiGardenerTriage scans for duplicate concept titles and creates merge proposals.
func (s *Service) RunWikiGardenerTriage(ctx context.Context, userID, instanceID uuid.UUID) (int, error) {
	if _, err := s.requireWikiInstance(ctx, userID, instanceID); err != nil {
		return 0, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT lower(trim(title)) AS t
		FROM wiki_concepts
		WHERE instance_id = $1 AND state = 'active'
		GROUP BY lower(trim(title))
		HAVING COUNT(*) > 1`, instanceID)
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
		r2, err := s.pool.Query(ctx, `
			SELECT id FROM wiki_concepts
			WHERE instance_id = $1 AND lower(trim(title)) = $2 AND state = 'active'
			ORDER BY created_at ASC`, instanceID, t)
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
	_ = s.wikiLog(ctx, instanceID, "gardener", "triage.run", "instance", &instanceID, map[string]any{"proposals_added": added}, "")
	return added, nil
}

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

	if ptype == "merge_concepts" {
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
	}

	_, err = s.pool.Exec(ctx, `
		UPDATE wiki_gardener_proposals SET status = 'approved', resolved_at = now()
		WHERE id = $1 AND instance_id = $2`, proposalID, instanceID)
	if err != nil {
		return err
	}
	return s.wikiLog(ctx, instanceID, "user", "gardener.approve", "proposal", &proposalID, map[string]any{"type": ptype}, "")
}

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
