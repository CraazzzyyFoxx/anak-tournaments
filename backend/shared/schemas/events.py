"""Typed Pydantic models for RabbitMQ event messages.

These schemas provide type safety and validation for all inter-service messaging,
replacing untyped dict objects with validated Pydantic models.
"""

import time

from pydantic import BaseModel, Field


class BaseEvent(BaseModel):
    """Base class for all event messages."""

    event_type: str
    timestamp: float = Field(default_factory=lambda: time.time(), description="UTC epoch timestamp")
    correlation_id: str | None = Field(default=None, description="Request correlation ID for tracing")


class DiscordCommandEvent(BaseEvent):
    """Event for triggering Discord bot commands.

    Published by: parser-service
    Consumed by: discord-service
    """

    event_type: str = Field(default="discord_command", frozen=True)
    action: str = Field(..., description="Action to perform: 'process_all' or 'process_message'")
    tournament_id: int = Field(..., description="Tournament ID to process")
    channel_id: int | None = Field(default=None, description="Discord channel ID (required for 'process_message')")
    message_id: int | None = Field(default=None, description="Discord message ID (required for 'process_message')")

    def model_post_init(self, __context) -> None:
        """Validate that required fields are present for specific actions."""
        if self.action == "process_message":
            if self.channel_id is None or self.message_id is None:
                raise ValueError("channel_id and message_id are required for action='process_message'")


class ProcessMatchLogEvent(BaseEvent):
    """Event for processing a single match log file.

    Published by: parser-service
    Consumed by: parser-service (background worker)
    """

    event_type: str = Field(default="process_match_log", frozen=True)
    tournament_id: int = Field(..., description="Tournament ID")
    filename: str = Field(..., description="Match log filename to process")


class ProcessTournamentLogsEvent(BaseEvent):
    """Event for processing all logs for a tournament.

    Published by: parser-service
    Consumed by: parser-service (background worker)
    """

    event_type: str = Field(default="process_tournament_logs", frozen=True)
    tournament_id: int = Field(..., description="Tournament ID to process logs for")


class BalancerJobEvent(BaseEvent):
    """Event for scheduling a balancer job.

    Published by: balancer-service API
    Consumed by: balancer-service worker
    """

    event_type: str = Field(default="balancer_job", frozen=True)
    job_id: str = Field(..., description="Balancer job identifier")


class TournamentRecalcEvent(BaseEvent):
    """Event for scheduling standings recalculation for one tournament.

    Published by: parser-service API
    Consumed by: parser-service worker
    """

    event_type: str = Field(default="tournament_recalc", frozen=True)
    tournament_id: int = Field(..., description="Tournament ID to recalculate")


class TournamentRecalculatedEvent(BaseEvent):
    """Event emitted after standings recalculation finishes.

    Published by: parser-service worker
    Consumed by: app-service API for cache invalidation and WebSocket fan-out
    """

    event_type: str = Field(default="tournament_recalculated", frozen=True)
    tournament_id: int = Field(..., description="Tournament ID that was recalculated")


class AchievementEvaluateEvent(BaseEvent):
    """Event for triggering achievement evaluation after parsing.

    Published by: parser-service (after match/tournament processing)
    Consumed by: parser-service (achievement engine)
    """

    event_type: str = Field(default="achievement_evaluate", frozen=True)
    workspace_id: int = Field(..., description="Workspace to evaluate achievements for")
    tournament_id: int = Field(..., description="Tournament that was just processed")
    changed_tables: list[str] = Field(
        ...,
        description="DB tables that changed (e.g. ['matches.statistics', 'tournament.encounter'])",
    )
