package rpc

import (
	"encoding/json"
	"strconv"
)

// Envelope is the reply shape every worker RPC method returns:
//
//	{"ok": true, "data": {...}, "warnings": [...]}  — success (warnings omitted if empty)
//	{"ok": false, "error": {"code","message"}}      — failure
type Envelope struct {
	OK       bool            `json:"ok"`
	Data     json.RawMessage `json:"data"`
	Warnings json.RawMessage `json:"warnings,omitempty"`
	Error    *EnvelopeError  `json:"error"`
}

// EnvelopeError carries a machine code (mapped to an HTTP status), a human
// message, and optional structured Details.
//
// Details exists because a worker cannot set HTTP headers or shape the response
// body: anything richer than one string had to be flattened into Message, and
// was. Recognized keys: `retry_after` (seconds — becomes the Retry-After
// header) and `fields` (per-item validation/business detail). Every other key
// is relayed into the error body verbatim, so a worker can add one without a
// gateway change.
type EnvelopeError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// RetryAfterSeconds returns the Details["retry_after"] budget, if any. JSON
// numbers decode as float64; a stringly-typed value is tolerated because the
// worker builds this from an HTTPException header value.
func (e *EnvelopeError) RetryAfterSeconds() (int, bool) {
	if e == nil {
		return 0, false
	}
	switch v := e.Details["retry_after"].(type) {
	case float64:
		if v >= 1 {
			return int(v), true
		}
	case string:
		if n, err := strconv.Atoi(v); err == nil && n >= 1 {
			return n, true
		}
	}
	return 0, false
}

// StatusForCode maps an envelope error code to an HTTP status, preserving the
// auth-service contract's status codes.
func StatusForCode(code string) int {
	switch code {
	case "bad_request":
		return 400
	case "unauthorized":
		return 401
	case "forbidden":
		return 403
	case "not_found":
		return 404
	case "conflict":
		return 409
	case "gone":
		return 410
	case "unprocessable":
		return 422
	case "payload_too_large":
		return 413
	case "rate_limited":
		return 429
	case "unavailable":
		// A dependency the worker needs is down (e.g. the Redis-backed invite rate
		// limiter, which fails closed on purpose). 503 tells the client to retry
		// shortly; the 500 this used to degrade to says "we are broken, do not".
		return 503
	default:
		return 500
	}
}

// CodeForStatus is the inverse of StatusForCode for gateway-local errors that
// have an HTTP status but no worker code. Unknown statuses become "internal".
func CodeForStatus(status int) string {
	switch status {
	case 400:
		return "bad_request"
	case 401:
		return "unauthorized"
	case 403:
		return "forbidden"
	case 404:
		return "not_found"
	case 409:
		return "conflict"
	case 410:
		return "gone"
	case 413:
		return "payload_too_large"
	case 422:
		return "unprocessable"
	case 429:
		return "rate_limited"
	case 503, 504:
		return "unavailable"
	default:
		return "internal"
	}
}
