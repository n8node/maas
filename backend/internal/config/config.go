package config

import (
	"fmt"

	"github.com/caarlos0/env/v11"
)

type Config struct {
	Environment string `env:"ENVIRONMENT" envDefault:"development"`
	LogLevel      string `env:"LOG_LEVEL" envDefault:"info"`

	PostgresHost     string `env:"POSTGRES_HOST" envDefault:"postgres"`
	PostgresPort     string `env:"POSTGRES_PORT" envDefault:"5432"`
	PostgresDB       string `env:"POSTGRES_DB" envDefault:"mnemoniqa"`
	PostgresUser     string `env:"POSTGRES_USER" envDefault:"mnemoniqa"`
	PostgresPassword string `env:"POSTGRES_PASSWORD" envDefault:""`
	PostgresSSLMode  string `env:"POSTGRES_SSLMODE" envDefault:"disable"`

	ServerPort string `env:"SERVER_PORT" envDefault:"8080"`
	Version    string `env:"VERSION" envDefault:"0.3.0"`

	JWTSecret  string `env:"JWT_SECRET" envDefault:""`
	APIKeySalt string `env:"API_KEY_SALT" envDefault:""`
}

func Load() (*Config, error) {
	var c Config
	if err := env.Parse(&c); err != nil {
		return nil, fmt.Errorf("parse env: %w", err)
	}
	return &c, nil
}

func (c *Config) DatabaseURL() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s?sslmode=%s",
		c.PostgresUser,
		c.PostgresPassword,
		c.PostgresHost,
		c.PostgresPort,
		c.PostgresDB,
		c.PostgresSSLMode,
	)
}
