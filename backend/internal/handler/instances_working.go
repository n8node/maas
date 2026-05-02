package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/n8node/maas/backend/internal/auth"
	"github.com/n8node/maas/backend/internal/memory"
)

func (h *Instances) WorkingStats(w http.ResponseWriter, r *http.Request) {
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
	stats, err := h.svc.WorkingStats(r.Context(), p.UserID, id)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if errors.Is(err, memory.ErrWorkingType) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "instance must be working memory")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": stats})
}

func (h *Instances) WorkingListSessions(w http.ResponseWriter, r *http.Request) {
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
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	filter := strings.TrimSpace(r.URL.Query().Get("filter"))
	if filter == "" {
		filter = "active"
	}
	list, err := h.svc.WorkingListSessions(r.Context(), p.UserID, id, search, filter)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if errors.Is(err, memory.ErrWorkingType) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "instance must be working memory")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"sessions": list}})
}

func (h *Instances) WorkingListKeys(w http.ResponseWriter, r *http.Request) {
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
	sessionID := chi.URLParam(r, "sessionId")
	prefix := strings.TrimSpace(r.URL.Query().Get("key_prefix"))
	list, err := h.svc.WorkingListKeys(r.Context(), p.UserID, id, sessionID, prefix)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if errors.Is(err, memory.ErrWorkingType) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "instance must be working memory")
		return
	}
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"keys": list}})
}

type workingPutBody struct {
	Value       json.RawMessage `json:"value"`
	TTLSeconds  *int64          `json:"ttl_seconds"`
	ScopeUserID *string         `json:"scope_user_id"`
}

func (h *Instances) WorkingPutKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
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
	sessionID := chi.URLParam(r, "sessionId")
	key := chi.URLParam(r, "key")

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_BODY", "could not read body")
		return
	}
	var wb workingPutBody
	if err := json.Unmarshal(body, &wb); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	if len(wb.Value) == 0 {
		wb.Value = []byte("null")
	}
	err = h.svc.WorkingPutKey(r.Context(), p.UserID, id, sessionID, key, memory.WorkingPutInput{
		Value:       wb.Value,
		TTLSeconds:  wb.TTLSeconds,
		ScopeUserID: wb.ScopeUserID,
	})
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if errors.Is(err, memory.ErrWorkingType) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "instance must be working memory")
		return
	}
	if errors.Is(err, memory.ErrWorkingKeyLimit) {
		WriteError(w, http.StatusBadRequest, "LIMIT_REACHED", err.Error())
		return
	}
	if errors.Is(err, memory.ErrWorkingJSONValue) || errors.Is(err, memory.ErrWorkingEmptyKey) || errors.Is(err, memory.ErrWorkingEmptyValue) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Instances) WorkingDeleteKey(w http.ResponseWriter, r *http.Request) {
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
	sessionID := chi.URLParam(r, "sessionId")
	key := chi.URLParam(r, "key")
	err = h.svc.WorkingDeleteKey(r.Context(), p.UserID, id, sessionID, key)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "key or instance not found")
		return
	}
	if errors.Is(err, memory.ErrWorkingType) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "instance must be working memory")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Instances) WorkingDeleteSession(w http.ResponseWriter, r *http.Request) {
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
	sessionID := chi.URLParam(r, "sessionId")
	// Disallow deleting via keys route shadowing
	if strings.Contains(sessionID, "/") {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid session id")
		return
	}
	err = h.svc.WorkingDeleteSession(r.Context(), p.UserID, id, sessionID)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if errors.Is(err, memory.ErrWorkingType) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "instance must be working memory")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Instances) WorkingFlushExpired(w http.ResponseWriter, r *http.Request) {
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
	n, err := h.svc.WorkingFlushExpired(r.Context(), p.UserID, id)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if errors.Is(err, memory.ErrWorkingType) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "instance must be working memory")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"deleted": n}})
}
