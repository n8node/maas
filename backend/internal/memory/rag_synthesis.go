package memory

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/n8node/maas/backend/internal/billing"
)

const ragSynthMaxPassageRunes = 1200

// ragSynthesizeAnswer runs a chat completion over retrieved passages and bills synthesis tokens.
// On success returns assistant text and token cost for the LLM call only.
// Returns ("", 0, nil) when chat is not configured or passages are empty.
// Returns ("", 0, err) on LLM failure; if the model returns only whitespace, returns ("", tok, nil) with tok billed.
func (s *Service) ragSynthesizeAnswer(ctx context.Context, userID, instanceID uuid.UUID, question string, cites []Citation) (string, int64, error) {
	if s.chat == nil || len(cites) == 0 {
		return "", 0, nil
	}

	var b strings.Builder
	for i, c := range cites {
		body := strings.TrimSpace(c.Snippet)
		if body == "" {
			continue
		}
		if n := utf8.RuneCountInString(body); n > ragSynthMaxPassageRunes {
			r := []rune(body)
			body = string(r[:ragSynthMaxPassageRunes]) + "…"
		}
		id := strings.TrimSpace(c.ChunkID)
		if _, err := uuid.Parse(id); err != nil {
			id = c.ChunkID
		}
		fmt.Fprintf(&b, "### [%d] chunk_id=%s\n%s\n\n", i+1, id, body)
	}
	passages := strings.TrimSpace(b.String())
	if passages == "" {
		return "", 0, nil
	}

	system := `You answer questions using ONLY the numbered passages below. If the answer is not contained in those passages, say clearly that the indexed content does not contain enough information.

Rules:
- Reply in the same language as the user's question when possible.
- When you use facts from a passage, cite inline using the bracket label for that passage only (e.g. [1], [2]). Use at least one citation when any passage is relevant.
- Do not invent facts that are not supported by the passages.
- Keep the answer concise unless the question explicitly asks for detail.`

	user := fmt.Sprintf("Question:\n%s\n\nPassages:\n%s", strings.TrimSpace(question), passages)

	out, usage, err := s.chat.Complete(ctx, system, user)
	if err != nil {
		return "", 0, err
	}
	tok := usage.TotalTokens
	if tok < 1 {
		tok = 1
	}
	instPtr := instanceID
	if err := s.bill.ConsumeTokensWithUsage(ctx, userID, tok, &billing.UsageLedger{
		Operation:  "synthesis",
		InstanceID: &instPtr,
		MemoryType: "rag",
	}); err != nil {
		return "", 0, err
	}
	return strings.TrimSpace(out), tok, nil
}
