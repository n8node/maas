package memory

import (
	"github.com/n8node/maas/backend/internal/openrouter"
)

type ServiceOption func(*Service)

func WithEmbedder(c *openrouter.EmbeddingClient) ServiceOption {
	return func(s *Service) {
		s.embed = c
	}
}
