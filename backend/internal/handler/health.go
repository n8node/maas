package handler

import (
	"encoding/json"
	"net/http"
)

type Health struct {
	Version string
}

func NewHealth(version string) *Health {
	return &Health{Version: version}
}

func (h *Health) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"version": h.Version,
	})
}
