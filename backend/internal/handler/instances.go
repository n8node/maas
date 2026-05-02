package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/n8node/maas/backend/internal/auth"
	"github.com/n8node/maas/backend/internal/billing"
	"github.com/n8node/maas/backend/internal/memory"
)

type Instances struct {
	svc *memory.Service
}

func NewInstances(svc *memory.Service) *Instances {
	return &Instances{svc: svc}
}

func (h *Instances) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	list, err := h.svc.List(r.Context(), p.UserID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, m := range list {
		out = append(out, memory.InstanceToJSON(m))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"instances": out}})
}

type createBody struct {
	Name       string         `json:"name"`
	MemoryType string         `json:"memory_type"`
	Config     map[string]any `json:"config"`
}

func (h *Instances) Create(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	var body createBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	id, err := h.svc.Create(r.Context(), p.UserID, memory.CreateInput{
		Name: body.Name, MemoryType: body.MemoryType, Config: body.Config,
	})
	if errors.Is(err, memory.ErrLimitReached) {
		WriteError(w, http.StatusForbidden, "LIMIT_REACHED", err.Error())
		return
	}
	if errors.Is(err, memory.ErrInvalidType) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"id": id.String()}})
}

func (h *Instances) Get(w http.ResponseWriter, r *http.Request) {
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
	m, err := h.svc.Get(r.Context(), p.UserID, id)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"instance": memory.InstanceToJSON(*m)}})
}

type patchBody struct {
	Name   *string        `json:"name"`
	Status *string        `json:"status"`
	Config map[string]any `json:"config"`
}

func (h *Instances) Patch(w http.ResponseWriter, r *http.Request) {
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
	var body patchBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	err = h.svc.Patch(r.Context(), p.UserID, id, memory.PatchInput{
		Name: body.Name, Status: body.Status, Config: body.Config,
	})
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Instances) Delete(w http.ResponseWriter, r *http.Request) {
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
	err = h.svc.Delete(r.Context(), p.UserID, id)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type ingestBody struct {
	Text        string  `json:"text"`
	UserID      *string `json:"user_id"`
	SourceLabel string  `json:"source_label"`
}

func (h *Instances) Ingest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
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
	var body ingestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	res, err := h.svc.Ingest(r.Context(), p.UserID, id, memory.IngestInput{
		Text: body.Text, UserScope: body.UserID, SourceLabel: body.SourceLabel,
	})
	if errors.Is(err, billing.ErrTokensExhausted) {
		WriteError(w, http.StatusPaymentRequired, "TOKENS_EXHAUSTED", "insufficient tokens")
		return
	}
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if errors.Is(err, memory.ErrEmptyContent) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{
			"chunks_added":    res.ChunksAdded,
			"tokens_consumed": res.TokensConsumed,
		},
	})
}

type queryBody struct {
	Query    string  `json:"query"`
	TopK     int     `json:"top_k"`
	UserID   *string `json:"user_id"`
}

func (h *Instances) Query(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
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
	var body queryBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	res, err := h.svc.Query(r.Context(), p.UserID, id, memory.QueryInput{
		Query: body.Query, TopK: body.TopK, UserScope: body.UserID,
	})
	if errors.Is(err, billing.ErrTokensExhausted) {
		WriteError(w, http.StatusPaymentRequired, "TOKENS_EXHAUSTED", "insufficient tokens")
		return
	}
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if errors.Is(err, memory.ErrEmptyQuery) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"message":     res.Message,
		"citations":   res.Citations,
		"tokens_used": res.TokensUsed,
	}})
}
