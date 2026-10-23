package stats

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/rpc"
)

type fakeCaller struct {
	queue string
	body  []byte
	reply []byte
	err   error
	calls int
}

func (f *fakeCaller) Call(_ context.Context, queue string, body []byte) ([]byte, error) {
	f.calls++
	f.queue, f.body = queue, body
	return f.reply, f.err
}

func ingestHandler(f *fakeCaller, authed bool, idErr error) http.Handler {
	identity := func(*http.Request) (map[string]any, bool, error) {
		return map[string]any{"user_id": 7, "credential_type": "api_key"}, authed, idErr
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/stats/matches", NewIngest(f, identity, slog.New(slog.NewTextHandler(io.Discard, nil))).Submit)
	return mux
}

func post(h http.Handler, contentType string, body io.Reader) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/stats/matches", body)
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func envelope(data string) []byte { return []byte(`{"ok":true,"data":` + data + `}`) }

func TestSubmitForwardsOriginalBytesAndIdentityOnly(t *testing.T) {
	// Key order, spacing, duplicate-looking whitespace and a large float must survive untouched: the backend
	// hashes these exact bytes.
	original := "{ \"workspace_id\": 999,\n \"x\": 1.0000000000000000001, \"identity\": {\"user_id\": 1} }"
	f := &fakeCaller{reply: envelope(`{"id":4,"status":"pending"}`)}
	w := post(ingestHandler(f, true, nil), "application/json; charset=utf-8", strings.NewReader(original))
	if w.Code != http.StatusAccepted {
		t.Fatalf("code=%d body=%s", w.Code, w.Body)
	}
	if f.queue != "rpc.stats.ingest.submit" {
		t.Fatalf("queue=%q", f.queue)
	}
	var sent struct {
		Identity map[string]any `json:"identity"`
		Raw      string         `json:"raw_base64"`
		Extra    map[string]any `json:"-"`
	}
	if err := json.Unmarshal(f.body, &sent); err != nil {
		t.Fatalf("rpc body is not JSON: %v", err)
	}
	raw, err := base64.StdEncoding.DecodeString(sent.Raw)
	if err != nil || string(raw) != original {
		t.Fatalf("raw bytes changed: %q err=%v", raw, err)
	}
	if sent.Identity["user_id"] != float64(7) {
		t.Fatalf("identity must be the resolved one, got %v", sent.Identity)
	}
	var top map[string]json.RawMessage
	_ = json.Unmarshal(f.body, &top)
	for _, key := range []string{"workspace_id", "x"} {
		if _, leaked := top[key]; leaked {
			t.Fatalf("request body field %q reached the RPC envelope", key)
		}
	}
}

func TestSubmitStatusFollowsTheReturnedJobState(t *testing.T) {
	for status, want := range map[string]int{
		"pending": 202, "processing": 202, "done": 200, "awaiting_link": 200, "failed": 200,
	} {
		f := &fakeCaller{reply: envelope(`{"id":4,"status":"` + status + `"}`)}
		w := post(ingestHandler(f, true, nil), "application/json", strings.NewReader("{}"))
		if w.Code != want {
			t.Errorf("status %s: code=%d want %d", status, w.Code, want)
		}
		if got := strings.TrimSpace(w.Body.String()); got != `{"id":4,"status":"`+status+`"}` {
			t.Errorf("status %s: body=%s", status, got)
		}
	}
}

func TestSubmitRejectsBeforeAnyRPC(t *testing.T) {
	cases := []struct {
		name        string
		contentType string
		body        io.Reader
		authed      bool
		code        int
		apiCode     string
	}{
		{"unauthenticated", "application/json", strings.NewReader("{}"), false, 401, ""},
		{"missing content type", "", strings.NewReader("{}"), true, 415, "unsupported_media_type"},
		{"text/plain", "text/plain", strings.NewReader("{}"), true, 415, "unsupported_media_type"},
		{"multipart", "multipart/form-data; boundary=x", strings.NewReader("{}"), true, 415, "unsupported_media_type"},
		{"streamed too large", "application/json", io.LimitReader(zeros{}, MaxIngestBody+1), true, 413, "match_document_too_large"},
	}
	for _, tc := range cases {
		f := &fakeCaller{reply: envelope(`{}`)}
		r := httptest.NewRequest(http.MethodPost, "/api/v1/stats/matches", tc.body)
		if tc.contentType != "" {
			r.Header.Set("Content-Type", tc.contentType)
		}
		w := httptest.NewRecorder()
		ingestHandler(f, tc.authed, nil).ServeHTTP(w, r)
		if w.Code != tc.code || f.calls != 0 {
			t.Errorf("%s: code=%d calls=%d", tc.name, w.Code, f.calls)
		}
		var body map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if tc.apiCode != "" && body["code"] != tc.apiCode {
			t.Errorf("%s: code field %v", tc.name, body["code"])
		}
	}
}

type zeros struct{}

func (zeros) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

func TestSubmitAcceptsTheExactLimitAndRejectsOneMoreByte(t *testing.T) {
	f := &fakeCaller{reply: envelope(`{"id":1,"status":"pending"}`)}
	h := ingestHandler(f, true, nil)
	// Streamed (unknown length) so MaxBytesReader, not Content-Length, decides.
	exact := io.NopCloser(io.LimitReader(zeros{}, MaxIngestBody))
	w := post(h, "application/json", exact)
	if w.Code != http.StatusAccepted {
		t.Fatalf("exact limit rejected: %d %s", w.Code, w.Body)
	}
	var sent struct {
		Raw string `json:"raw_base64"`
	}
	_ = json.Unmarshal(f.body, &sent)
	if base64.StdEncoding.DecodedLen(len(sent.Raw)) < MaxIngestBody-2 {
		t.Fatalf("near-limit envelope was truncated: %d", len(sent.Raw))
	}
	calls := f.calls
	r := httptest.NewRequest(http.MethodPost, "/api/v1/stats/matches", io.NopCloser(io.LimitReader(zeros{}, MaxIngestBody+1)))
	r.Header.Set("Content-Type", "application/json")
	r.ContentLength = -1
	over := httptest.NewRecorder()
	h.ServeHTTP(over, r)
	if over.Code != http.StatusRequestEntityTooLarge || f.calls != calls {
		t.Fatalf("over limit: code=%d calls=%d->%d", over.Code, calls, f.calls)
	}
}

func TestSubmitRelaysEnvelopeErrorsFlat(t *testing.T) {
	f := &fakeCaller{reply: []byte(`{"ok":false,"error":{"code":"unprocessable","message":"unknown code","details":{"ingest_job_id":12,"fields":[{"code":"unknown_code"}]}}}`)}
	w := post(ingestHandler(f, true, nil), "application/json", strings.NewReader("{}"))
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != 422 || body["ingest_job_id"] != float64(12) || body["detail"] != "unknown code" || body["code"] != "unprocessable" {
		t.Fatalf("code=%d body=%v", w.Code, body)
	}
}

func TestSubmitNeverClaimsAcceptanceWithoutAnEnvelope(t *testing.T) {
	cases := map[string]struct {
		caller *fakeCaller
		idErr  error
		code   int
		retry  bool
	}{
		"rpc unavailable":      {&fakeCaller{err: rpc.ErrNotConnected}, nil, 503, true},
		"rpc timeout":          {&fakeCaller{err: context.DeadlineExceeded}, nil, 504, false},
		"garbage reply":        {&fakeCaller{reply: []byte("not json")}, nil, 502, false},
		"identity unavailable": {&fakeCaller{}, errors.New("identity down"), 503, true},
	}
	for name, tc := range cases {
		w := post(ingestHandler(tc.caller, true, tc.idErr), "application/json", bytes.NewReader([]byte("{}")))
		if w.Code != tc.code || (w.Header().Get("Retry-After") != "") != tc.retry {
			t.Errorf("%s: code=%d retry-after=%q", name, w.Code, w.Header().Get("Retry-After"))
		}
		if tc.idErr != nil && tc.caller.calls != 0 {
			t.Errorf("%s: rpc called without identity", name)
		}
	}
}

func TestIngestRoutesDocumentTheBareDocumentAndTheJobRead(t *testing.T) {
	if len(IngestDocRoutes) != 2 || IngestDocRoutes[0].Queue != "rpc.stats.ingest.submit" || IngestDocRoutes[0].Success != 202 {
		t.Fatalf("doc routes: %+v", IngestDocRoutes)
	}
	if got := IngestRoutes[0]; got.Method != "GET" || got.Queue != "rpc.stats.ingest.get" || got.IDParam != "id" {
		t.Fatalf("job read route: %+v", got)
	}
}
