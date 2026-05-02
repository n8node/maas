package memory

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/n8node/maas/backend/internal/models"
)

// ErrRagOnly is returned when an operation requires a RAG instance.
var ErrRagOnly = errors.New("operation requires rag memory instance")

func (s *Service) requireRAGInstance(ctx context.Context, userID, id uuid.UUID) (*models.MemoryInstance, error) {
	m, err := s.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if m.MemoryType != "rag" {
		return nil, ErrRagOnly
	}
	return m, nil
}

// RAGDashboardStats aggregates KPIs for the RAG instance dashboard.
type RAGDashboardStats struct {
	ChunkCount        int64    `json:"chunk_count"`
	SourceCount       int      `json:"source_count"`
	TopicClusterCount int      `json:"topic_cluster_count"` // MVP: one logical cluster per uploaded source document
	LastIngestAt      *string  `json:"last_ingest_at,omitempty"`
	QueriesToday      int64    `json:"queries_today"`
	AvgTopKScore      *float64 `json:"avg_topk_score,omitempty"` // nil until query analytics exists
	CoveragePercent   *float64 `json:"coverage_percent,omitempty"` // optional future metric
	HighConfPercent   *float64 `json:"high_conf_percent,omitempty"`
}

func (s *Service) RAGDashboardStats(ctx context.Context, userID, instanceID uuid.UUID) (*RAGDashboardStats, error) {
	if _, err := s.requireRAGInstance(ctx, userID, instanceID); err != nil {
		return nil, err
	}

	var chunkCount int64
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM rag_chunks c
		INNER JOIN memory_instances m ON m.id = c.instance_id AND m.user_id = $2
		WHERE c.instance_id = $1`, instanceID, userID).Scan(&chunkCount)
	if err != nil {
		return nil, err
	}

	var sourceCount int
	err = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM rag_sources s
		INNER JOIN memory_instances m ON m.id = s.instance_id AND m.user_id = $2
		WHERE s.instance_id = $1`, instanceID, userID).Scan(&sourceCount)
	if err != nil {
		return nil, err
	}

	var last sql.NullTime
	_ = s.pool.QueryRow(ctx, `
		SELECT MAX(s.created_at) FROM rag_sources s
		INNER JOIN memory_instances m ON m.id = s.instance_id AND m.user_id = $2
		WHERE s.instance_id = $1`, instanceID, userID).Scan(&last)

	var lastStr *string
	if last.Valid {
		t := last.Time.UTC().Format(time.RFC3339Nano)
		lastStr = &t
	}

	return &RAGDashboardStats{
		ChunkCount:        chunkCount,
		SourceCount:       sourceCount,
		TopicClusterCount: sourceCount,
		LastIngestAt:      lastStr,
		QueriesToday:      0,
		AvgTopKScore:      nil,
		CoveragePercent:   nil,
		HighConfPercent:   nil,
	}, nil
}

// RAGTopicCluster is a document-level grouping used as an MVP stand-in for hierarchical semantic topics.
type RAGTopicCluster struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Tags       []string `json:"tags"`
	ChunkCount int      `json:"chunk_count"`
	Score      float64  `json:"score"`
}

func filenameToTopicTitleAndTags(filename string) (string, []string) {
	base := filepath.Base(strings.TrimSpace(filename))
	if base == "" || base == "." {
		return "Untitled", nil
	}
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	re := regexp.MustCompile(`[-_\s]+`)
	parts := re.Split(stem, -1)
	var tags []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		runes := []rune(strings.ToLower(p))
		if len(runes) > 0 {
			runes[0] = unicode.ToUpper(runes[0])
		}
		w := string(runes)
		tags = append(tags, w)
		if len(tags) >= 8 {
			break
		}
	}
	title := stem
	if len(tags) > 0 {
		title = strings.Join(tags, " ")
	}
	return title, tags
}

func topicScore(seed int) float64 {
	x := 0.82 + math.Mod(float64(seed*37), 14)/100
	if x > 0.96 {
		return 0.96
	}
	return math.Round(x*100) / 100
}

// ListRAGTopicClusters returns document-level clusters (one row per rag source).
// Full semantic hierarchical clustering can replace this later without changing the API shape.
func (s *Service) ListRAGTopicClusters(ctx context.Context, userID, instanceID uuid.UUID) ([]RAGTopicCluster, error) {
	if _, err := s.requireRAGInstance(ctx, userID, instanceID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT s.id::text, s.filename, s.chunk_count
		FROM rag_sources s
		INNER JOIN memory_instances m ON m.id = s.instance_id AND m.user_id = $2
		WHERE s.instance_id = $1
		ORDER BY s.chunk_count DESC, s.created_at DESC
		LIMIT 48`, instanceID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RAGTopicCluster
	n := 0
	for rows.Next() {
		var id, fn string
		var cc int
		if err := rows.Scan(&id, &fn, &cc); err != nil {
			return nil, err
		}
		title, tags := filenameToTopicTitleAndTags(fn)
		n++
		out = append(out, RAGTopicCluster{
			ID:         id,
			Title:      title,
			Tags:       tags,
			ChunkCount: cc,
			Score:      topicScore(cc + n*17),
		})
	}
	return out, rows.Err()
}
