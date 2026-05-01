package server

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	appmw "github.com/n8node/maas/backend/internal/middleware"
)

type Options struct {
	Logger        *slog.Logger
	HealthHandler http.Handler
	CORSOrigins   []string
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

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"message":"Mnemoniqa API"},"meta":{}}`))
		})
	})

	return r
}
