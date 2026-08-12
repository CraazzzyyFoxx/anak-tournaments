package tournament

import (
	"testing"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"
)

// Visibility-gated public reads must forward identity so an eligible
// admin/preview viewer of a HIDDEN tournament is not treated as anonymous and
// 404'd. AuthNone would drop the identity (see edge/dispatch.go), reintroducing
// the #115 regression.
func TestVisibilityGatedPublicReadsForwardIdentity(t *testing.T) {
	gated := map[string]bool{
		"rpc.tournament.captain_map_pool": true,
		"rpc.tournament.reg_pub_form":     true,
		"rpc.tournament.reg_pub_list":     true,
		"rpc.tournament.get_veto_configs": true,
	}
	seen := map[string]bool{}
	for _, r := range PublicWriteRoutes {
		if gated[r.Queue] {
			seen[r.Queue] = true
			if r.Auth == edge.AuthNone {
				t.Errorf("%s %s (%s) is AuthNone; must be AuthOptional so hidden-tournament gating sees the viewer", r.Method, r.Pattern, r.Queue)
			}
		}
	}
	for q := range gated {
		if !seen[q] {
			t.Errorf("route %s not found in PublicWriteRoutes", q)
		}
	}
}

// `IDParam` copies the path value to `data["id"]`; `Path` copies params verbatim
// under their own names (see registration_routes.go's header and
// edge/dispatch.go). A worker reading the id via `_require_id` therefore REQUIRES
// `IDParam` — pairing it with `Path` leaves `data["id"]` unset and 422s every
// call with "id is required". `get_veto_configs` lives in tournament-service's
// `reads.py`, whose whole-module contract is `data["id"]`, and shipped as `Path`.
func TestRequireIDWorkersUseIDParam(t *testing.T) {
	// Queues whose handler resolves the path id through `_require_id`.
	requireID := map[string]bool{
		"rpc.tournament.get_veto_configs": true,
	}
	seen := map[string]bool{}
	for _, r := range PublicWriteRoutes {
		if !requireID[r.Queue] {
			continue
		}
		seen[r.Queue] = true
		if r.IDParam == "" {
			t.Errorf(
				"%s %s (%s) has no IDParam; its worker reads data[\"id\"] via _require_id, so Path alone 422s every call",
				r.Method, r.Pattern, r.Queue,
			)
		}
		if len(r.Path) > 0 {
			t.Errorf(
				"%s %s (%s) sets both IDParam and Path=%v; the id must arrive exactly once, as data[\"id\"]",
				r.Method, r.Pattern, r.Queue, r.Path,
			)
		}
	}
	for q := range requireID {
		if !seen[q] {
			t.Errorf("route %s not found in PublicWriteRoutes", q)
		}
	}
}
