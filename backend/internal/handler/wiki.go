package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/n8node/maas/backend/internal/auth"
	"github.com/n8node/maas/backend/internal/billing"
	"github.com/n8node/maas/backend/internal/memory"
)

// Wiki exposes wiki-specific sub-resources for an instance.
type Wiki struct {
	svc *memory.Service
}

func NewWiki(svc *memory.Service) *Wiki {
	return &Wiki{svc: svc}
}

func (h *Wiki) Health(w http.ResponseWriter, r *http.Request) {
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
	m, err := h.svc.WikiHealth(r.Context(), p.UserID, id)
	if errors.Is(err, memory.ErrWikiOnly) || errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "wiki instance not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": m})
}

func (h *Wiki) Sources(w http.ResponseWriter, r *http.Request) {
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
	list, err := h.svc.ListWikiSources(r.Context(), p.UserID, id)
	if errors.Is(err, memory.ErrWikiOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, s := range list {
		m := map[string]any{
			"id":            s.ID.String(),
			"title":         s.Title,
			"segment_count": s.SegmentCount,
			"created_at":    s.CreatedAt.UTC().Format(time.RFC3339Nano),
		}
		if s.UserScope != nil {
			m["user_scope"] = *s.UserScope
		}
		out = append(out, m)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"sources": out}})
}

func (h *Wiki) Concepts(w http.ResponseWriter, r *http.Request) {
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
	q := r.URL.Query().Get("search")
	list, err := h.svc.ListWikiConcepts(r.Context(), p.UserID, id, q, 80)
	if errors.Is(err, memory.ErrWikiOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"concepts": list}})
}

func (h *Wiki) GetConcept(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	iid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "conceptId"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid concept id")
		return
	}
	row, err := h.svc.GetWikiConcept(r.Context(), p.UserID, iid, cid)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "concept not found")
		return
	}
	if errors.Is(err, memory.ErrWikiOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"concept": row}})
}

func (h *Wiki) ActionLog(w http.ResponseWriter, r *http.Request) {
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
	list, err := h.svc.ListWikiActionLog(r.Context(), p.UserID, id, 120)
	if errors.Is(err, memory.ErrWikiOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"entries": list}})
}

func (h *Wiki) Proposals(w http.ResponseWriter, r *http.Request) {
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
	st := r.URL.Query().Get("status")
	list, err := h.svc.ListWikiProposals(r.Context(), p.UserID, id, st)
	if errors.Is(err, memory.ErrWikiOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"proposals": list}})
}

func (h *Wiki) RepairConcepts(w http.ResponseWriter, r *http.Request) {
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
	list, err := h.svc.ListWikiRepairConcepts(r.Context(), p.UserID, id)
	if errors.Is(err, memory.ErrWikiOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"concepts": list}})
}

func (h *Wiki) Triage(w http.ResponseWriter, r *http.Request) {
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
	n, err := h.svc.RunWikiGardenerTriage(r.Context(), p.UserID, id)
	if errors.Is(err, memory.ErrWikiOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if errors.Is(err, memory.ErrGardenerNotAllowed) {
		WriteError(w, http.StatusForbidden, "GARDENER_DISABLED", "gardener is not enabled on your plan")
		return
	}
	if errors.Is(err, billing.ErrTokensExhausted) {
		WriteError(w, http.StatusPaymentRequired, "TOKENS_EXHAUSTED", "insufficient tokens")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	data := map[string]any{
		"proposals_added": n.ProposalsAdded,
		"heuristic_added": n.HeuristicAdded,
		"llm_added":       n.LLMAdded,
		"tokens_used":     n.TokensUsed,
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": data})
}

type patchConceptBody struct {
	State       *string `json:"state"`
	Description *string `json:"description"`
}

func (h *Wiki) PatchConcept(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	iid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "conceptId"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid concept id")
		return
	}
	var body patchConceptBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	err = h.svc.PatchWikiConcept(r.Context(), p.UserID, iid, cid, memory.PatchWikiConceptInput{
		State: body.State, Description: body.Description,
	})
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "concept not found")
		return
	}
	if errors.Is(err, memory.ErrWikiOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Wiki) ApproveProposal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	iid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	pid, err := uuid.Parse(chi.URLParam(r, "proposalId"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid proposal id")
		return
	}
	err = h.svc.ApproveWikiProposal(r.Context(), p.UserID, iid, pid)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "proposal not found")
		return
	}
	if errors.Is(err, memory.ErrWikiOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if errors.Is(err, billing.ErrTokensExhausted) {
		WriteError(w, http.StatusPaymentRequired, "TOKENS_EXHAUSTED", "insufficient tokens")
		return
	}
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Wiki) RejectProposal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	iid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	pid, err := uuid.Parse(chi.URLParam(r, "proposalId"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid proposal id")
		return
	}
	err = h.svc.RejectWikiProposal(r.Context(), p.UserID, iid, pid)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "proposal not found")
		return
	}
	if errors.Is(err, memory.ErrWikiOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Wiki) DismissProposal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	iid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	pid, err := uuid.Parse(chi.URLParam(r, "proposalId"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid proposal id")
		return
	}
	err = h.svc.DismissWikiProposal(r.Context(), p.UserID, iid, pid)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "proposal not found")
		return
	}
	if errors.Is(err, memory.ErrWikiOnly) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
