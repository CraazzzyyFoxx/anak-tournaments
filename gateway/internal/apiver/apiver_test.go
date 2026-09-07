package apiver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRewritePath(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"/api/v1/heroes", "/api/v1/heroes", false},
		{"/api/v2", "/api/v1/", true},
		{"/api/v2/", "/api/v1/", true},
		{"/api/v2/heroes", "/api/v1/heroes", true},
		{"/api/v2/admin/users/5", "/api/v1/admin/users/5", true},
		{"/api/auth/me", "/api/auth/me", false},
	}
	for _, tc := range cases {
		got, ok := rewritePath(tc.in)
		if ok != tc.ok || got != tc.want {
			t.Errorf("rewritePath(%q)=(%q,%v) want (%q,%v)", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}

func TestMiddleware_RewritesAndFlags(t *testing.T) {
	var sawPath string
	var sawWant, sawWriter bool
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawPath = r.URL.Path
		sawWant = Want(r)
		sawWriter = WantWriter(w)
		w.WriteHeader(http.StatusNoContent)
	})
	h := Middleware(inner)

	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v2/heroes/1", nil))
	if sawPath != "/api/v1/heroes/1" || !sawWant || !sawWriter {
		t.Fatalf("path=%q want=%v writer=%v", sawPath, sawWant, sawWriter)
	}

	sawPath, sawWant, sawWriter = "", false, false
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/heroes/1", nil))
	if sawPath != "/api/v1/heroes/1" || sawWant || sawWriter {
		t.Fatalf("v1 leaked v2: path=%q want=%v writer=%v", sawPath, sawWant, sawWriter)
	}
}
