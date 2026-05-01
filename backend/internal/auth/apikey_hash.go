package auth

import (
	"crypto/sha256"
	"encoding/hex"
)

func HashAPIKey(salt, rawKey string) string {
	h := sha256.Sum256([]byte(salt + rawKey))
	return hex.EncodeToString(h[:])
}
