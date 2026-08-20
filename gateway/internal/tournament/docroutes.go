package tournament

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"

// BinaryDocRoutes documents the multipart upload endpoint handled by the
// tournament binary handler (binary.go), which the JSON edge.Dispatcher can't
// serve. Documentation-only: keep in sync with the mux.HandleFunc registration
// in cmd/gateway/main.go. Queue is the RPC subject (manifest lookup key). The
// paired image delete is plain JSON and lives in AdminCrudRoutes.
var BinaryDocRoutes = []edge.RouteSpec{
	{Method: "POST", Pattern: "/api/v1/admin/teams/{team_id}/image", Queue: "rpc.tournament.teams.image_upload", Auth: edge.AuthRequired}, // multipart: team logo
}
