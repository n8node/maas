package main

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	appmigrations "github.com/n8node/maas/backend/migrations"
	"github.com/n8node/maas/backend/internal/config"
	"github.com/n8node/maas/backend/internal/handler"
	"github.com/n8node/maas/backend/internal/repository"
	"github.com/n8node/maas/backend/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config", slog.Any("err", err))
		os.Exit(1)
	}
	if err := validateSecrets(cfg); err != nil {
		slog.Error("secrets", slog.Any("err", err))
		os.Exit(1)
	}

	logLevel := slog.LevelInfo
	if cfg.LogLevel == "debug" {
		logLevel = slog.LevelDebug
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))

	ctx := context.Background()
	pool, err := repository.NewPool(ctx, cfg.DatabaseURL())
	if err != nil {
		logger.Error("postgres", slog.Any("err", err))
		os.Exit(1)
	}
	defer pool.Close()

	if err := runMigrations(cfg.DatabaseURL(), logger); err != nil {
		logger.Error("migrate", slog.Any("err", err))
		os.Exit(1)
	}

	h := server.New(server.Options{
		Logger:        logger,
		HealthHandler: handler.NewHealth(cfg.Version),
		CORSOrigins:   []string{"*"},
		Config:        cfg,
		Pool:          pool,
	})

	addr := ":" + cfg.ServerPort
	srv := &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		logger.Info("listening", slog.Any("addr", addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server", slog.Any("err", err))
			os.Exit(1)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown", slog.Any("err", err))
	}
}

func validateSecrets(c *config.Config) error {
	if len(strings.TrimSpace(c.JWTSecret)) < 16 {
		return fmt.Errorf("JWT_SECRET must be at least 16 characters")
	}
	if strings.TrimSpace(c.APIKeySalt) == "" {
		return fmt.Errorf("API_KEY_SALT must be non-empty")
	}
	return nil
}

func runMigrations(databaseURL string, logger *slog.Logger) error {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	goose.SetBaseFS(appmigrations.FS)
	if err := goose.Up(db, "."); err != nil {
		return err
	}
	logger.Info("migrations applied")
	return nil
}
