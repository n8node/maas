package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/n8node/maas/backend/internal/auth"
	"github.com/n8node/maas/backend/internal/config"
	"github.com/n8node/maas/backend/internal/repository"
)

type Auth struct {
	cfg       *config.Config
	users     *repository.UserRepo
	jwtTTL    time.Duration
	jwtSecret []byte
}

func NewAuth(cfg *config.Config, users *repository.UserRepo) *Auth {
	return &Auth{
		cfg:       cfg,
		users:     users,
		jwtTTL:    7 * 24 * time.Hour,
		jwtSecret: []byte(cfg.JWTSecret),
	}
}

type registerReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type tokenResponse struct {
	Data struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int64  `json:"expires_in"`
	} `json:"data"`
}

func (h *Auth) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	var req registerReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if err := validateEmail(req.Email); err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if len(req.Password) < 8 {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "password must be at least 8 characters")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "could not hash password")
		return
	}
	u, err := h.users.Create(r.Context(), req.Email, hash, "user")
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			WriteError(w, http.StatusConflict, "CONFLICT", "email already registered")
			return
		}
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "registration failed")
		return
	}
	token, err := auth.SignJWT(h.jwtSecret, u.ID, u.Email, u.Role, h.jwtTTL)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "could not issue token")
		return
	}
	var res tokenResponse
	res.Data.AccessToken = token
	res.Data.TokenType = "Bearer"
	res.Data.ExpiresIn = int64(h.jwtTTL.Seconds())
	WriteJSON(w, http.StatusCreated, res)
}

func (h *Auth) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	u, err := h.users.GetByEmail(r.Context(), req.Email)
	if err != nil {
		if err == repository.ErrNotFound {
			WriteError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid email or password")
			return
		}
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "login failed")
		return
	}
	if !auth.CheckPassword(u.PasswordHash, req.Password) {
		WriteError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid email or password")
		return
	}
	token, err := auth.SignJWT(h.jwtSecret, u.ID, u.Email, u.Role, h.jwtTTL)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "could not issue token")
		return
	}
	var res tokenResponse
	res.Data.AccessToken = token
	res.Data.TokenType = "Bearer"
	res.Data.ExpiresIn = int64(h.jwtTTL.Seconds())
	WriteJSON(w, http.StatusOK, res)
}

func (h *Auth) Me(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{
			"user": map[string]any{
				"id":    p.UserID.String(),
				"email": p.Email,
				"role":  p.Role,
			},
		},
	})
}

func validateEmail(s string) error {
	if s == "" {
		return validationErr("email is required")
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s {
		return validationErr("invalid email")
	}
	return nil
}

type validationErr string

func (e validationErr) Error() string { return string(e) }
