package handler

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/n8node/maas/backend/internal/auth"
	"github.com/n8node/maas/backend/internal/billing"
	"github.com/n8node/maas/backend/internal/memory"
	"github.com/n8node/maas/backend/internal/models"
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
	Text        string `json:"text"`
	UserID      *string `json:"user_id"`
	SourceLabel string `json:"source_label"`
	SourceTitle string `json:"source_title"`
	Concepts    []struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	} `json:"concepts"`
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
	concepts := make([]memory.WikiConceptInput, 0, len(body.Concepts))
	for _, c := range body.Concepts {
		concepts = append(concepts, memory.WikiConceptInput{Title: c.Title, Description: c.Description})
	}
	res, err := h.svc.Ingest(r.Context(), p.UserID, id, memory.IngestInput{
		Text:        body.Text,
		UserScope:   body.UserID,
		SourceLabel: body.SourceLabel,
		SourceTitle: body.SourceTitle,
		Concepts:    concepts,
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
	if errors.Is(err, memory.ErrInvalidType) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{
			"chunks_added":           res.ChunksAdded,
			"tokens_consumed":      res.TokensConsumed,
			"wiki_concepts_added":  res.WikiConceptsAdded,
			"wiki_extraction_note": res.WikiExtractionNote,
		},
	})
}

type queryBody struct {
	Query      string  `json:"query"`
	TopK       int     `json:"top_k"`
	UserID     *string `json:"user_id"`
	Synthesize *bool   `json:"synthesize"` // omit or true = LLM answer when configured; false = citations only
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
		Query:      body.Query,
		TopK:       body.TopK,
		UserScope:  body.UserID,
		Synthesize: body.Synthesize,
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
	if errors.Is(err, memory.ErrInvalidType) {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	data := map[string]any{
		"message":      res.Message,
		"citations":    res.Citations,
		"tokens_used":  res.TokensUsed,
		"synthesized":  res.Synthesized,
	}
	if len(res.WikiRelatedConcepts) > 0 {
		data["wiki_related_concepts"] = res.WikiRelatedConcepts
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": data})
}

func (h *Instances) IngestFile(w http.ResponseWriter, r *http.Request) {
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
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_FORM", "multipart form required")
		return
	}
	fh, hdr, err := r.FormFile("file")
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "missing file field")
		return
	}
	defer fh.Close()
	body, err := io.ReadAll(fh)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "could not read file")
		return
	}
	filename := filepath.Base(hdr.Filename)
	if filename == "" || filename == "." {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid filename")
		return
	}
	mt := hdr.Header.Get("Content-Type")
	if s, _, err := mime.ParseMediaType(mt); err == nil && s != "" {
		mt = s
	}
	var userScope *string
	if v := r.FormValue("user_id"); v != "" {
		userScope = &v
	}
	res, err := h.svc.IngestFile(r.Context(), p.UserID, id, memory.FileIngestInput{
		Filename:  filename,
		MimeType:  mt,
		Body:      body,
		UserScope: userScope,
	})
	if errors.Is(err, memory.ErrEmbeddingsDisabled) {
		WriteError(w, http.StatusServiceUnavailable, "EMBEDDINGS_DISABLED", "configure embeddings and LLM API access on the server to ingest files with vectors")
		return
	}
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
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"source_id":              res.SourceID.String(),
		"chunks_added":         res.ChunksAdded,
		"tokens_consumed":      res.TokensConsumed,
		"embedding_model":      res.EmbeddingModel,
		"wiki_concepts_added":  res.WikiConceptsAdded,
		"wiki_extraction_note": res.WikiExtractionNote,
	}})
}

func (h *Instances) ListSources(w http.ResponseWriter, r *http.Request) {
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
	list, err := h.svc.ListSources(r.Context(), p.UserID, id)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "instance not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, s := range list {
		out = append(out, ragSourceToJSON(s))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"sources": out}})
}

func ragSourceToJSON(s models.RAGSource) map[string]any {
	return map[string]any{
		"id":               s.ID.String(),
		"instance_id":      s.InstanceID.String(),
		"filename":         s.Filename,
		"byte_size":        s.ByteSize,
		"mime_type":        s.MimeType,
		"embedding_model":  s.EmbeddingModel,
		"tokens_total":     s.TokensTotal,
		"chunk_count":      s.ChunkCount,
		"created_at":       s.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func (h *Instances) ListSourceChunks(w http.ResponseWriter, r *http.Request) {
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
	sid, err := uuid.Parse(chi.URLParam(r, "sourceId"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid source id")
		return
	}
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	offset := 0
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	rows, total, err := h.svc.ListChunksBySource(r.Context(), p.UserID, iid, sid, limit, offset)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, c := range rows {
		m := map[string]any{
			"id":              c.ID.String(),
			"content":         c.Content,
			"token_estimate":  c.TokenEstimate,
			"created_at":      c.CreatedAt.UTC().Format(time.RFC3339Nano),
			"ordinal":         c.Ordinal,
		}
		if len(c.Embedding) > 0 {
			m["embedding"] = c.Embedding
		} else {
			m["embedding"] = nil
		}
		out = append(out, m)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"chunks": out, "total": total}})
}

func (h *Instances) DeleteChunk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
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
	cid, err := uuid.Parse(chi.URLParam(r, "chunkId"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid chunk id")
		return
	}
	err = h.svc.DeleteChunk(r.Context(), p.UserID, iid, cid)
	if errors.Is(err, memory.ErrNotFound) {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "chunk not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
