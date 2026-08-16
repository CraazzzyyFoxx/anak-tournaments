// Package stream holds the gateway route table for stream-service, translated
// to typed RPC via the shared edge.Dispatcher. The table is data; the
// dispatcher is generic.
//
// The whole /api/streams/* namespace is typed RPC — there is no HTTP
// stream-service to proxy to, so unmatched paths are guarded with 404 in
// cmd/gateway/main.go (the frontend rewrites /api/streams/* back to the
// gateway, so falling through to the "/" catch-all would loop).
package stream

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"

// PublicRoutes is the spectator read: which channels are live for a
// tournament. Public (AuthNone) — the handler gates hidden tournaments itself
// with assert_tournament_viewable, so an anonymous 200 already proves the
// tournament is publicly visible.
var PublicRoutes = []edge.RouteSpec{
	{Method: "GET", Pattern: "/api/streams/tournament/{tournament_id}", Queue: "rpc.stream.tournament_streams", Path: []string{"tournament_id"}, AllQuery: true, Auth: edge.AuthNone},
}

// AdminRoutes carries the two operator surfaces:
//
//   - poller health — why nothing is live. The tick swallows every Helix failure
//     so an outage cannot kill the scheduler, which means a broken poller and a
//     working one look identical from outside; this read names the difference.
//     Gated by a GLOBAL stream.read in the handler, not a workspace-scoped one:
//     there is one poller for the whole platform.
//   - re-poll — force the next heartbeat to run a tick instead of waiting out the
//     configured interval. Gated by stream.update; 202 because the work happens on
//     the poller's own schedule, not in this request.
var AdminRoutes = []edge.RouteSpec{
	{Method: "GET", Pattern: "/api/streams/health", Queue: "rpc.stream.health", Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/streams/tournament/{tournament_id}/repoll", Queue: "rpc.stream.repoll", Path: []string{"tournament_id"}, Query: []string{"workspace_id"}, Auth: edge.AuthRequired, Success: 202},
}
