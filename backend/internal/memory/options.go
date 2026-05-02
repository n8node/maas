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

func WithChat(c *openrouter.ChatClient) ServiceOption {
	return func(s *Service) {
		s.chat = c
	}
}

// WithGardenerModels sets OpenRouter model IDs for Phase 0 triage and Phase 1 merge description. Empty values are ignored and resolved at runtime (see wiki_gardener.go).
func WithGardenerModels(triageModel, refactorModel string) ServiceOption {
	return func(s *Service) {
		s.gardenerTriageModel = triageModel
		s.gardenerRefactorModel = refactorModel
	}
}
