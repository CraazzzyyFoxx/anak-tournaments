"""Realtime scope: the ACL-bearing subject an event belongs to.

A scope is the only place the topic format lives: publishers, the retention
job's topic patterns and the gateway's prefix split must all agree with it.

Scopes exist because visibility differs, which is why there is no single global
invalidation topic: ``gateway/internal/acl/acl.go`` gates a tournament's topics
on hidden-tournament visibility, a workspace's on membership, and a user's on
being that user. A scope maps 1:1 onto one of those ACL rules.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

__all__ = ("Scope", "ScopeKind")


class ScopeKind(StrEnum):
    TOURNAMENT = "tournament"
    WORKSPACE = "workspace"
    USER = "user"
    ENCOUNTER = "encounter"
    DRAFT = "draft"


@dataclass(frozen=True, slots=True)
class Scope:
    kind: ScopeKind
    id: int

    @classmethod
    def tournament(cls, tournament_id: int) -> Scope:
        return cls(ScopeKind.TOURNAMENT, int(tournament_id))

    @classmethod
    def workspace(cls, workspace_id: int) -> Scope:
        return cls(ScopeKind.WORKSPACE, int(workspace_id))

    @classmethod
    def user(cls, user_id: int) -> Scope:
        return cls(ScopeKind.USER, int(user_id))

    @classmethod
    def encounter(cls, encounter_id: int) -> Scope:
        """Encounter scope carries DATA only (map-veto, hero pick-ban).

        There is deliberately no ``encounter:{id}:invalidation``: whatever an
        encounter write stales is a tournament-scoped resource
        (``tournament.encounters``), and a separate ACL path that resolves the
        owning tournament per subscribe would buy nothing.
        """
        return cls(ScopeKind.ENCOUNTER, int(encounter_id))

    @classmethod
    def draft(cls, draft_session_id: int) -> Scope:
        """A draft SESSION's own topics: its board (``board``) and its chat (``chat``), for a tournament's draft and
        a mix lobby's alike (spec §9.6). Keyed by the session because a session IS the draft. Data only, like
        ``encounter``.
        """
        return cls(ScopeKind.DRAFT, int(draft_session_id))

    @property
    def invalidation_topic(self) -> str:
        if self.kind in (ScopeKind.ENCOUNTER, ScopeKind.DRAFT):
            raise ValueError(
                f"{self.kind} scope has no invalidation topic — name the tournament-scoped resource instead"
            )
        return f"{self.kind}:{self.id}:invalidation"

    def domain_topic(self, domain: str) -> str:
        """``<kind>:<id>:<domain>``.

        ``domain`` may itself contain a colon (``pick-ban:hero``); the ACL's
        segment matcher handles the extra segment.
        """
        return f"{self.kind}:{self.id}:{domain}"

    @property
    def tournament_id(self) -> int | None:
        return self.id if self.kind is ScopeKind.TOURNAMENT else None

    @property
    def workspace_id(self) -> int | None:
        return self.id if self.kind is ScopeKind.WORKSPACE else None
