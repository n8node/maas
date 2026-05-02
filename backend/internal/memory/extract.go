package memory

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

var tagStripper = regexp.MustCompile(`(?s)<script.*?</script>|<style.*?</style>|<[^>]+>`)

// ExtractTextFromFile maps extension → UTF-8 text for chunking.
func ExtractTextFromFile(filename string, data []byte) (string, error) {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), "."))
	switch ext {
	case "txt", "md", "markdown", "csv", "log", "tsv":
		return decodeUTF8(data)
	case "json":
		return decodeUTF8(data)
	case "html", "htm":
		s, err := decodeUTF8(data)
		if err != nil {
			return "", err
		}
		s = tagStripper.ReplaceAllString(s, " ")
		return collapseSpace(s), nil
	case "docx":
		return extractDOCX(data)
	case "doc":
		return "", fmt.Errorf("legacy Word .doc is not supported; save as .docx or paste plain text in Playground")
	case "pdf":
		return "", fmt.Errorf("pdf: not supported in this build yet; export to .txt or .docx, or paste text in Playground")
	default:
		return "", fmt.Errorf("unsupported file type .%s (try txt, md, html, docx, pdf)", ext)
	}
}

func decodeUTF8(data []byte) (string, error) {
	if !utf8.Valid(data) {
		return string(bytes.Map(func(r rune) rune {
			if r == utf8.RuneError {
				return -1
			}
			return r
		}, data)), nil
	}
	return string(data), nil
}

func collapseSpace(s string) string {
	return strings.TrimSpace(regexp.MustCompile(`\s+`).ReplaceAllString(s, " "))
}

func extractDOCX(data []byte) (string, error) {
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("docx: %w", err)
	}
	var docXML []byte
	for _, f := range z.File {
		if f.Name == "word/document.xml" {
			rc, err := f.Open()
			if err != nil {
				return "", err
			}
			docXML, err = io.ReadAll(rc)
			_ = rc.Close()
			if err != nil {
				return "", err
			}
			break
		}
	}
	if len(docXML) == 0 {
		return "", fmt.Errorf("docx: missing word/document.xml")
	}
	s := string(docXML)
	s = tagStripper.ReplaceAllString(s, " ")
	s = regexp.MustCompile(`<w:tab/>`).ReplaceAllString(s, "\t")
	s = regexp.MustCompile(`<w:br[^>]*/>`).ReplaceAllString(s, "\n")
	s = regexp.MustCompile(`<[^>]+>`).ReplaceAllString(s, " ")
	return collapseSpace(s), nil
}
