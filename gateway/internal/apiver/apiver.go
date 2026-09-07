// Package apiver rewrites /api/v2 onto the existing /api/v1 route table and
// marks the request so JSON writers emit the RPC envelope instead of unwrapping
// data.
//
// v1 stays the unwrapped FastAPI-shaped contract. v2 is the same handlers,
// same HTTP status, body = {ok, data, warnings?} / {ok:false, error}.
package apiver

import (
	"context"
	"net/http"
	"strings"
)

type ctxKey struct{}

// flagWriter marks a ResponseWriter as v2 so apierr can pick the envelope
// body without threading *http.Request through every writeDetail.
type flagWriter struct{ http.ResponseWriter }

func (w *flagWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// Want reports whether r is a v2 API request (path was /api/v2...).
func Want(r *http.Request) bool {
	if r == nil {
		return false
	}
	v, _ := r.Context().Value(ctxKey{}).(bool)
	return v
}

// WantWriter reports whether w (or something it unwraps to) is the v2 flag.
func WantWriter(w http.ResponseWriter) bool {
	for w != nil {
		if _, ok := w.(*flagWriter); ok {
			return true
		}
		u, ok := w.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			return false
		}
		w = u.Unwrap()
	}
	return false
}

// Middleware rewrites /api/v2(/...) to /api/v1(/...) and stamps the writer
// + request context. Unmatched v2 paths hit the existing /api/v1/ 404 guard.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		orig := r
		if np, ok := rewritePath(r.URL.Path); ok {
			r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, true))
			r.URL.Path = np
			w = &flagWriter{w}
		}
		next.ServeHTTP(w, r)
		orig.Pattern = r.Pattern
	})
}

func rewritePath(p string) (string, bool) {
	switch {
	case p == "/api/v2":
		return "/api/v1/", true
	case strings.HasPrefix(p, "/api/v2/"):
		return "/api/v1/" + strings.TrimPrefix(p, "/api/v2/"), true
	default:
		return p, false
	}
}
