"""The one resolver of "which roles does this registration play, and at what rank".

    RosterEngine.for_tournament(session, tournament_id)
        -> {registration_id: PlayerRoster}

Everything downstream -- admin list, pool verdict, balancer algorithm input,
draft pool, draft board, feasibility, autopick, draft export -- projects those
value objects. No consumer touches ``registration_role.rank_value``,
``member_rank`` or the snapshot tables directly, and no consumer keeps a copy;
the only stored derivation is the ``(role, rank)`` a completed draft pick
freezes as a historical fact.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.core.social import display_social_handle
from shared.disciplines import identity_provider, rated_role_codes
from shared.division_grid import DivisionGrid
from shared.domain.member_rank import RankScope, ResolvedRank
from shared.domain.player_sub_roles import workspace_sub_role_slug
from shared.domain.roster import CharacterRef, PlayerRoster, RosterRole, flex_role_mode
from shared.domain.roster_shape import RosterShape
from shared.models.registration.registration import (
    Registration,
    RegistrationForm,
    RegistrationIdentity,
    RegistrationRole,
    RegistrationRoleEntity,
)
from shared.models.tenancy.workspace import WorkspaceMember
from shared.models.tournament import Tournament
from shared.registration_statuses import balancer_pool_included_clause
from shared.repository import TournamentRepository
from shared.schemas.identity import PlayerIdentityRead
from shared.schemas.role import RoleRef
from shared.services.division_grid.access import get_effective_division_grid
from shared.services.member_rank import TOURNAMENT_ORDER, MemberRankService, member_rank_service

__all__ = ("RosterEngine", "registration_load_options", "roster_engine")


def registration_load_options() -> list[Any]:
    """Everything the engine reads off a registration, eager-loaded.

    A caller that already selects registrations for its own reasons passes these
    so :meth:`RosterEngine.resolve` never lazy-loads (which would raise
    ``MissingGreenlet`` in async code).
    """
    return [
        selectinload(Registration.roles)
        .selectinload(RegistrationRole.hero_entries)
        .selectinload(RegistrationRoleEntity.entity),
        selectinload(Registration.workspace_member).selectinload(WorkspaceMember.player),
        selectinload(Registration.identities),
        selectinload(Registration.form_version),
    ]


def _primary_tag_order(provider: str) -> sa.ScalarSelect[str]:
    """The event provider's primary handle, as a correlated scalar.

    Joining would multiply registrations that carry several handles.
    """
    return (
        sa.select(RegistrationIdentity.handle_normalized)
        .where(
            RegistrationIdentity.registration_id == Registration.id,
            RegistrationIdentity.provider == provider,
            RegistrationIdentity.position == 0,
        )
        .limit(1)
        .correlate(Registration)
        .scalar_subquery()
    )


def _pool_clauses(tournament_id: int) -> tuple[Any, ...]:
    """The balancer pool predicate, exactly as the panel defines it."""
    return (
        Registration.status == "approved",
        Registration.deleted_at.is_(None),
        balancer_pool_included_clause(
            Registration.balancer_status,
            sa.select(Tournament.workspace_id).where(Tournament.id == tournament_id).scalar_subquery(),
        ),
    )


def _character_refs(role: RegistrationRole) -> tuple[CharacterRef, ...]:
    return tuple(
        CharacterRef(id=entry.entity.id, slug=entry.entity.slug, image_path=entry.entity.image_path)
        for entry in sorted(role.hero_entries or [], key=lambda entry: entry.priority)
        if entry.entity is not None
    )


class RosterEngine:
    def __init__(
        self,
        *,
        ranks: MemberRankService = member_rank_service,
        tournaments: TournamentRepository = TournamentRepository(),
    ) -> None:
        self.ranks = ranks
        self.tournaments = tournaments

    # -- entry points --------------------------------------------------------

    async def for_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
        *,
        pool_only: bool = False,
        registration_ids: Sequence[int] | None = None,
        include_deleted: bool = False,
    ) -> dict[int, PlayerRoster]:
        """Every registration of a tournament, resolved. The one entry point.

        ``pool_only`` narrows to the balancer pool exactly as the panel defines it
        (approved, not deleted, and a ``balancer_status`` that does not exclude) --
        this is what the draft seeds from and what the balance job balances.
        """
        tournament = await self.tournaments.get(session, tournament_id)
        if tournament is None:
            return {}
        query = (
            sa.select(Registration)
            .where(Registration.tournament_id == tournament_id)
            .options(*registration_load_options())
            .order_by(_primary_tag_order(identity_provider(tournament.discipline)).asc(), Registration.id.asc())
        )
        if not include_deleted:
            query = query.where(Registration.deleted_at.is_(None))
        if pool_only:
            query = query.where(*_pool_clauses(tournament_id))
        if registration_ids is not None:
            if not registration_ids:
                return {}
            query = query.where(Registration.id.in_(list(registration_ids)))

        registrations = list(await session.scalars(query))
        return await self.resolve(
            session,
            registrations,
            workspace_id=tournament.workspace_id,
            tournament_id=tournament_id,
            discipline=tournament.discipline,
            role_codes=rated_role_codes(tournament.discipline),
        )

    async def pool_ids(self, session: AsyncSession, tournament_id: int, registration_ids: Sequence[int]) -> set[int]:
        """Which of these registrations the balancer pool includes -- ids only.

        For a caller that resolves several leniencies at once: narrowing with
        this and then resolving the union in ONE :meth:`for_tournament` pass
        costs one cheap id query instead of a second full engine run.
        """
        if not registration_ids:
            return set()
        rows = await session.scalars(
            sa.select(Registration.id).where(
                Registration.tournament_id == tournament_id,
                Registration.id.in_(list(registration_ids)),
                *_pool_clauses(tournament_id),
            )
        )
        return set(rows)

    async def resolve(
        self,
        session: AsyncSession,
        registrations: Sequence[Registration],
        *,
        workspace_id: int | None,
        tournament_id: int | None = None,
        form: RegistrationForm | None = None,
        grid: DivisionGrid | None = None,
        order: Sequence[RankScope] = TOURNAMENT_ORDER,
        author_user_id: int | None = None,
        role_codes: Sequence[str] | None = None,
        discipline: str | None = None,
    ) -> dict[int, PlayerRoster]:
        """Resolve already-loaded registrations. Rows must carry
        :func:`registration_load_options`.

        ``form``/``grid`` are read from the tournament when omitted; pass them when
        the caller already holds them (the admin list does) to save two queries.
        """
        if not registrations:
            return {}
        if tournament_id is None:
            tournament_id = next((reg.tournament_id for reg in registrations), None)
        if role_codes is None or discipline is None:
            tournament = await self.tournaments.get(session, tournament_id)
            discipline = discipline or tournament.discipline
            role_codes = role_codes or rated_role_codes(discipline)
        if form is None and tournament_id is not None:
            form = await session.scalar(
                sa.select(RegistrationForm)
                # ``flex_role_mode`` reads the schema off the current version,
                # which is never lazy-loadable in async code.
                .options(selectinload(RegistrationForm.current_version))
                .where(RegistrationForm.tournament_id == tournament_id)
            )
        mode = flex_role_mode(form)
        if grid is None:
            grid = await get_effective_division_grid(session, workspace_id, tournament_id, discipline=discipline)

        declared = {reg.id: self._declared_roles(reg, mode=mode, role_codes=role_codes) for reg in registrations}
        resolved = await self._resolve_ranks(
            session,
            registrations,
            declared=declared,
            workspace_id=workspace_id,
            discipline=discipline,
            grid=grid,
            order=order,
            author_user_id=author_user_id,
        )
        provider = identity_provider(discipline)
        return {
            reg.id: self._build(reg, declared[reg.id], resolved.get(reg.id, {}), mode=mode, provider=provider)
            for reg in registrations
        }

    # -- role set ------------------------------------------------------------

    def _declared_roles(
        self, reg: Registration, *, mode: str, role_codes: Sequence[str]
    ) -> tuple[RegistrationRole | str, ...]:
        """The roles this registration declares, in priority order.

        ``optional``: the active rows, as written. ``all_roles``/``forced``: the
        rows in the registrant's order (primary first), then every role with no
        row at all synthesized after them in canonical order -- role is not a
        constraint there, so a row the sheet import left inactive (its rank did
        not parse) still names a role the player can be drafted on. A bare
        string in the result is such a synthesized role. The registrant's
        own priority is never replaced by the module order: it is what the
        balancer's discomfort is built from. A registration with no rows gets no
        lead -- there is nobody's choice to stand in for.
        """
        rows = sorted(reg.roles or [], key=lambda row: (row.priority, row.id or 0))
        by_role: dict[str, RegistrationRole] = {}
        for row in rows:
            role = row.role
            if role not in role_codes or role in by_role:
                continue
            if mode == "optional" and not row.is_active:
                continue
            by_role[role] = row
        declared = sorted(by_role.values(), key=lambda row: not row.is_primary)
        if mode == "optional":
            return tuple(declared)
        return (*declared, *(role for role in role_codes if role not in by_role))

    # -- ranks ---------------------------------------------------------------

    async def _resolve_ranks(
        self,
        session: AsyncSession,
        registrations: Sequence[Registration],
        *,
        declared: Mapping[int, tuple[RegistrationRole | str, ...]],
        workspace_id: int | None,
        discipline: str,
        grid: DivisionGrid | None,
        order: Sequence[RankScope],
        author_user_id: int | None,
    ) -> dict[int, dict[str, ResolvedRank]]:
        """``{registration_id: {role: ResolvedRank}}`` under ``order``.

        The registration's own number is one layer among several: an empty
        ``rank_value`` *inherits* the workspace canon and then the discipline's native ladder
        rather than reading as "unranked". Without a workspace
        (no tournament in hand) or without a member (no identity to inherit
        through) only that own layer exists.
        """
        own: dict[int, dict[str, int | None]] = {}
        member_of: dict[int, int] = {}
        for reg in registrations:
            entries = declared.get(reg.id, ())
            own[reg.id] = {
                (entry if isinstance(entry, str) else entry.role): (
                    None if isinstance(entry, str) else entry.rank_value
                )
                for entry in entries
            }
            if reg.workspace_member_id is not None and own[reg.id]:
                member_of[reg.id] = reg.workspace_member_id

        if workspace_id is None or not member_of:
            return {
                registration_id: {
                    role: ResolvedRank(value, "registration" if value is not None else "none")
                    for role, value in roles.items()
                }
                for registration_id, roles in own.items()
            }

        roles_wanted = sorted({role for roles in own.values() for role in roles})
        resolved = await self.ranks.resolve(
            session,
            workspace_id=workspace_id,
            discipline=discipline,
            members=await self._players_by_member(
                session, workspace_id=workspace_id, member_ids=list(member_of.values())
            ),
            roles=roles_wanted,
            order=order,
            author_user_id=author_user_id,
            registration_ranks={
                (member_id, role): value
                for registration_id, member_id in member_of.items()
                for role, value in own[registration_id].items()
                if value is not None
            },
            grid=grid,
        )

        out: dict[int, dict[str, ResolvedRank]] = {}
        for registration_id, roles in own.items():
            # The own layer doubles as the fallback, so a member the workspace
            # filter rejected cannot blank out the number the organiser typed.
            fallback = {
                role: ResolvedRank(value, "registration" if value is not None else "none")
                for role, value in roles.items()
            }
            member_id = member_of.get(registration_id)
            out[registration_id] = (
                fallback
                if member_id is None
                else {role: resolved.get((member_id, role), rank) for role, rank in fallback.items()}
            )
        return out

    async def _players_by_member(
        self, session: AsyncSession, *, workspace_id: int, member_ids: Sequence[int]
    ) -> dict[int, int | None]:
        """``{workspace_member_id: players.user.id}`` -- what the Overwatch layer keys on."""
        if not member_ids:
            return {}
        rows = await session.execute(
            sa.select(WorkspaceMember.id, WorkspaceMember.player_id).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.id.in_(sorted(set(member_ids))),
            )
        )
        return dict(rows.all())

    # -- assembly ------------------------------------------------------------

    def _build(
        self,
        reg: Registration,
        declared: tuple[RegistrationRole | str, ...],
        resolved: Mapping[str, ResolvedRank],
        *,
        mode: str,
        provider: str,
    ) -> PlayerRoster:
        entries: list[RosterRole] = []
        from_row: set[str] = set()
        for priority, entry in enumerate(declared):
            row = None if isinstance(entry, str) else entry
            role = entry if isinstance(entry, str) else entry.role
            if row is not None:
                from_row.add(role)
            rank = resolved.get(role, ResolvedRank(None, "none"))
            entries.append(
                RosterRole(
                    role=role,
                    rank=rank.value,
                    source=rank.source,
                    is_primary=bool(row.is_primary) if row is not None else False,
                    priority=priority,
                    subrole=row.subrole if row is not None else None,
                    top_characters=_character_refs(row) if row is not None else (),
                )
            )

        if mode != "optional":
            # Role stops being a constraint: every role the tournament runs is
            # playable, so a role no layer ranked inherits the player's strongest
            # number -- the balancer's eligibility for a role IS having one. A role
            # with its own rating keeps it, because the draft's role chooser SHOWS it.
            best = max((entry.rank for entry in entries if entry.is_playable), default=None)
            if best is not None:
                entries = [
                    entry if entry.is_playable else RosterRole(**{**_as_dict(entry), "rank": best}) for entry in entries
                ]

        # THE flex predicate. Over the roles the player actually declared AND can
        # play -- the raw ``registration_role`` rows also count inactive/unranked
        # ones, which would send a single-role tank to the balancer as
        # ``isFullFlex``. Synthesized roles carry no ``is_primary`` and must not
        # veto an ``all_roles`` registrant who marked every declared role primary.
        # ``forced`` makes every role primary by contract, whether or not the rows
        # were rewritten since the form flipped to it.
        declared_playable = [entry for entry in entries if entry.is_playable and entry.role in from_row]
        playable_count = sum(1 for entry in entries if entry.is_playable)
        is_full_flex = (
            playable_count > 1
            if mode == "forced"
            else len(declared_playable) > 1 and all(entry.is_primary for entry in declared_playable)
        )

        member = reg.workspace_member
        player = member.player if member is not None else None
        primary = reg.primary_game_identity(provider=provider)
        return PlayerRoster(
            registration_id=reg.id,
            identity=PlayerIdentityRead.of(provider, primary.handle if primary is not None else None),
            display_name=reg.display_name,
            player_id=member.player_id if member is not None else None,
            auth_user_id=player.auth_user_id if player is not None else None,
            player_name=player.name if player is not None else None,
            workspace_member_id=reg.workspace_member_id,
            roles=tuple(entries),
            is_full_flex=is_full_flex,
            public_notes=reg.public_notes,
            admin_notes=reg.admin_notes,
            custom_fields=dict(reg.custom_fields_json or {}),
            status=reg.status,
            balancer_status=reg.balancer_status,
            exclude_reason=reg.exclude_reason,
            checked_in=bool(reg.checked_in),
            registration_team_id=reg.registration_team_id,
            team_slot_code=reg.team_slot_code,
            is_substitute=bool(reg.is_substitute),
            identities={identity.provider: identity.handle for identity in reg.identities if identity.position == 0},
            stream_pov=bool(reg.stream_pov),
            additional_handles=tuple(
                display_social_handle(provider, row.handle)
                for row in sorted(reg.identities, key=lambda row: row.position)
                if row.provider == provider and row.position > 0
            ),
        )

    # -- algorithm input -----------------------------------------------------

    def balancer_input(
        self,
        rosters: Iterable[PlayerRoster],
        *,
        key: str = "registration_id",
    ) -> dict[str, Any]:
        """The balancer algorithm's ``xv-1`` payload, built from the same rosters.

        ``key`` names the field the result's player uuids carry, so the caller can
        map a solved team back.
        """
        players: dict[str, Any] = {}
        for roster in rosters:
            if not roster.is_draftable:
                continue
            players[str(getattr(roster, key))] = {
                "identity": {
                    "name": _export_name(roster),
                    "isFullFlex": roster.is_full_flex,
                },
                "stats": {
                    "classes": {
                        entry.role: {
                            "isActive": True,
                            "rank": entry.rank,
                            "priority": entry.priority,
                            "subtype": workspace_sub_role_slug(entry.role, entry.subrole) if entry.subrole else None,
                        }
                        for entry in roster.playable
                    }
                },
            }
        return {"format": "xv-1", "players": players}

    # -- full snapshot -------------------------------------------------------

    def full_export(
        self,
        rosters: Iterable[PlayerRoster],
        *,
        shape: RosterShape,
        flex_role_mode: str,
        dimension: str,
        grid: DivisionGrid | None = None,
        source: Mapping[str, Any] | None = None,
        key: str = "registration_id",
        include_private: bool = False,
    ) -> dict[str, Any]:
        """``owt-1``: everything the roster projection knows, losslessly.

        A STRICT SUPERSET of :meth:`balancer_input`. Every player node still
        carries the ``xv-1`` ``identity``/``stats.classes`` pair verbatim, and
        ``player_loader.parse_player_node`` reads nothing else, so an ``owt-1``
        file uploads into the balance-job endpoint unchanged -- pinned by
        ``balancer-service/tests/test_owt_export_is_solver_input``.

        Two deliberate widenings over ``xv-1``:

        * declared-but-unranked roles are emitted with ``isActive: false``
          instead of being dropped, which is what makes the file answer "is this
          player ranked yet". The loader tests ``isActive`` BEFORE it compares
          the rank, so a ``null`` rank cannot reach its ``rank <= 0``.
        * ``roster`` carries the shape the run would use, flex slot included.
          The solver takes the flex mask from the tournament rather than the
          file, so without it an export cannot be replayed.
        """
        players: dict[str, Any] = {}
        for roster in rosters:
            primary = roster.primary
            owt: dict[str, Any] = {
                "registration_id": roster.registration_id,
                "identity": roster.identity.model_dump() if roster.identity is not None else None,
                "display_name": roster.display_name,
                "player_id": roster.player_id,
                "auth_user_id": roster.auth_user_id,
                "workspace_member_id": roster.workspace_member_id,
                "is_full_flex": roster.is_full_flex,
                # What a role-less (flex) slot is worth for this player -- the
                # same "best playable rank" the solver synthesizes for it.
                "flex_rating": roster.best_rank,
                "draftable": roster.is_draftable,
                "ranked_complete": roster.is_ranked_complete,
                "primary_role": RoleRef.of(dimension, primary.role, primary.subrole).model_dump()
                if primary is not None
                else None,
                "status": roster.status,
                "balancer_status": roster.balancer_status,
                "checked_in": roster.checked_in,
                "registration_team_id": roster.registration_team_id,
                "team_slot_code": roster.team_slot_code,
                "is_substitute": roster.is_substitute,
                "roles": [_role_export(entry, grid, dimension=dimension) for entry in roster.roles],
            }
            if include_private:
                owt["private"] = {
                    "public_notes": roster.public_notes,
                    "admin_notes": roster.admin_notes,
                    "exclude_reason": roster.exclude_reason,
                    "custom_fields": dict(roster.custom_fields),
                    "identities": dict(roster.identities),
                    "stream_pov": roster.stream_pov,
                    "additional_handles": list(roster.additional_handles),
                }
            players[str(getattr(roster, key))] = {
                "identity": {
                    "name": _export_name(roster),
                    "isFullFlex": roster.is_full_flex,
                },
                "stats": {
                    "classes": {
                        entry.role: {
                            "isActive": entry.is_playable,
                            "rank": entry.rank,
                            "priority": entry.priority,
                            "subtype": workspace_sub_role_slug(entry.role, entry.subrole) if entry.subrole else None,
                        }
                        for entry in roster.roles
                    }
                },
                "owt": owt,
            }
        return {
            "format": "owt-1",
            "generated_at": datetime.now(UTC).isoformat(),
            "source": {"player_key": key, **dict(source or {})},
            "roster": {
                "slots": shape.slots,
                "team_size": shape.team_size,
                "flex_slots": shape.flex_slots,
                "flex_role_mode": flex_role_mode,
            },
            "players": players,
        }


def _as_dict(entry: RosterRole) -> dict[str, Any]:
    return {
        "role": entry.role,
        "rank": entry.rank,
        "source": entry.source,
        "is_primary": entry.is_primary,
        "priority": entry.priority,
        "subrole": entry.subrole,
        "top_characters": entry.top_characters,
    }


def _export_name(roster: PlayerRoster) -> str:
    return roster.handle or roster.display_name or f"registration-{roster.registration_id}"


def _role_export(entry: RosterRole, grid: DivisionGrid | None, *, dimension: str) -> dict[str, Any]:
    # A tier-less grid is a legitimate workspace state (nobody configured one);
    # ``resolve_division`` raises on it, and a decorative label is never worth
    # failing the export for.
    resolvable = grid is not None and bool(grid.tiers) and entry.rank is not None
    tier = grid.resolve_division(entry.rank) if resolvable else None  # type: ignore[union-attr, arg-type]
    return {
        "role": RoleRef.of(dimension, entry.role, entry.subrole).model_dump(),
        "rank": entry.rank,
        "source": entry.source,
        "is_primary": entry.is_primary,
        "priority": entry.priority,
        "playable": entry.is_playable,
        "division": None if tier is None else {"number": tier.number, "name": tier.name},
        "top_characters": [character.wire() for character in entry.top_characters],
    }


roster_engine = RosterEngine()
