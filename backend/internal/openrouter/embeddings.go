package openrouter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/n8node/maas/backend/internal/config"
)

const embedDim = 1536 // openai/text-embedding-3-small & ada-002

// EmbeddingClient calls OpenRouter/OpenAI-compatible /embeddings.
type EmbeddingClient struct {
	BaseURL string
	APIKey  string
	Model   string
	HTTP    *http.Client
}

func NewEmbeddingClient(cfg *config.Config) *EmbeddingClient {
	m := strings.TrimSpace(cfg.OpenRouterEmbeddingModel)
	if m == "" {
		m = "openai/text-embedding-3-small"
	}
	return &EmbeddingClient{
		BaseURL: strings.TrimSuffix(cfg.OpenRouterBaseURL, "/"),
		APIKey:  strings.TrimSpace(cfg.OpenRouterAPIKey),
		Model:   m,
		HTTP: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

func (c *EmbeddingClient) Dim() int { return embedDim }

type embedRequest struct {
	Model string `json:"model"`
	Input any    `json:"input"`
}

type embedResponse struct {
	Data []struct {
		Embedding []float64 `json:"embedding"`
		Index     int       `json:"index"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Embed batches texts (OpenRouter allows multiple strings in one request).
func (c *EmbeddingClient) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if c.APIKey == "" {
		return nil, fmt.Errorf("openrouter: missing API key")
	}
	if c.Model == "" {
		return nil, fmt.Errorf("openrouter: missing embedding model")
	}
	if len(texts) == 0 {
		return nil, nil
	}
	body, err := json.Marshal(embedRequest{Model: c.Model, Input: texts})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("HTTP-Referer", "https://mnemoniqa.com")
	req.Header.Set("X-Title", "Mnemoniqa")

	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("embeddings http %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	var out embedResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	if out.Error != nil && out.Error.Message != "" {
		return nil, fmt.Errorf("embeddings: %s", out.Error.Message)
	}
	if len(out.Data) != len(texts) {
		return nil, fmt.Errorf("embeddings: expected %d vectors, got %d", len(texts), len(out.Data))
	}
	vecs := make([][]float32, len(texts))
	for i := range texts {
		e := out.Data[i].Embedding
		if len(e) != embedDim {
			return nil, fmt.Errorf("embeddings: dim %d != %d", len(e), embedDim)
		}
		v := make([]float32, embedDim)
		for j, x := range e {
			v[j] = float32(x)
		}
		vecs[i] = v
	}
	return vecs, nil
}

// EmbedOne embeds a single string (query).
func (c *EmbeddingClient) EmbedOne(ctx context.Context, text string) ([]float32, error) {
	v, err := c.Embed(ctx, []string{text})
	if err != nil {
		return nil, err
	}
	if len(v) != 1 {
		return nil, fmt.Errorf("embeddings: expected 1 vector")
	}
	return v[0], nil
}
