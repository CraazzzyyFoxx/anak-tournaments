package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// logCaller answers rpc.app.matches.log with a minimal success envelope and
// records the request body, so a test can assert what the gateway forwarded.
type logCaller struct {
	body []byte
}

func (c *logCaller) Call(_ context.Context, _ string, body []byte) ([]byte, error) {
	c.body = body
	payload, _ := json.Marshal(map[string]any{
		"content_b64": base64.StdEncoding.EncodeToString([]byte("log bytes")),
		"media_type":  "text/plain",
		"filename":    "match.txt",
	})
	return json.Marshal(map[string]any{"ok": true, "data": json.RawMessage(payload)})
}

func discardLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func matchLogRequest() *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/api/v1/matches/7/log", nil)
	r.SetPathValue("match_id", "7")
	return r
}

// The handler read no credential at all while docroutes.go declared it
// AuthRequired: every parsed match log was world-readable. Pin the contract.
func TestMatchLogRejectsAnonymous(t *testing.T) {
	caller := &logCaller{}
	anonymous := func(*http.Request) (map[string]any, bool, error) { return nil, false, nil }
	b := NewBinary(caller, anonymous, anonymous, discardLog())

	w := httptest.NewRecorder()
	b.MatchLog(w, matchLogRequest())

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if caller.body != nil {
		t.Error("an unauthenticated download must not reach the worker")
	}
}

// The link is an `<a download>` the browser navigates to, so the credential
// cannot ride an Authorization header — only the session cookie. If this route
// ever loses its download-aware resolver, the feature breaks for every signed-in
// user, which is the failure this test exists to catch.
func TestMatchLogAcceptsTheDownloadResolverAndForwardsIdentity(t *testing.T) {
	caller := &logCaller{}
	identity := map[string]any{"user_id": float64(42)}
	b := NewBinary(
		caller,
		func(*http.Request) (map[string]any, bool, error) { return nil, false, nil },
		func(*http.Request) (map[string]any, bool, error) { return identity, true, nil },
		discardLog(),
	)

	w := httptest.NewRecorder()
	b.MatchLog(w, matchLogRequest())

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if got := w.Body.String(); got != "log bytes" {
		t.Errorf("body = %q, want the decoded log", got)
	}
	if got := w.Header().Get("Content-Disposition"); got != `attachment; filename="match.txt"` {
		t.Errorf("Content-Disposition = %q", got)
	}

	var forwarded map[string]any
	if err := json.Unmarshal(caller.body, &forwarded); err != nil {
		t.Fatalf("worker body: %v", err)
	}
	if forwarded["id"] != "7" {
		t.Errorf("id = %v, want the path value", forwarded["id"])
	}
	if _, ok := forwarded["identity"]; !ok {
		t.Error("identity must be injected so the worker can gate on it")
	}
}

// A nil download resolver must fail closed, never fall back to "public".
func TestMatchLogWithoutADownloadResolverRejects(t *testing.T) {
	caller := &logCaller{}
	b := NewBinary(caller, nil, nil, discardLog())

	w := httptest.NewRecorder()
	b.MatchLog(w, matchLogRequest())

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}
