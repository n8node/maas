package middleware

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/n8node/maas/backend/internal/auth"
	"github.com/n8node/maas/backend/internal/config"
	"github.com/n8node/maas/backend/internal/repository"
)

type AuthDeps struct {
	Cfg   *config.Config
	Users *repository.UserRepo
	Keys  *repository.APIKeyRepo
}

// Authenticate accepts either Authorization: Bearer <JWT> or X-API-Key: <key>.
func Authenticate(d AuthDeps) func(http.Handler) http.Handler {
	secret := []byte(d.Cfg.JWTSecret)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if p, ok := tryBearer(r, secret, d.Users); ok {
				next.ServeHTTP(w, r.WithContext(auth.WithPrincipal(r.Context(), p)))
				return
			}
			if d.Cfg.APIKeySalt != "" {
				if p, ok := tryAPIKey(r, d); ok {
					next.ServeHTTP(w, r.WithContext(auth.WithPrincipal(r.Context(), p)))
					return
				}
			}
			writeJSONErr(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid authentication")
		})
	}
}

// RequireSuperAdmin must be used after Authenticate.
func RequireSuperAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := auth.PrincipalFromContext(r.Context())
		if !ok || p.Role != "superadmin" {
			writeJSONErr(w, http.StatusForbidden, "FORBIDDEN", "superadmin only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func tryBearer(r *http.Request, secret []byte, users *repository.UserRepo) (*auth.Principal, bool) {
	h := r.Header.Get("Authorization")
	if h == "" {
		return nil, false
	}
	const pfx = "Bearer "
	if !strings.HasPrefix(h, pfx) {
		return nil, false
	}
	raw := strings.TrimSpace(strings.TrimPrefix(h, pfx))
	if raw == "" || len(secret) < 16 {
		return nil, false
	}
	claims, err := auth.ParseJWT(secret, raw)
	if err != nil {
		return nil, false
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		return nil, false
	}
	u, err := users.GetByID(r.Context(), uid)
	if err != nil {
		return nil, false
	}
	return &auth.Principal{UserID: u.ID, Email: u.Email, Role: u.Role}, true
}

func tryAPIKey(r *http.Request, d AuthDeps) (*auth.Principal, bool) {
	raw := strings.TrimSpace(r.Header.Get("X-API-Key"))
	if raw == "" || len(raw) < 16 {
		return nil, false
	}
	prefix := raw[:16]
	row, err := d.Keys.FindByKeyPrefix(r.Context(), prefix)
	if err != nil {
		return nil, false
	}
	want := auth.HashAPIKey(d.Cfg.APIKeySalt, raw)
	if subtle.ConstantTimeCompare([]byte(want), []byte(row.KeyHash)) != 1 {
		return nil, false
	}
	_ = d.Keys.Touch(r.Context(), row.ID)
	u, err := d.Users.GetByID(r.Context(), row.UserID)
	if err != nil {
		return nil, false
	}
	return &auth.Principal{UserID: u.ID, Email: u.Email, Role: u.Role}, true
}

func writeJSONErr(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"code": code, "message": msg},
	})
}
