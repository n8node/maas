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

// ChatClient calls OpenRouter/OpenAI-compatible /chat/completions.
type ChatClient struct {
	BaseURL string
	APIKey  string
	Model   string
	HTTP    *http.Client
}

func NewChatClient(cfg *config.Config) *ChatClient {
	m := strings.TrimSpace(cfg.OpenRouterChatModel)
	if m == "" {
		m = "openai/gpt-4o-mini"
	}
	return &ChatClient{
		BaseURL: strings.TrimSuffix(cfg.OpenRouterBaseURL, "/"),
		APIKey:  strings.TrimSpace(cfg.OpenRouterAPIKey),
		Model:   m,
		HTTP: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

type ChatUsage struct {
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
}

type chatReq struct {
	Model       string              `json:"model"`
	Messages    []map[string]string `json:"messages"`
	Temperature float64             `json:"temperature,omitempty"`
}

type chatResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Complete runs a single-turn chat (system + user) and returns assistant text + usage.
func (c *ChatClient) Complete(ctx context.Context, system, user string) (string, ChatUsage, error) {
	var u ChatUsage
	if c.APIKey == "" {
		return "", u, fmt.Errorf("openrouter: missing API key")
	}
	if c.Model == "" {
		return "", u, fmt.Errorf("openrouter: missing chat model")
	}
	body, err := json.Marshal(chatReq{
		Model: c.Model,
		Messages: []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		},
		Temperature: 0.2,
	})
	if err != nil {
		return "", u, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", u, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("HTTP-Referer", "https://mnemoniqa.com")
	req.Header.Set("X-Title", "Mnemoniqa")

	res, err := c.HTTP.Do(req)
	if err != nil {
		return "", u, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", u, fmt.Errorf("chat http %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	var out chatResp
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", u, err
	}
	if out.Error != nil && out.Error.Message != "" {
		return "", u, fmt.Errorf("chat: %s", out.Error.Message)
	}
	if len(out.Choices) == 0 {
		return "", u, fmt.Errorf("chat: empty choices")
	}
	text := strings.TrimSpace(out.Choices[0].Message.Content)
	u.PromptTokens = int64(out.Usage.PromptTokens)
	u.CompletionTokens = int64(out.Usage.CompletionTokens)
	u.TotalTokens = int64(out.Usage.TotalTokens)
	if u.TotalTokens == 0 {
		u.TotalTokens = u.PromptTokens + u.CompletionTokens
	}
	return text, u, nil
}
