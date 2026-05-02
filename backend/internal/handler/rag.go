package handler

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/n8node/maas/backend/internal/auth"
	"github.com/n8node/maas/backend/internal/memory"
)

// Rag exposes RAG-specific dashboard endpoints for an instance.
type Rag struct {
	svc *memory.Service
}

func NewRag(svc *memory.Service) *Rag {
	return &Rag{svc: svc}
}

func (h *Rag) Stats(w http.ResponseWriter, r *http.Request) {
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
	st, err := h.svc.RAGDashboardStats(r.Context(), p.UserID, id)
	if errors.Is(err, memory.ErrRagOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": st})
}

func (h *Rag) Topics(w http.ResponseWriter, r *http.Request) {
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
	list, err := h.svc.ListRAGTopicClusters(r.Context(), p.UserID, id)
	if errors.Is(err, memory.ErrRagOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"topics": list}})
}
