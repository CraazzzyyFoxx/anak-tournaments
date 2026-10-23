import type { Schema } from "@/types/api";

/** `GET /api/v1/admin/dashboard`: backend/app-service/src/schemas/dashboard.py. */
export type AdminDashboard = Schema<"tournament.AdminDashboard">;
export type DashboardTournamentCard = Schema<"tournament.DashboardTournamentCard">;
export type DashboardTimelineEvent = Schema<"tournament.DashboardTimelineEvent">;
export type DashboardIssue = Schema<"tournament.DashboardIssue">;
export type DashboardBacklog = Schema<"tournament.DashboardBacklog">;

/** `GET /api/v1/admin/dashboard/trends`: backend/app-service/src/schemas/dashboard_trends.py. */
export type DashboardTrends = Schema<"tournament.DashboardTrends">;
