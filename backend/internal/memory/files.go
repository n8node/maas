package memory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/n8node/maas/backend/internal/models"
)

const embedBatchSize = 32

type FileIngestResult struct {
	SourceID             uuid.UUID
	ChunksAdded          int
	TokensConsumed       int64
	EmbeddingModel       string
	WikiConceptsAdded    int
	WikiExtractionNote   string
}

type FileIngestInput struct {
	Filename  string
	MimeType  string
	Body      []byte
	UserScope *string
}

func (s *Service) IngestFile(ctx context.Context, userID, instanceID uuid.UUID, in FileIngestInput) (*FileIngestResult, error) {
	inst, err := s.Get(ctx, userID, instanceID)
	if err != nil {
		return nil, err
	}
	name := filepath.Base(strings.TrimSpace(in.Filename))
	if name == "" || name == "." {
		return nil, fmt.Errorf("filename required")
	}
	if len(in.Body) == 0 {
		return nil, ErrEmptyContent
	}
	const maxFile = 32 << 20
	if len(in.Body) > maxFile {
		return nil, fmt.Errorf("file too large (max 32 MB)")
	}

	text, err := ExtractTextFromFile(name, in.Body)
	if err != nil {
		return nil, err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, fmt.Errorf("no extractable text from file")
	}

	switch inst.MemoryType {
	case "wiki":
		res, err := s.Ingest(ctx, userID, instanceID, IngestInput{
			Text:        text,
			SourceTitle: name,
			UserScope:   in.UserScope,
		})
		if err != nil {
			return nil, err
		}
		return &FileIngestResult{
			SourceID:             res.SourceID,
			ChunksAdded:          res.ChunksAdded,
			TokensConsumed:       res.TokensConsumed,
			EmbeddingModel:       "",
			WikiConceptsAdded:    res.WikiConceptsAdded,
			WikiExtractionNote:   res.WikiExtractionNote,
		}, nil
	case "rag":
		if s.embed == nil {
			return nil, ErrEmbeddingsDisabled
		}
		chunks := splitChunks(text)
		if len(chunks) == 0 {
			return nil, ErrEmptyContent
		}

		var totalTok int64
		for _, c := range chunks {
			totalTok += estimateTokens(c)
		}
		_ = s.bill.EnsureWelcomeSubscription(ctx, userID)

		model := ""
		if s.embed != nil {
			model = s.embed.Model
		}
		mime := strings.TrimSpace(in.MimeType)
		if mime == "" {
			mime = "application/octet-stream"
		}

		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return nil, err
		}
		defer tx.Rollback(ctx)

		var srcID uuid.UUID
		err = tx.QueryRow(ctx, `
		INSERT INTO rag_sources (instance_id, filename, byte_size, mime_type, embedding_model, tokens_total, chunk_count)
		VALUES ($1, $2, $3, $4, $5, 0, 0) RETURNING id`,
			instanceID, name, len(in.Body), mime, model).Scan(&srcID)
		if err != nil {
			return nil, err
		}

		var inserted []uuid.UUID
		for i := 0; i < len(chunks); i += embedBatchSize {
			j := i + embedBatchSize
			if j > len(chunks) {
				j = len(chunks)
			}
			batch := chunks[i:j]
			vecs, err := s.embed.Embed(ctx, batch)
			if err != nil {
				return nil, err
			}
			for k, content := range batch {
				te := int(estimateTokens(content))
				vecStr := vectorLiteral(vecs[k])
				var cid uuid.UUID
				err := tx.QueryRow(ctx, `
				INSERT INTO rag_chunks (instance_id, user_scope, source_label, content, token_estimate, source_id, embedding)
				VALUES ($1, $2, $3, $4, $5, $6, $7::vector) RETURNING id`,
					instanceID, in.UserScope, name, content, te, srcID, vecStr).Scan(&cid)
				if err != nil {
					return nil, err
				}
				inserted = append(inserted, cid)
			}
		}

		_, err = tx.Exec(ctx, `
		UPDATE rag_sources SET tokens_total = $2, chunk_count = $3 WHERE id = $1`,
			srcID, totalTok, len(inserted))
		if err != nil {
			return nil, err
		}

		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}

		if err := s.bill.ConsumeTokens(ctx, userID, totalTok); err != nil {
			for _, cid := range inserted {
				_, _ = s.pool.Exec(ctx, `DELETE FROM rag_chunks WHERE id = $1`, cid)
			}
			_, _ = s.pool.Exec(ctx, `DELETE FROM rag_sources WHERE id = $1`, srcID)
			return nil, err
		}

		return &FileIngestResult{
			SourceID:       srcID,
			ChunksAdded:    len(inserted),
			TokensConsumed: totalTok,
			EmbeddingModel: model,
		}, nil
	default:
		return nil, fmt.Errorf("file ingest is only available for RAG and Wiki instances")
	}
}

func (s *Service) ListSources(ctx context.Context, userID, instanceID uuid.UUID) ([]models.RAGSource, error) {
	_, err := s.Get(ctx, userID, instanceID)
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT s.id, s.instance_id, s.filename, s.byte_size, s.mime_type, s.embedding_model, s.tokens_total, s.chunk_count, s.created_at
		FROM rag_sources s
		INNER JOIN memory_instances m ON m.id = s.instance_id AND m.user_id = $2
		WHERE s.instance_id = $1
		ORDER BY s.created_at DESC`, instanceID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.RAGSource
	for rows.Next() {
		var r models.RAGSource
		if err := rows.Scan(&r.ID, &r.InstanceID, &r.Filename, &r.ByteSize, &r.MimeType, &r.EmbeddingModel, &r.TokensTotal, &r.ChunkCount, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// DeleteSource removes a file-backed RAG source and all its chunks (including embedding vectors) via ON DELETE CASCADE.
func (s *Service) DeleteSource(ctx context.Context, userID, instanceID, sourceID uuid.UUID) error {
	inst, err := s.Get(ctx, userID, instanceID)
	if err != nil {
		return err
	}
	if inst.MemoryType != "rag" {
		return ErrInvalidType
	}
	ct, err := s.pool.Exec(ctx, `
		DELETE FROM rag_sources s
		USING memory_instances m
		WHERE s.id = $1 AND s.instance_id = $2 AND m.id = s.instance_id AND m.user_id = $3`,
		sourceID, instanceID, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type ChunkRow struct {
	ID            uuid.UUID
	Content       string
	TokenEstimate int
	Embedding     []float32
	CreatedAt     time.Time
	Ordinal       int
}

func (s *Service) ListChunksBySource(ctx context.Context, userID, instanceID, sourceID uuid.UUID, limit, offset int) ([]ChunkRow, int, error) {
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM rag_chunks c
		INNER JOIN memory_instances m ON m.id = c.instance_id AND m.user_id = $3
		WHERE c.instance_id = $1 AND c.source_id = $2`,
		instanceID, sourceID, userID).Scan(&n)
	if err != nil {
		return nil, 0, err
	}

	rows, err := s.pool.Query(ctx, `
		WITH numbered AS (
			SELECT c.id, c.content, c.token_estimate, c.embedding::text AS emb, c.created_at,
				ROW_NUMBER() OVER (ORDER BY c.created_at ASC, c.id ASC) AS ord
			FROM rag_chunks c
			INNER JOIN memory_instances m ON m.id = c.instance_id AND m.user_id = $3
			WHERE c.instance_id = $1 AND c.source_id = $2
		)
		SELECT id, content, token_estimate, emb, created_at, ord
		FROM numbered
		ORDER BY ord
		LIMIT $4 OFFSET $5`, instanceID, sourceID, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var list []ChunkRow
	for rows.Next() {
		var r ChunkRow
		var emb sql.NullString
		if err := rows.Scan(&r.ID, &r.Content, &r.TokenEstimate, &emb, &r.CreatedAt, &r.Ordinal); err != nil {
			return nil, 0, err
		}
		if emb.Valid && emb.String != "" {
			r.Embedding = parseVectorText(emb.String)
		}
		list = append(list, r)
	}
	return list, n, rows.Err()
}

func (s *Service) DeleteChunk(ctx context.Context, userID, instanceID, chunkID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var srcID *uuid.UUID
	var te int
	err = tx.QueryRow(ctx, `
		SELECT c.source_id, c.token_estimate FROM rag_chunks c
		INNER JOIN memory_instances m ON m.id = c.instance_id AND m.user_id = $3
		WHERE c.id = $1 AND c.instance_id = $2`,
		chunkID, instanceID, userID).Scan(&srcID, &te)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	ct, err := tx.Exec(ctx, `DELETE FROM rag_chunks WHERE id = $1 AND instance_id = $2`, chunkID, instanceID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}

	if srcID != nil && *srcID != uuid.Nil {
		_, err = tx.Exec(ctx, `
			UPDATE rag_sources SET chunk_count = GREATEST(chunk_count - 1, 0), tokens_total = GREATEST(tokens_total - $2::bigint, 0)
			WHERE id = $1`, *srcID, te)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (s *Service) instanceHasVectorChunks(ctx context.Context, instanceID uuid.UUID) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM rag_chunks WHERE instance_id = $1 AND embedding IS NOT NULL LIMIT 1
		)`, instanceID).Scan(&ok)
	return ok, err
}
