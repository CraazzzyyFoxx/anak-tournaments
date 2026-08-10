from __future__ import annotations

__all__ = (
    "analytics_jobs",
    "balancer",
    "bracket",
    "draft",
    "logs",
    "map_veto",
    "pick_ban_hero",
    "realtime_channel",
    "subscriptions",
    "workspace_notifications",
)

REALTIME_CHANNEL_PREFIX = "realtime:"


def bracket(tournament_id: int) -> str:
    return f"tournament:{int(tournament_id)}:bracket"


def draft(tournament_id: int) -> str:
    return f"tournament:{int(tournament_id)}:draft"


def map_veto(encounter_id: int) -> str:
    """Public topic for live map-veto/pick updates on a single encounter.

    Carries a thin ``map_veto.updated`` signal (no per-viewer state); clients
    refetch the map-pool state on receipt. Public-subscribable, like the
    bracket/draft spectator topics.
    """
    return f"encounter:{int(encounter_id)}:map-veto"


def pick_ban_hero(encounter_id: int) -> str:
    """Public topic for live hero-ban updates on a single encounter.

    Sibling of :func:`map_veto`, kept as its own topic (rather than a
    ``kind``-parametrized ``map_veto``) so the legacy map-veto room's
    subscribers are never woken by a hero-only change and vice versa — see
    docs/plans/2026-08-09-generic-pickban-engine.md Design Section 4.
    """
    return f"encounter:{int(encounter_id)}:pick-ban:hero"


def balancer(tournament_id: int) -> str:
    """Topic for live balancer collaboration on a single tournament.

    Carries data-edit signals (``balancer.*_changed``), job-status events
    (``balancer_job.*``), and ephemeral presence (``balancer.presence``).
    Unlike the public draft/bracket topics, access is gated by workspace
    membership (see the gateway topic ACL, gateway/internal/acl).
    """
    return f"tournament:{int(tournament_id)}:balancer"


def logs(workspace_id: int) -> str:
    """Topic for live match-log processing updates within a workspace.

    Carries a thin ``logs.updated`` signal (no record data); the admin log
    monitor refetches ``/admin/logs/history`` on receipt. Gated by workspace
    membership via the existing ``workspace:*:*`` ACL rule.
    """
    return f"workspace:{int(workspace_id)}:logs"


def workspace_notifications(workspace_id: int) -> str:
    return f"workspace:{int(workspace_id)}:notifications"


def subscriptions(workspace_id: int) -> str:
    """Topic for subscription-entitlement changes within a workspace.

    Carries a thin ``subscription.updated`` signal (no verdict, no user); the
    admin subscription views and the tournament hub refetch on receipt. Workspace
    scoped because an entitlement is (workspace, user, provider) — one change is
    visible in every tournament that workspace runs. Gated by workspace
    membership via the existing ``workspace:*:*`` ACL rule, which is also why the
    public participants list does NOT get this signal: who is being checked is
    not spectator data.
    """
    return f"workspace:{int(workspace_id)}:subscriptions"


def analytics_jobs(workspace_id: int) -> str:
    """Topic for unified analytics-job progress events.

    Frontend subscribes to ``workspace:{id}:analytics_jobs`` after a job is
    dispatched and receives ``analytics_job.*`` events as the worker runs
    each stage.
    """
    return f"workspace:{int(workspace_id)}:analytics_jobs"


def realtime_channel(topic: str) -> str:
    return f"{REALTIME_CHANNEL_PREFIX}{topic}"
