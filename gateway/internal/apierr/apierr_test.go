package apierr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/apiver"
	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/rpc"
)

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body not JSON: %v (%q)", err, w.Body.String())
	}
	return body
}

func TestWriteError_DetailOnly(t *testing.T) {
	w := httptest.NewRecorder()
	WriteError(w, 400, "bad", "", nil)
	if w.Code != 400 {
		t.Fatalf("code=%d", w.Code)
	}
	body := decode(t, w)
	if body["detail"] != "bad" {
		t.Fatalf("detail=%v", body["detail"])
	}
	if _, ok := body["code"]; ok {
		t.Fatalf("code must be absent when empty: %#v", body)
	}
}

// The whole point of the shared helper: every relay site emits the machine code
// and the worker's structured detail, instead of five of six dropping them.
func TestWriteEnvelopeError_RelaysCodeFieldsAndRetryAfter(t *testing.T) {
	w := httptest.NewRecorder()
	WriteEnvelopeError(w, &rpc.EnvelopeError{
		Code:    "rate_limited",
		Message: "Balancer rate limit exceeded: jobs_per_day",
		Details: map[string]any{
			"retry_after": float64(42),
			"fields":      []any{map[string]any{"field": "config", "msg": "too high", "code": "api_key_config_value_too_high"}},
		},
	})

	if w.Code != 429 {
		t.Fatalf("code=%d, want 429", w.Code)
	}
	if got := w.Header().Get("Retry-After"); got != "42" {
		t.Fatalf("Retry-After=%q, want 42", got)
	}
	body := decode(t, w)
	if body["code"] != "rate_limited" {
		t.Fatalf("code=%v", body["code"])
	}
	if body["detail"] != "Balancer rate limit exceeded: jobs_per_day" {
		t.Fatalf("detail=%v", body["detail"])
	}
	fields, _ := body["fields"].([]any)
	if len(fields) != 1 {
		t.Fatalf("fields=%#v", body["fields"])
	}
}

// A nil error is a worker bug, not a client one: it must still produce a valid
// JSON 500 rather than an empty body callers cannot parse.
func TestWriteEnvelopeError_NilIsInternal(t *testing.T) {
	w := httptest.NewRecorder()
	WriteEnvelopeError(w, nil)
	if w.Code != 500 {
		t.Fatalf("code=%d", w.Code)
	}
	if body := decode(t, w); body["code"] != "internal" {
		t.Fatalf("body=%#v", body)
	}
}

// Worker details must never be able to overwrite the two keys clients rely on.
func TestWriteError_DetailsCannotShadowContract(t *testing.T) {
	w := httptest.NewRecorder()
	WriteError(w, 403, "real detail", "forbidden", map[string]any{"detail": "spoofed", "code": "spoofed"})
	body := decode(t, w)
	if body["detail"] != "real detail" || body["code"] != "forbidden" {
		t.Fatalf("body=%#v", body)
	}
}

// The envelopes below are the VERBATIM bytes balancer-service emits today
// (captured from src/rpc/_common.py::_map_error against the real
// api_key_policy / rate-limit raise sites). They pin the contract across the
// language boundary: if either side changes shape this fails, instead of
// silently dropping data on the wire — which is how the machine code and the
// retry budget went missing in the first place.
func TestWriteEnvelopeError_RealWorkerEnvelopes(t *testing.T) {
	t.Run("api key config rejection", func(t *testing.T) {
		const reply = `{"error": {"code": "bad_request", "details": {"fields": [{"code": "api_key_config_value_too_high", "field": "population_size", "max": 150, "msg": "api key config value too high"}]}, "message": "api key config value too high"}, "ok": false}`

		var env rpc.Envelope
		if err := json.Unmarshal([]byte(reply), &env); err != nil {
			t.Fatalf("worker envelope no longer parses: %v", err)
		}
		w := httptest.NewRecorder()
		WriteEnvelopeError(w, env.Error)

		if w.Code != 400 {
			t.Fatalf("code=%d, want 400", w.Code)
		}
		body := decode(t, w)
		if body["code"] != "bad_request" {
			t.Fatalf("code=%v", body["code"])
		}
		fields, _ := body["fields"].([]any)
		if len(fields) != 1 {
			t.Fatalf("fields=%#v", body["fields"])
		}
		entry, _ := fields[0].(map[string]any)
		// The specific code and the cap that was exceeded are what a client
		// needs; both used to arrive JSON-encoded inside the message string.
		if entry["code"] != "api_key_config_value_too_high" {
			t.Errorf("fields[0].code=%v", entry["code"])
		}
		if entry["max"] != float64(150) {
			t.Errorf("fields[0].max=%v", entry["max"])
		}
		if entry["field"] != "population_size" {
			t.Errorf("fields[0].field=%v", entry["field"])
		}
	})

	t.Run("job quota exhausted", func(t *testing.T) {
		const reply = `{"error": {"code": "rate_limited", "details": {"retry_after": 30}, "message": "Balancer rate limit exceeded: jobs_per_day"}, "ok": false}`

		var env rpc.Envelope
		if err := json.Unmarshal([]byte(reply), &env); err != nil {
			t.Fatalf("worker envelope no longer parses: %v", err)
		}
		w := httptest.NewRecorder()
		WriteEnvelopeError(w, env.Error)

		if w.Code != 429 {
			t.Fatalf("code=%d, want 429", w.Code)
		}
		// The header the worker could never set itself.
		if got := w.Header().Get("Retry-After"); got != "30" {
			t.Fatalf("Retry-After=%q, want 30", got)
		}
		if body := decode(t, w); body["code"] != "rate_limited" {
			t.Fatalf("body=%#v", body)
		}
	})
}

func TestWriteOK_V1UnwrapsData(t *testing.T) {
	w := httptest.NewRecorder()
	WriteOK(w, 200, rpc.Envelope{OK: true, Data: json.RawMessage(`{"id":5}`)})
	if w.Body.String() != `{"id":5}` {
		t.Fatalf("body=%q", w.Body.String())
	}
}

func TestV2_ErrorAndOKEnvelope(t *testing.T) {
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/ok":
			WriteOK(w, 200, rpc.Envelope{
				OK:       true,
				Data:     json.RawMessage(`{"id":5}`),
				Warnings: json.RawMessage(`[{"code":"truncated","message":"capped"}]`),
			})
		default:
			WriteError(w, 404, "Not Found", "", nil)
		}
	})
	wrap := apiver.Middleware(h)

	w := httptest.NewRecorder()
	wrap.ServeHTTP(w, httptest.NewRequest("GET", "/api/v2/ok", nil))
	if w.Code != 200 {
		t.Fatalf("ok code=%d", w.Code)
	}
	okBody := decode(t, w)
	if okBody["ok"] != true {
		t.Fatalf("ok body=%#v", okBody)
	}
	data, _ := okBody["data"].(map[string]any)
	if data["id"] != float64(5) {
		t.Fatalf("data=%#v", okBody["data"])
	}
	if _, has := okBody["warnings"]; !has {
		t.Fatalf("warnings missing: %#v", okBody)
	}

	w = httptest.NewRecorder()
	wrap.ServeHTTP(w, httptest.NewRequest("GET", "/api/v2/missing", nil))
	if w.Code != 404 {
		t.Fatalf("err code=%d", w.Code)
	}
	errBody := decode(t, w)
	if errBody["ok"] != false {
		t.Fatalf("err body=%#v", errBody)
	}
	errObj, _ := errBody["error"].(map[string]any)
	if errObj["code"] != "not_found" || errObj["message"] != "Not Found" {
		t.Fatalf("error=%#v", errObj)
	}
}
