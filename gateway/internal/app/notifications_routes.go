package app

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"

// NotificationRoutes is the personal inbox: a paginated read and the bulk
// read-mark write. Both AuthRequired — the audience is computed in the worker
// from the injected identity alone, never from a client-supplied id, so there
// is nothing here to serve without one.
var NotificationRoutes = []edge.RouteSpec{
	{Method: "GET", Pattern: "/api/notifications", Queue: "rpc.app.notifications_list", AllQuery: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/notifications/read", Queue: "rpc.app.notifications_mark_read", Body: true, Auth: edge.AuthRequired},
}

// AnnouncementPublicRoutes serves the site-wide banner.
//
// AuthOptional, not AuthNone: under AuthNone the dispatcher never injects
// data["identity"], so the worker could not filter out the announcements this
// viewer already dismissed — every logged-in reader would keep seeing them.
// stream.PublicRoutes documents the same choice for the same reason. Anonymous
// visitors still reach it and get the global-audience rows.
var AnnouncementPublicRoutes = []edge.RouteSpec{
	{Method: "GET", Pattern: "/api/announcements/active", Queue: "rpc.app.active_announcements", Auth: edge.AuthOptional},
}

// AnnouncementAdminRoutes is the operator CRUD. AuthRequired only; which
// principal is actually needed depends on the row's audience (workspace grant
// vs. platform superuser) and is decided in app-service, which is the only
// side that can see the stored audience of an existing row.
var AnnouncementAdminRoutes = []edge.RouteSpec{
	{Method: "GET", Pattern: "/api/v1/admin/announcements", Queue: "rpc.app.announcement_list", AllQuery: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/announcements", Queue: "rpc.app.announcement_create", Body: true, Auth: edge.AuthRequired, Success: 201},
	{Method: "PATCH", Pattern: "/api/v1/admin/announcements/{id}", Queue: "rpc.app.announcement_update", IDParam: "id", Body: true, Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/announcements/{id}", Queue: "rpc.app.announcement_delete", IDParam: "id", Auth: edge.AuthRequired, Success: 204},
}
