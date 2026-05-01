package handler

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/n8node/maas/backend/internal/auth"
	"github.com/n8node/maas/backend/internal/config"
	"github.com/n8node/maas/backend/internal/models"
	"github.com/n8node/maas/backend/internal/repository"
)

type APIKeys struct {
	cfg       *config.Config
	repo      *repository.APIKeyRepo
	prefixLen int
}

func NewAPIKeys(cfg *config.Config, repo *repository.APIKeyRepo) *APIKeys {
	return &APIKeys{cfg: cfg, repo: repo, prefixLen: 16}
}

type createKeyReq struct {
	Name string `json:"name"`
}

type apiKeyRow struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	KeyPrefix  string  `json:"key_prefix"`
	CreatedAt  string  `json:"created_at"`
	LastUsedAt *string `json:"last_used_at,omitempty"`
}

const timeRFC3339Nano = "2006-01-02T15:04:05.999999999Z07:00"

func (h *APIKeys) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	keys, err := h.repo.ListByUser(r.Context(), p.UserID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
		return
	}
	out := make([]apiKeyRow, 0, len(keys))
	for _, k := range keys {
		out = append(out, apiKeyToPublic(k))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"api_keys": out}})
}

func (h *APIKeys) Create(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	var req createKeyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if len(req.Name) < 1 || len(req.Name) > 128 {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "name must be 1–128 characters")
		return
	}
	fullKey, prefix, err := generateAPIKey(h.prefixLen)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "could not generate key")
		return
	}
	if h.cfg.APIKeySalt == "" {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "API_KEY_SALT is not configured")
		return
	}
	hash := auth.HashAPIKey(h.cfg.APIKeySalt, fullKey)
	k, err := h.repo.Create(r.Context(), p.UserID, req.Name, hash, prefix)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "could not save api key")
		return
	}
	WriteJSON(w, http.StatusCreated, map[string]any{
		"data": map[string]any{
			"api_key": map[string]any{
				"id":         k.ID.String(),
				"name":       k.Name,
				"key":        fullKey,
				"key_prefix": k.KeyPrefix,
				"created_at": k.CreatedAt.UTC().Format(timeRFC3339Nano),
				"warning":    "store this key securely; it will not be shown again",
			},
		},
	})
}

func (h *APIKeys) Delete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	idStr := chi.URLParam(r, "id")
	keyID, err := uuid.Parse(idStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	okDel, err := h.repo.Delete(r.Context(), p.UserID, keyID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "delete failed")
		return
	}
	if !okDel {
		WriteError(w, http.StatusNotFound, "NOT_FOUND", "api key not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func apiKeyToPublic(k models.APIKey) apiKeyRow {
	var last *string
	if k.LastUsedAt != nil {
		s := k.LastUsedAt.UTC().Format(timeRFC3339Nano)
		last = &s
	}
	return apiKeyRow{
		ID:         k.ID.String(),
		Name:       k.Name,
		KeyPrefix:  k.KeyPrefix,
		CreatedAt:  k.CreatedAt.UTC().Format(timeRFC3339Nano),
		LastUsedAt: last,
	}
}

func generateAPIKey(prefixLen int) (fullKey, prefix string, err error) {
	if prefixLen < 8 {
		return "", "", errors.New("prefix too short")
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	enc := base64.RawURLEncoding.EncodeToString(raw)
	fullKey = "mnq_" + enc
	if len(fullKey) < prefixLen {
		return "", "", errors.New("generated key too short")
	}
	prefix = fullKey[:prefixLen]
	return fullKey, prefix, nil
}
