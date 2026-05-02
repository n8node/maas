package memory

import (
	"fmt"
	"strconv"
	"strings"
)

func vectorLiteral(v []float32) string {
	var b strings.Builder
	b.Grow(len(v) * 12)
	b.WriteByte('[')
	for i, x := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "%.9g", x)
	}
	b.WriteByte(']')
	return b.String()
}

// parseVectorText parses PostgreSQL vector textual form `[f,f,...]`.
func parseVectorText(s string) []float32 {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	s = strings.TrimPrefix(s, "[")
	s = strings.TrimSuffix(s, "]")
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]float32, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		x, err := strconv.ParseFloat(p, 32)
		if err != nil {
			return nil
		}
		out = append(out, float32(x))
	}
	return out
}
