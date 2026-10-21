import type { Schema } from "@/types/api";

/** `GET /api/v1/admin/dashboard`: backend/app-service/src/schemas/dashboard.py. */
export type AdminDashboard = Schema<"app.AdminDashboard">;
export type DashboardTournamentCard = Schema<"app.DashboardTournamentCard">;
export type DashboardTimelineEvent = Schema<"app.DashboardTimelineEvent">;
export type DashboardIssue = Schema<"app.DashboardIssue">;
export type DashboardBacklog = Schema<"app.DashboardBacklog">;

/** `GET /api/v1/admin/dashboard/trends`: backend/app-service/src/schemas/dashboard_trends.py. */
export type DashboardTrends = Schema<"app.DashboardTrends">;
export type DashboardTrendPoint = Schema<"app.DashboardTrendPoint">;
