package stream

import (
	"net/http"
	"testing"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"
)

// Every cacheable pattern must exist in PublicRoutes as a GET — a renamed or
// removed route would otherwise leave a dead rule that silently caches nothing
// (or worse, a future non-GET reuse of the pattern).
func TestPublicCacheableReadsMatchRouteTable(t *testing.T) {
	routes := make(map[string]string, len(PublicRoutes))
	for _, r := range PublicRoutes {
		routes[r.Pattern] = r.Method
	}
	for pattern := range PublicCacheableReads {
		method, ok := routes[pattern]
		if !ok {
			t.Errorf("cacheable pattern %q is not in PublicRoutes", pattern)
			continue
		}
		if method != http.MethodGet {
			t.Errorf("cacheable pattern %q is %s, only GET may be cached", pattern, method)
		}
	}
}

// TestRoutesRegisterWithoutConflict guards against ServeMux pattern conflicts,
// which panic at registration time (runtime), not at build time. The repoll
// pattern nests under the read pattern's {tournament_id}, so the two must
// coexist rather than shadow each other.
func TestRoutesRegisterWithoutConflict(t *testing.T) {
	mux := http.NewServeMux()
	dummy := func(http.ResponseWriter, *http.Request) {}

	for _, set := range [][]edge.RouteSpec{PublicRoutes, AdminRoutes} {
		for _, s := range set {
			mux.HandleFunc(s.Method+" "+s.Pattern, dummy)
		}
	}
}
