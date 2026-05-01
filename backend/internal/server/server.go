package server

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/n8node/maas/backend/internal/billing"
	"github.com/n8node/maas/backend/internal/config"
	"github.com/n8node/maas/backend/internal/handler"
	appmw "github.com/n8node/maas/backend/internal/middleware"
	"github.com/n8node/maas/backend/internal/repository"
)

type Options struct {
	Logger        *slog.Logger
	HealthHandler http.Handler
	CORSOrigins   []string
	Config        *config.Config
	Pool          *pgxpool.Pool
}

func New(opts Options) http.Handler {
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	if opts.Logger != nil {
		r.Use(appmw.SlogMiddleware(opts.Logger))
	}
	origins := opts.CORSOrigins
	if len(origins) == 0 {
		origins = []string{"*"}
	}
	r.Use(appmw.CORS(origins))

	r.Get("/health", opts.HealthHandler.ServeHTTP)

	bill := billing.NewService(opts.Pool)
	userRepo := repository.NewUserRepo(opts.Pool)
	keyRepo := repository.NewAPIKeyRepo(opts.Pool)
	authH := handler.NewAuth(opts.Config, userRepo, bill)
	keysH := handler.NewAPIKeys(opts.Config, keyRepo)
	billH := handler.NewBilling(bill)
	billAdm := handler.NewBillingAdmin(bill)
	authDeps := appmw.AuthDeps{Cfg: opts.Config, Users: userRepo, Keys: keyRepo}
	authRoute := appmw.Authenticate(authDeps)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"message":"Mnemoniqa API"},"meta":{}}`))
		})
		r.Get("/plans", billH.ListPlans)
		r.Get("/token-packages", billH.ListTokenPackagesPublic)

		r.Post("/auth/register", authH.Register)
		r.Post("/auth/login", authH.Login)
		r.With(authRoute).Get("/auth/me", authH.Me)
		r.With(authRoute).Get("/api-keys", keysH.List)
		r.With(authRoute).Post("/api-keys", keysH.Create)
		r.With(authRoute).Delete("/api-keys/{id}", keysH.Delete)

		r.With(authRoute).Get("/billing/me", billH.Me)
		r.With(authRoute).Post("/billing/subscribe", billH.Subscribe)
		r.With(authRoute).Post("/billing/cancel", billH.Cancel)
		r.With(authRoute).Post("/billing/consume", billH.Consume)

		r.With(authRoute, appmw.RequireSuperAdmin).Get("/admin/ping", handler.AdminPing)

		r.Route("/admin", func(r chi.Router) {
			r.Use(authRoute, appmw.RequireSuperAdmin)
			r.Get("/plans", billAdm.ListPlans)
			r.Post("/plans", billAdm.CreatePlan)
			r.Patch("/plans/{id}", billAdm.UpdatePlan)
			r.Delete("/plans/{id}", billAdm.DeletePlan)
			r.Get("/packages", billAdm.ListPackages)
			r.Post("/packages", billAdm.CreatePackage)
			r.Patch("/packages/{id}", billAdm.UpdatePackage)
			r.Post("/payments", billAdm.RecordPayment)
			r.Get("/payments", billAdm.ListPayments)
		})
	})

	return r
}
