package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/n8node/maas/backend/internal/memory"
)

var (
	ErrNotFound      = errors.New("agent not found")
	ErrDupLayerType  = errors.New("this memory type is already attached to the agent")
	ErrInstanceBusy  = errors.New("instance is already assigned to another agent")
	ErrBadTargetType = errors.New("unsupported target_memory_type for ingest")
	ErrNoLayerMatch  = errors.New("no enabled layer matches target_memory_type")
)

type Agent struct {
	ID          uuid.UUID       `json:"id"`
	UserID      uuid.UUID       `json:"user_id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Config      json.RawMessage `json:"config"`
	Status      string          `json:"status"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

type LayerDetail struct {
	InstanceID uuid.UUID `json:"instance_id"`
	MemoryType string    `json:"memory_type"`
	Role       string    `json:"role"`
	Priority   int       `json:"priority"`
	Enabled    bool      `json:"enabled"`
	Name       string    `json:"name"`
}

type Service struct {
	pool *pgxpool.Pool
	mem  *memory.Service
}

func NewService(pool *pgxpool.Pool, mem *memory.Service) *Service {
	return &Service{pool: pool, mem: mem}
}

func (s *Service) ownerAgent(ctx context.Context, agentID uuid.UUID, userID uuid.UUID) (*Agent, error) {
	var a Agent
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, name, description, config, status, created_at, updated_at
		FROM agents WHERE id = $1 AND user_id = $2`,
		agentID, userID,
	).Scan(&a.ID, &a.UserID, &a.Name, &a.Description, &a.Config, &a.Status, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &a, err
}

func (s *Service) ListAgents(ctx context.Context, userID uuid.UUID) ([]Agent, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, name, description, config, status, created_at, updated_at
		FROM agents WHERE user_id = $1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Agent
	for rows.Next() {
		var a Agent
		if err := rows.Scan(&a.ID, &a.UserID, &a.Name, &a.Description, &a.Config, &a.Status, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Service) Create(ctx context.Context, userID uuid.UUID, name string, description string, configJSON []byte) (uuid.UUID, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return uuid.Nil, fmt.Errorf("name required")
	}
	if len(configJSON) == 0 {
		configJSON = []byte(`{"merge_strategy":"all","max_context_tokens":8000}`)
	}
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO agents (user_id, name, description, config)
		VALUES ($1,$2,$3,$4::JSONB)
		RETURNING id`,
		userID, name, strings.TrimSpace(description), string(configJSON),
	).Scan(&id)
	return id, err
}

func (s *Service) Patch(ctx context.Context, agentID uuid.UUID, userID uuid.UUID, name *string, status *string) error {
	if _, err := s.ownerAgent(ctx, agentID, userID); err != nil {
		return err
	}
	n := ""
	if name != nil {
		n = strings.TrimSpace(*name)
		if n == "" {
			return fmt.Errorf("name required")
		}
	}
	st := ""
	if status != nil {
		st = strings.TrimSpace(*status)
		if st != "active" && st != "paused" {
			return fmt.Errorf("invalid status")
		}
	}
	if name == nil && status == nil {
		return fmt.Errorf("nothing to patch")
	}
	if name != nil && status != nil {
		_, err := s.pool.Exec(ctx, `UPDATE agents SET name=$3,status=$4,updated_at=now() WHERE id=$1 AND user_id=$2`, agentID, userID, n, st)
		return err
	}
	if name != nil {
		_, err := s.pool.Exec(ctx, `UPDATE agents SET name=$3,updated_at=now() WHERE id=$1 AND user_id=$2`, agentID, userID, n)
		return err
	}
	_, err := s.pool.Exec(ctx, `UPDATE agents SET status=$3,updated_at=now() WHERE id=$1 AND user_id=$2`, agentID, userID, st)
	return err
}

func (s *Service) Delete(ctx context.Context, agentID uuid.UUID, userID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var cnt int64
	err = tx.QueryRow(ctx, `SELECT COUNT(*) FROM agents WHERE id=$1 AND user_id=$2`, agentID, userID).Scan(&cnt)
	if err != nil {
		return err
	}
	if cnt == 0 {
		return ErrNotFound
	}
	_, err = tx.Exec(ctx, `UPDATE memory_instances SET agent_id = NULL WHERE agent_id = $1`, agentID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM agents WHERE id=$1 AND user_id=$2`, agentID, userID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) GetWithLayers(ctx context.Context, agentID uuid.UUID, userID uuid.UUID) (*Agent, []LayerDetail, error) {
	a, err := s.ownerAgent(ctx, agentID, userID)
	if err != nil {
		return nil, nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT al.instance_id, m.memory_type, al.role, al.priority, al.enabled, m.name
		FROM agent_layers al
		JOIN memory_instances m ON m.id = al.instance_id AND m.user_id = $2
		WHERE al.agent_id = $1 ORDER BY al.priority ASC, al.created_at ASC`,
		agentID, userID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var layers []LayerDetail
	for rows.Next() {
		var d LayerDetail
		if err := rows.Scan(&d.InstanceID, &d.MemoryType, &d.Role, &d.Priority, &d.Enabled, &d.Name); err != nil {
			return nil, nil, err
		}
		layers = append(layers, d)
	}
	return a, layers, rows.Err()
}

func (s *Service) AddLayer(ctx context.Context, agentID uuid.UUID, userID uuid.UUID, instanceID uuid.UUID, role string, priority int) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := s.ownerAgentInTx(ctx, tx, agentID, userID); err != nil {
		return err
	}

	var memType string
	var instAgentID *uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT memory_type, agent_id FROM memory_instances WHERE id = $1 AND user_id = $2`,
		instanceID, userID).Scan(&memType, &instAgentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("instance not found")
	}
	if err != nil {
		return err
	}
	memType = strings.ToLower(strings.TrimSpace(memType))
	if instAgentID != nil && *instAgentID != agentID {
		return ErrInstanceBusy
	}
	var dup bool
	err = tx.QueryRow(ctx, `
		SELECT EXISTS (
		 SELECT 1 FROM agent_layers al
		 JOIN memory_instances m ON m.id = al.instance_id
		 WHERE al.agent_id = $1 AND lower(m.memory_type) = lower($2)
		)`, agentID, memType).Scan(&dup)
	if err != nil {
		return err
	}
	if dup {
		return ErrDupLayerType
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO agent_layers (agent_id, instance_id, role, priority)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (agent_id, instance_id) DO UPDATE SET role = EXCLUDED.role, priority = EXCLUDED.priority`,
		agentID, instanceID, strings.TrimSpace(role), priority)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `UPDATE memory_instances SET agent_id = $2 WHERE id = $1 AND user_id = $3`, instanceID, agentID, userID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) RemoveLayer(ctx context.Context, agentID uuid.UUID, userID uuid.UUID, instanceID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := s.ownerAgentInTx(ctx, tx, agentID, userID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM agent_layers WHERE agent_id = $1 AND instance_id = $2`, agentID, instanceID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE memory_instances SET agent_id = NULL WHERE id = $1 AND user_id = $2 AND agent_id = $3`, instanceID, userID, agentID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) ownerAgentInTx(ctx context.Context, tx pgx.Tx, agentID uuid.UUID, userID uuid.UUID) error {
	var dummy uuid.UUID
	err := tx.QueryRow(ctx, `
		SELECT id FROM agents WHERE id = $1 AND user_id = $2 FOR UPDATE`,
		agentID, userID).Scan(&dummy)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

type UnifiedQueryLayer struct {
	InstanceID uuid.UUID `json:"instance_id"`
	MemoryType string    `json:"memory_type"`
	Role       string    `json:"role"`
	Message    string    `json:"message"`
	TokensUsed int64     `json:"tokens_used"`
	Error      string    `json:"error,omitempty"`
}

type UnifiedQueryResult struct {
	Query       string               `json:"query"`
	Message     string               `json:"message"`
	Layers      []UnifiedQueryLayer  `json:"layers"`
	LayersUsed  []string             `json:"layers_used"`
	LayersSkip  []string             `json:"layers_skipped"`
	TotalTokens int64                `json:"tokens_used"`
}

func (s *Service) UnifiedQuery(ctx context.Context, agentID uuid.UUID, userID uuid.UUID, q string, topK int, userScope *string, sessScope *string) (*UnifiedQueryResult, error) {
	_, layers, err := s.GetWithLayers(ctx, agentID, userID)
	if err != nil {
		return nil, err
	}
	q = strings.TrimSpace(q)
	if q == "" {
		return nil, memory.ErrEmptyQuery
	}

	var wg sync.WaitGroup
	var skipped []string

	type job struct {
		d LayerDetail
	}
	active := make([]job, 0)
	for _, d := range layers {
		if !d.Enabled {
			skipped = append(skipped, strings.ToLower(d.MemoryType)+":"+d.InstanceID.String())
			continue
		}
		active = append(active, job{d: d})
	}
	sort.Slice(active, func(i, j int) bool {
		pi := active[i].d.Priority
		pj := active[j].d.Priority
		if pi != pj {
			return pi < pj
		}
		return active[i].d.MemoryType < active[j].d.MemoryType
	})

	out := make([]UnifiedQueryLayer, len(active))
	for idx, j := range active {
		idx, j := idx, j
		wg.Add(1)
		go func() {
			defer wg.Done()
			d := j.d
			mt := strings.ToLower(strings.TrimSpace(d.MemoryType))
			ul := UnifiedQueryLayer{InstanceID: d.InstanceID, MemoryType: d.MemoryType, Role: d.Role}
			if mt == "graph" || mt == "reflective" {
				ul.Error = "memory type query not implemented on platform"
				out[idx] = ul
				return
			}
			if mt != "working" {
				res, err := s.mem.Query(ctx, userID, d.InstanceID, memory.QueryInput{
					Query:        q,
					TopK:         topK,
					UserScope:    userScope,
					SessionScope: sessScope,
				})
				if err != nil {
					ul.Error = err.Error()
					out[idx] = ul
					return
				}
				ul.Message = res.Message
				ul.TokensUsed = res.TokensUsed
				out[idx] = ul
				return
			}
			ul.Message = fmt.Sprintf(`Working layer "%s": use PUT /instances/{instance_id}/working/sessions/{{session}}/keys/{{key}} to read/write; text query API does not apply.`, strings.TrimSpace(d.Role))
			ul.TokensUsed = 0
			out[idx] = ul
		}()
	}
	wg.Wait()

	var used []string
	var total int64
	var parts []string
	for _, l := range out {
		if strings.TrimSpace(l.Error) != "" {
			skipped = append(skipped, l.MemoryType+":"+l.InstanceID.String()+" (error)")
			continue
		}
		if strings.TrimSpace(l.Message) == "" {
			continue
		}
		used = append(used, l.MemoryType+":"+l.InstanceID.String())
		total += l.TokensUsed
		label := l.MemoryType
		if len(label) > 0 {
			label = strings.ToUpper(label[:1]) + label[1:]
		}
		parts = append(parts, fmt.Sprintf("[%s] %s", label, l.Message))
	}
	msg := strings.Join(parts, "\n")
	if strings.TrimSpace(msg) == "" {
		msg = "No layer returned a substantive answer."
		for _, l := range out {
			if l.Error != "" {
				skipped = append(skipped, l.MemoryType+" (error)")
			}
		}
	}

	return &UnifiedQueryResult{
		Query:       q,
		Message:     msg,
		Layers:      out,
		LayersUsed:  used,
		LayersSkip:  skipped,
		TotalTokens: total,
	}, nil
}

type UnifiedIngestInput struct {
	TargetMemoryType string
	Text             string
	UserScope        *string
	SessionScope     *string
	SourceLabel      string
	// Working-only
	SessionID    string
	Key          string
	WorkingValue json.RawMessage
}

func (s *Service) UnifiedIngest(ctx context.Context, agentID uuid.UUID, userID uuid.UUID, in UnifiedIngestInput) (*memory.IngestResult, uuid.UUID, error) {
	mt := strings.ToLower(strings.TrimSpace(in.TargetMemoryType))
	if mt == "" {
		return nil, uuid.Nil, ErrNoLayerMatch
	}
	_, layers, err := s.GetWithLayers(ctx, agentID, userID)
	if err != nil {
		return nil, uuid.Nil, err
	}

	var tgt *uuid.UUID
	for _, d := range layers {
		if !d.Enabled {
			continue
		}
		if strings.ToLower(strings.TrimSpace(d.MemoryType)) == mt {
			iid := d.InstanceID
			tgt = &iid
			break
		}
	}
	if tgt == nil {
		return nil, uuid.Nil, ErrNoLayerMatch
	}

	switch mt {
	case "working":
		if strings.TrimSpace(in.SessionID) == "" || strings.TrimSpace(in.Key) == "" {
			return nil, *tgt, fmt.Errorf("working ingest requires session_id and key JSON body")
		}
		win := memory.WorkingPutInput{Value: in.WorkingValue}
		if in.UserScope != nil {
			win.ScopeUserID = in.UserScope
		}
		if len(win.Value) == 0 {
			return nil, *tgt, fmt.Errorf("working value JSON required")
		}
		if err := s.mem.WorkingPutKey(ctx, userID, *tgt, strings.TrimSpace(in.SessionID), strings.TrimSpace(in.Key), win); err != nil {
			return nil, *tgt, err
		}
		return &memory.IngestResult{ChunksAdded: 1}, *tgt, nil
	case "rag", "wiki", "episodic":
		res, err := s.mem.Ingest(ctx, userID, *tgt, memory.IngestInput{
			Text:         in.Text,
			UserScope:    in.UserScope,
			SessionScope: in.SessionScope,
			SourceLabel:  in.SourceLabel,
		})
		return res, *tgt, err
	default:
		return nil, *tgt, ErrBadTargetType
	}
}
