package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/n8node/maas/backend/internal/agent"
	"github.com/n8node/maas/backend/internal/auth"
	"github.com/n8node/maas/backend/internal/memory"
)

type Agents struct {
	svc *agent.Service
}

func NewAgents(svc *agent.Service) *Agents {
	return &Agents{svc: svc}
}

func (h *Agents) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	list, err := h.svc.ListAgents(r.Context(), p.UserID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, a := range list {
		out = append(out, agentRow(a))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"agents": out}})
}

type createAgentBody struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Config      any    `json:"config"`
}

func (h *Agents) Create(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	var body createAgentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	var cfgJSON []byte
	var err error
	if body.Config != nil {
		cfgJSON, err = json.Marshal(body.Config)
		if err != nil {
			WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid config")
			return
		}
	}
	id, err := h.svc.Create(r.Context(), p.UserID, body.Name, body.Description, cfgJSON)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"agent_id": id.String()}})
}

func (h *Agents) Get(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	a, layers, err := h.svc.GetWithLayers(r.Context(), id, p.UserID)
	if errors.Is(err, agent.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "agent not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	layersOut := make([]map[string]any, 0, len(layers))
	for _, d := range layers {
		layersOut = append(layersOut, map[string]any{
			"instance_id":   d.InstanceID.String(),
			"memory_type":   d.MemoryType,
			"name":          d.Name,
			"role":          d.Role,
			"priority":      d.Priority,
			"enabled":       d.Enabled,
		})
	}
	data := agentRow(*a)
	data["layers"] = layersOut
	WriteJSON(w, http.StatusOK, map[string]any{"data": data})
}

type patchAgentBody struct {
	Name   *string `json:"name"`
	Status *string `json:"status"`
}

func (h *Agents) Patch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	var body patchAgentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	if err := h.svc.Patch(r.Context(), id, p.UserID, body.Name, body.Status); err != nil {
		if errors.Is(err, agent.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "NOT_FOUND", "agent not found")
			return
		}
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Agents) Delete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	if err := h.svc.Delete(r.Context(), id, p.UserID); err != nil {
		if errors.Is(err, agent.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "NOT_FOUND", "agent not found")
			return
		}
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type addLayerBody struct {
	InstanceID string `json:"instance_id"`
	Role       string `json:"role"`
	Priority   int    `json:"priority"`
}

func (h *Agents) AddLayer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	aid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid agent id")
		return
	}
	var body addLayerBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	iid, err := uuid.Parse(strings.TrimSpace(body.InstanceID))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid instance_id")
		return
	}
	if body.Priority == 0 {
		body.Priority = 1
	}
	if err := h.svc.AddLayer(r.Context(), aid, p.UserID, iid, body.Role, body.Priority); err != nil {
		switch {
		case errors.Is(err, agent.ErrNotFound):
			WriteError(w, http.StatusNotFound, "NOT_FOUND", "agent not found")
		case errors.Is(err, agent.ErrDupLayerType):
			WriteError(w, http.StatusConflict, "CONFLICT", err.Error())
		case errors.Is(err, agent.ErrInstanceBusy):
			WriteError(w, http.StatusConflict, "CONFLICT", err.Error())
		default:
			WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Agents) RemoveLayer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	aid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid agent id")
		return
	}
	iid, err := uuid.Parse(chi.URLParam(r, "instanceId"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid instance id")
		return
	}
	if err := h.svc.RemoveLayer(r.Context(), aid, p.UserID, iid); err != nil {
		if errors.Is(err, agent.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "NOT_FOUND", "agent not found")
			return
		}
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type agentQueryBody struct {
	Query        string  `json:"query"`
	TopK         int     `json:"top_k"`
	UserIDScope  *string `json:"user_id"`
	SessionScope *string `json:"session_id"`
}

func (h *Agents) Query(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	aid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid agent id")
		return
	}
	var body agentQueryBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	res, err := h.svc.UnifiedQuery(r.Context(), aid, p.UserID, body.Query, body.TopK, body.UserIDScope, body.SessionScope)
	if errors.Is(err, memory.ErrEmptyQuery) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if errors.Is(err, agent.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "agent not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	layers := make([]map[string]any, 0, len(res.Layers))
	for _, l := range res.Layers {
		m := map[string]any{
			"instance_id": l.InstanceID.String(),
			"memory_type": l.MemoryType,
			"role":        l.Role,
			"message":     l.Message,
			"tokens_used": l.TokensUsed,
		}
		if l.Error != "" {
			m["error"] = l.Error
		}
		layers = append(layers, m)
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{
			"query":          res.Query,
			"message":        res.Message,
			"layers":         layers,
			"layers_used":    res.LayersUsed,
			"layers_skipped": res.LayersSkip,
			"tokens_used":    res.TotalTokens,
		},
	})
}

type agentIngestBody struct {
	TargetMemoryType string          `json:"target_memory_type"`
	Text             string          `json:"text"`
	UserScope        *string         `json:"user_id"`
	SessionScope     *string         `json:"session_id"`
	SourceLabel      string          `json:"source_label"`
	WorkingSessionID string          `json:"working_session_id"`
	Key              string          `json:"key"`
	Value            json.RawMessage `json:"value"`
}

func (h *Agents) Ingest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	aid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid agent id")
		return
	}
	var body agentIngestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	res, iid, err := h.svc.UnifiedIngest(r.Context(), aid, p.UserID, agent.UnifiedIngestInput{
		TargetMemoryType: body.TargetMemoryType,
		Text:             body.Text,
		UserScope:        body.UserScope,
		SessionScope:     body.SessionScope,
		SourceLabel:      body.SourceLabel,
		SessionID:        body.WorkingSessionID,
		Key:              body.Key,
		WorkingValue:     body.Value,
	})
	if errors.Is(err, agent.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "agent not found")
		return
	}
	if errors.Is(err, agent.ErrNoLayerMatch) || errors.Is(err, agent.ErrBadTargetType) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{
			"instance_id":            iid.String(),
			"chunks_added":           res.ChunksAdded,
			"tokens_consumed":        res.TokensConsumed,
			"wiki_concepts_added":    res.WikiConceptsAdded,
			"wiki_extraction_note":   res.WikiExtractionNote,
		},
	})
}

func agentRow(a agent.Agent) map[string]any {
	var cfg any
	_ = json.Unmarshal(a.Config, &cfg)
	if cfg == nil {
		cfg = map[string]any{}
	}
	return map[string]any{
		"id":          a.ID.String(),
		"name":        a.Name,
		"description": a.Description,
		"config":      cfg,
		"status":      a.Status,
		"created_at":  a.CreatedAt.UTC().Format(timeRFC3339Nano),
		"updated_at":  a.UpdatedAt.UTC().Format(timeRFC3339Nano),
	}
}
