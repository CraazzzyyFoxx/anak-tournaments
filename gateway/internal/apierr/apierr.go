// Package apierr owns the gateway's HTTP error contract: the one place a failed
// RPC envelope becomes a response body.
//
// It exists because that translation used to be copy-pasted into every relay
// site — the edge dispatcher, the identity handler, and each domain's
// multipart/binary handler each had their own `writeDetail` and their own
// `status = rpc.StatusForCode(...)` block. Five of the six dropped the machine
// error code, and all six dropped the worker's structured detail, so a
// balancer 429 reached API clients with no Retry-After at all (a worker cannot
// set headers; it can only report the budget in the envelope).
//
// v1 response shape (default):
//
//	{"detail": "<human>", "code": "<machine>", ...worker details}
//
// `detail` keeps its FastAPI name and string type because every existing client
// reads it. Everything else is additive.
//
// v2 (/api/v2, see internal/apiver) relays the RPC envelope:
//
//	{"ok": true, "data": ..., "warnings": [...]}
//	{"ok": false, "error": {"code", "message", "details?"}}
package apierr

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/apiver"
	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/rpc"
)

// WriteEnvelopeError renders a failed RPC envelope as an HTTP error: status from
// the code, `detail`/`code` in the body, every structured Details key relayed,
// and Retry-After set when the worker reported a retry budget.
//
// A nil error means the worker sent `ok:false` with nothing to explain it —
// still answered as a well-formed 500 rather than an unparseable empty body.
func WriteEnvelopeError(w http.ResponseWriter, e *rpc.EnvelopeError) {
	status := http.StatusInternalServerError
	detail := "internal error"
	code := "internal"
	var details map[string]any

	if e != nil {
		status = rpc.StatusForCode(e.Code)
		detail = e.Message
		code = e.Code
		details = e.Details
		if secs, ok := e.RetryAfterSeconds(); ok {
			w.Header().Set("Retry-After", strconv.Itoa(secs))
		}
	}
	WriteError(w, status, detail, code, details)
}

// WriteError emits the error body directly, for the gateway's own failures
// (no upstream envelope): an empty code is omitted rather than guessed on v1.
//
// Worker-supplied details are written first so they can never shadow `detail`
// or `code` — a compromised or careless worker must not be able to rewrite the
// two fields clients branch on.
func WriteError(w http.ResponseWriter, status int, detail, code string, details map[string]any) {
	if apiver.WantWriter(w) {
		writeV2Error(w, status, detail, code, details)
		return
	}
	body := make(map[string]any, len(details)+2)
	for k, v := range details {
		body[k] = v
	}
	body["detail"] = detail
	if code != "" {
		body["code"] = code
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeV2Error(w http.ResponseWriter, status int, detail, code string, details map[string]any) {
	if code == "" {
		code = rpc.CodeForStatus(status)
	}
	errObj := map[string]any{"code": code, "message": detail}
	if len(details) > 0 {
		errObj["details"] = details
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": errObj})
}

// WriteOK writes a successful JSON body. v1 unwraps env.Data (including a
// literal JSON null). v2 writes the RPC envelope. 204 is still empty.
func WriteOK(w http.ResponseWriter, status int, env rpc.Envelope) {
	if status == http.StatusNoContent {
		w.WriteHeader(status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if apiver.WantWriter(w) {
		data := env.Data
		if len(data) == 0 {
			data = []byte("null")
		}
		out := struct {
			OK       bool            `json:"ok"`
			Data     json.RawMessage `json:"data"`
			Warnings json.RawMessage `json:"warnings,omitempty"`
		}{OK: true, Data: data, Warnings: env.Warnings}
		_ = json.NewEncoder(w).Encode(out)
		return
	}
	if len(env.Data) > 0 {
		_, _ = w.Write(env.Data)
	}
}
