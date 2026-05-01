package handler

import (
	"net/http"
)

func AdminPing(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{"ok": true},
	})
}
