package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/n8node/maas/backend/internal/auth"
	"github.com/n8node/maas/backend/internal/billing"
)

type Billing struct {
	svc *billing.Service
}

func NewBilling(svc *billing.Service) *Billing {
	return &Billing{svc: svc}
}

func (h *Billing) ListPlans(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	plans, err := h.svc.ListPlansPublic(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "could not list plans")
		return
	}
	out := make([]map[string]any, 0, len(plans))
	for _, p := range plans {
		out = append(out, billing.PlanToJSON(p))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"plans": out}})
}

func (h *Billing) ListTokenPackagesPublic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	pkgs, err := h.svc.ListTokenPackages(r.Context(), true)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "could not list packages")
		return
	}
	list := make([]map[string]any, 0, len(pkgs))
	for _, p := range pkgs {
		list = append(list, map[string]any{
			"id":         p.ID.String(),
			"name":       p.Name,
			"tokens":     p.Tokens,
			"price_rub":  p.PriceRUB,
			"sort_order": p.SortOrder,
		})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"packages": list}})
}

func (h *Billing) Me(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	sum, err := h.svc.GetSummary(r.Context(), p.UserID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "billing summary failed")
		return
	}
	pay, _ := h.svc.ListPaymentsUser(r.Context(), p.UserID, 20)
	data := map[string]any{
		"tokens_remaining": sum.TokensLeft,
		"buckets":          sum.Buckets,
		"payments":         pay,
	}
	if sum.Subscription != nil {
		data["subscription"] = map[string]any{
			"id":                    sum.Subscription.ID.String(),
			"status":                sum.Subscription.Status,
			"current_period_start":  sum.Subscription.CurrentPeriodStart.UTC().Format("2006-01-02T15:04:05Z07:00"),
			"current_period_end":    sum.Subscription.CurrentPeriodEnd.UTC().Format("2006-01-02T15:04:05Z07:00"),
			"cancel_at_period_end":  sum.Subscription.CancelAtPeriodEnd,
		}
	}
	if sum.Plan != nil {
		data["plan"] = billing.PlanToJSON(*sum.Plan)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": data})
}

type subscribeBody struct {
	PlanSlug string `json:"plan_slug"`
}

func (h *Billing) Subscribe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	var body subscribeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	if err := h.svc.Subscribe(r.Context(), p.UserID, billing.SubscribeInput{PlanSlug: body.PlanSlug}); err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type cancelBody struct {
	CancelAtPeriodEnd bool `json:"cancel_at_period_end"`
}

func (h *Billing) Cancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	var body cancelBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	if err := h.svc.Cancel(r.Context(), p.UserID, billing.CancelInput{CancelAtPeriodEnd: body.CancelAtPeriodEnd}); err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "cancel failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type consumeBody struct {
	Amount int64 `json:"amount"`
}

func (h *Billing) Consume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing authentication")
		return
	}
	var body consumeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	err := h.svc.ConsumeTokens(r.Context(), p.UserID, body.Amount)
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

type BillingAdmin struct {
	svc *billing.Service
}

func NewBillingAdmin(svc *billing.Service) *BillingAdmin {
	return &BillingAdmin{svc: svc}
}

func (a *BillingAdmin) ListPlans(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	plans, err := a.svc.ListPlansAdmin(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
		return
	}
	out := make([]map[string]any, 0, len(plans))
	for _, p := range plans {
		out = append(out, billing.PlanToJSON(p))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"plans": out}})
}

type planBody struct {
	Name               string   `json:"name"`
	Slug               string   `json:"slug"`
	PriceMonthlyRUB    int      `json:"price_monthly_rub"`
	PriceYearlyRUB     int      `json:"price_yearly_rub"`
	MaxInstances       int      `json:"max_instances"`
	MonthlyTokens      int64    `json:"monthly_tokens"`
	MaxStorageMB       int64    `json:"max_storage_mb"`
	AllowedMemoryTypes []string `json:"allowed_memory_types"`
	SortOrder          int      `json:"sort_order"`
	IsPublic           bool     `json:"is_public"`
	IsArchived         bool     `json:"is_archived"`
}

func (a *BillingAdmin) CreatePlan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	var body planBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	if body.AllowedMemoryTypes == nil {
		body.AllowedMemoryTypes = []string{"rag"}
	}
	id, err := a.svc.AdminCreatePlan(r.Context(), billing.PlanUpsert{
		Name: body.Name, Slug: body.Slug, PriceMonthlyRUB: body.PriceMonthlyRUB, PriceYearlyRUB: body.PriceYearlyRUB,
		MaxInstances: body.MaxInstances, MonthlyTokens: body.MonthlyTokens, MaxStorageMB: body.MaxStorageMB,
		AllowedMemoryTypes: body.AllowedMemoryTypes, SortOrder: body.SortOrder, IsPublic: body.IsPublic, IsArchived: body.IsArchived,
	})
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"id": id.String()}})
}

func (a *BillingAdmin) UpdatePlan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	var body planBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	if body.AllowedMemoryTypes == nil {
		body.AllowedMemoryTypes = []string{"rag"}
	}
	if err := a.svc.AdminUpdatePlan(r.Context(), id, billing.PlanUpsert{
		Name: body.Name, Slug: body.Slug, PriceMonthlyRUB: body.PriceMonthlyRUB, PriceYearlyRUB: body.PriceYearlyRUB,
		MaxInstances: body.MaxInstances, MonthlyTokens: body.MonthlyTokens, MaxStorageMB: body.MaxStorageMB,
		AllowedMemoryTypes: body.AllowedMemoryTypes, SortOrder: body.SortOrder, IsPublic: body.IsPublic, IsArchived: body.IsArchived,
	}); err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type pkgBody struct {
	Name      string `json:"name"`
	Tokens    int64  `json:"tokens"`
	PriceRUB  int    `json:"price_rub"`
	SortOrder int    `json:"sort_order"`
	IsActive  bool   `json:"is_active"`
}

func (a *BillingAdmin) ListPackages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	pkgs, err := a.svc.ListTokenPackages(r.Context(), false)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
		return
	}
	list := make([]map[string]any, 0, len(pkgs))
	for _, p := range pkgs {
		list = append(list, map[string]any{
			"id": p.ID.String(), "name": p.Name, "tokens": p.Tokens, "price_rub": p.PriceRUB,
			"is_active": p.IsActive, "sort_order": p.SortOrder,
			"created_at": p.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"packages": list}})
}

func (a *BillingAdmin) CreatePackage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	var body pkgBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	id, err := a.svc.AdminCreatePackage(r.Context(), billing.PackageUpsert{
		Name: body.Name, Tokens: body.Tokens, PriceRUB: body.PriceRUB, SortOrder: body.SortOrder, IsActive: body.IsActive,
	})
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"id": id.String()}})
}

func (a *BillingAdmin) UpdatePackage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	var body pkgBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	if err := a.svc.AdminUpdatePackage(r.Context(), id, billing.PackageUpsert{
		Name: body.Name, Tokens: body.Tokens, PriceRUB: body.PriceRUB, SortOrder: body.SortOrder, IsActive: body.IsActive,
	}); err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type manualPaymentBody struct {
	UserID        string  `json:"user_id"`
	PackageID     *string `json:"package_id"`
	PlanID        *string `json:"plan_id"`
	AmountKopecks int     `json:"amount_kopecks"`
	Notes         string  `json:"notes"`
}

func (a *BillingAdmin) RecordPayment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	var body manualPaymentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_JSON", "invalid json body")
		return
	}
	uid, err := uuid.Parse(body.UserID)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid user_id")
		return
	}
	in := billing.ManualPaymentInput{UserID: uid, AmountKopecks: body.AmountKopecks, Notes: body.Notes}
	if body.PackageID != nil && *body.PackageID != "" {
		pid, err := uuid.Parse(*body.PackageID)
		if err != nil {
			WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid package_id")
			return
		}
		in.PackageID = &pid
	}
	if body.PlanID != nil && *body.PlanID != "" {
		plid, err := uuid.Parse(*body.PlanID)
		if err != nil {
			WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid plan_id")
			return
		}
		in.PlanID = &plid
	}
	id, err := a.svc.RecordManualPayment(r.Context(), in)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"payment_id": id.String()}})
}

func (a *BillingAdmin) ListPayments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", http.StatusText(http.StatusMethodNotAllowed))
		return
	}
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	pays, err := a.svc.ListPaymentsAdmin(r.Context(), limit)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"payments": pays}})
}
