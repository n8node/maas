package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/google/uuid"

	"github.com/n8node/maas/backend/internal/auth"
	"github.com/n8node/maas/backend/internal/config"
	"github.com/n8node/maas/backend/internal/repository"
)

func main() {
	email := flag.String("email", "", "superadmin email")
	password := flag.String("password", "", "initial password (min 12 chars)")
	flag.Parse()
	if *email == "" || *password == "" {
		flag.Usage()
		os.Exit(2)
	}
	if len(*password) < 12 {
		fmt.Fprintln(os.Stderr, "password must be at least 12 characters")
		os.Exit(2)
	}
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config", slog.Any("err", err))
		os.Exit(1)
	}
	ctx := context.Background()
	pool, err := repository.NewPool(ctx, cfg.DatabaseURL())
	if err != nil {
		slog.Error("postgres", slog.Any("err", err))
		os.Exit(1)
	}
	defer pool.Close()

	hash, err := auth.HashPassword(*password)
	if err != nil {
		slog.Error("hash", slog.Any("err", err))
		os.Exit(1)
	}
	id := uuid.New()
	q := `INSERT INTO users (id, email, password_hash, role)
		VALUES ($1, $2, $3, 'superadmin')
		ON CONFLICT (email) DO UPDATE SET
			password_hash = EXCLUDED.password_hash,
			role = 'superadmin',
			updated_at = now()`
	tag, err := pool.Exec(ctx, q, id, *email, hash)
	if err != nil {
		slog.Error("upsert superadmin", slog.Any("err", err))
		os.Exit(1)
	}
	slog.Info("superadmin ready", slog.String("email", *email), slog.Int64("rows", tag.RowsAffected()))
}
