"""Team registration flows: create, invite, accept, and roster edits.

See ``docs/plans/2026-08-20-team-registration.md`` §4. Three properties shape
every function here.

**One registration per player, always.** A team member's registration is an
ordinary :class:`BalancerRegistration` row with three extra columns set, so every
existing gate (self-register capability, subscription, open profile, verified
identity), every count and every reader keeps working untouched. That is why the
captain and invitee flows delegate to
:func:`~src.services.registration.service.submit_public_registration` rather than
writing rows themselves.

**The slot check and the slot write are one transaction.** Every mutating flow
takes ``SELECT … FOR UPDATE`` on the team row *before* reading occupancy, and the
write lands before that lock is released. Without it two invitees accept the last
``dps`` slot and the roster silently overflows the shape, which the export would
then materialize as an over-sized team. Each flow locks exactly one team row, so
no lock-ordering discipline is needed.

**A dead invite must say why it is dead.** §3.3's guarded ``UPDATE`` collapses
expired / revoked / already-accepted into one rowcount 0. §12.1 requires a distinct
machine code per case, so :func:`_diagnose_dead_invite` re-reads the row *for
reporting only* — after the guard has already decided, where it cannot reintroduce
the race.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import ApiExc, ApiHTTPException
from shared.domain.invite_token import generate_invite_token, hash_invite_token
from shared.domain.roster_shape import RosterShape, RosterShapeError, resolve_roster_shape
from shared.domain.team_roster import RosterMember, RosterOccupancy
from shared.services.roster_shape_access import get_tournament_roster_slots, get_workspace_roster_slots
from src import models
from src.schemas.registration import RegistrationCreate, RegistrationRead
from src.schemas.registration_team import (
    RegistrationTeamMemberRead,
    RegistrationTeamRead,
    serialize_invite,
    serialize_registration_team,
)
from src.services.registration.service import (
    TeamPlacement,
    get_registration,
    submit_public_registration,
)
from src.services.registration.team_rate_limits import (
    TEAM_INVITE_TOTAL_CAP,
    assert_accept_attempt_allowed,
    assert_invite_attempt_allowed,
)
from src.services.registration.windows import is_registration_open
from src.services.tournament.realtime_commit import register_tournament_realtime_update

__all__ = (
    "DEFAULT_INVITE_TTL",
    "TEAM_STATUSES",
    "accept_invite",
    "count_unassigned_players",
    "create_team",
    "decline_invite",
    "disband_team",
    "invite_member",
    "kick_member",
    "leave_team",
    "list_teams",
    "reject_team",
    "revoke_invite",
    "transfer_captaincy",
)

# ── vocabularies ─────────────────────────────────────────────────────────────

TEAM_FORMING = "forming"
TEAM_COMPLETE = "complete"
TEAM_REJECTED = "rejected"
TEAM_DISBANDED = "disbanded"
TEAM_STATUSES = (TEAM_FORMING, TEAM_COMPLETE, TEAM_REJECTED, TEAM_DISBANDED)
#: Statuses whose roster may still change. ``rejected``/``disbanded`` are terminal,
#: and an exported team is frozen by ``exported_team_id`` rather than by status —
#: its shape is already baked into ``tournament.player`` rows.
_MUTABLE_TEAM_STATUSES = frozenset({TEAM_FORMING, TEAM_COMPLETE})

INVITE_PENDING = "pending"
INVITE_ACCEPTED = "accepted"
INVITE_DECLINED = "declined"
INVITE_REVOKED = "revoked"

DEFAULT_INVITE_TTL = timedelta(days=7)

#: Statuses that release a roster slot. A withdrawn member frees their slot for a
#: replacement (decision 12); a rejected registration was never on the roster.
_SLOT_RELEASING_STATUSES = frozenset({"withdrawn", "rejected"})


def _fail(status_code: int, code: str, msg: str) -> ApiHTTPException:
    """Build a rejection carrying a stable machine code.

    §12.2: these surfaces are public and Russian-first, so the frontend maps
    ``code`` to a translated string. A bare ``detail`` string would be rendered
    verbatim in English.
    """
    return ApiHTTPException(status_code=status_code, detail=[ApiExc(msg=msg, code=code)])


# ── loading ──────────────────────────────────────────────────────────────────


async def _lock_team(session: AsyncSession, team_id: int) -> models.BalancerRegistrationTeam:
    """Load a team holding its row lock, or reject.

    The lock is the serialization point for every roster decision below; taking it
    before reading occupancy is what stops two acceptances from overfilling one
    slot.
    """
    team = await session.scalar(
        sa.select(models.BalancerRegistrationTeam)
        .where(
            models.BalancerRegistrationTeam.id == team_id,
            models.BalancerRegistrationTeam.deleted_at.is_(None),
        )
        .with_for_update()
    )
    if team is None:
        raise _fail(404, "team_not_found", "Team not found")
    return team


def _assert_mutable(team: models.BalancerRegistrationTeam) -> None:
    if team.exported_team_id is not None:
        raise _fail(409, "team_already_exported", "This team has already been exported to the tournament")
    if team.status not in _MUTABLE_TEAM_STATUSES:
        raise _fail(409, "team_not_forming", f"This team is {team.status} and can no longer be changed")


async def _assert_registration_open(session: AsyncSession, tournament_id: int) -> models.Tournament:
    tournament = await session.get(models.Tournament, tournament_id)
    if tournament is None:
        raise _fail(404, "tournament_not_found", "Tournament not found")
    if not is_registration_open(tournament):
        raise _fail(400, "registration_closed", "Registration is not open for this tournament")
    return tournament


async def _resolve_shape(session: AsyncSession, tournament: models.Tournament) -> RosterShape:
    """The tournament's roster shape, through the same cache-backed getters the
    admin read path uses — so the roster a captain fills is the roster the export
    will check."""
    tournament_slots = await get_tournament_roster_slots(session, tournament.id)
    workspace_slots = await get_workspace_roster_slots(session, tournament.workspace_id)
    return resolve_roster_shape(tournament_slots, workspace_slots)


async def _max_substitutes(session: AsyncSession, tournament_id: int) -> int:
    return (
        await session.scalar(
            sa.select(models.BalancerRegistrationForm.max_substitutes).where(
                models.BalancerRegistrationForm.tournament_id == tournament_id
            )
        )
        or 0
    )


async def _roster_members(session: AsyncSession, team_id: int) -> list[models.BalancerRegistration]:
    result = await session.scalars(
        sa.select(models.BalancerRegistration).where(
            models.BalancerRegistration.registration_team_id == team_id,
            models.BalancerRegistration.deleted_at.is_(None),
            models.BalancerRegistration.status.notin_(_SLOT_RELEASING_STATUSES),
        )
    )
    return list(result)


async def _pending_invites(session: AsyncSession, team_id: int) -> list[models.BalancerRegistrationTeamInvite]:
    """Live invites only: an expired one reserves nothing, so its slot is
    offerable again without an explicit revoke."""
    result = await session.scalars(
        sa.select(models.BalancerRegistrationTeamInvite).where(
            models.BalancerRegistrationTeamInvite.team_id == team_id,
            models.BalancerRegistrationTeamInvite.state == INVITE_PENDING,
            sa.or_(
                models.BalancerRegistrationTeamInvite.expires_at.is_(None),
                models.BalancerRegistrationTeamInvite.expires_at > sa.func.now(),
            ),
        )
    )
    return list(result)


async def _occupancy(
    session: AsyncSession,
    team: models.BalancerRegistrationTeam,
    shape: RosterShape,
    *,
    max_substitutes: int,
    extra: RosterMember | None = None,
) -> RosterOccupancy:
    """Current slot occupancy, optionally including one not-yet-written member.

    ``extra`` is how a flow projects the roster *after* the write it is about to
    make, so the team's denormalized ``status`` can be set under the same lock
    rather than in a follow-up transaction where it could drift.
    """
    members = await _roster_members(session, team.id)
    accepted = [
        RosterMember(slot_code=m.team_slot_code or "", is_substitute=bool(m.is_substitute))
        for m in members
        if m.team_slot_code
    ]
    if extra is not None:
        accepted.append(extra)
    invites = await _pending_invites(session, team.id)
    return RosterOccupancy(
        shape=shape,
        accepted=tuple(accepted),
        pending=tuple(RosterMember(slot_code=i.slot_code, is_substitute=bool(i.is_substitute)) for i in invites),
        max_substitutes=max_substitutes,
    )


def _status_for(occupancy: RosterOccupancy) -> str:
    return TEAM_COMPLETE if occupancy.is_complete else TEAM_FORMING


def _check_slot(occupancy: RosterOccupancy, slot_code: str, *, is_substitute: bool, offering: bool) -> None:
    """Raise the right machine code for a slot that cannot take one more body."""
    try:
        allowed = (
            occupancy.can_offer(slot_code, is_substitute=is_substitute)
            if offering
            else occupancy.can_accept(slot_code, is_substitute=is_substitute)
        )
    except RosterShapeError as exc:
        # ``slot_not_in_shape``/``roster_slots_unknown_code`` — a client asking for
        # a slot this tournament's roster does not have. A 400, not a 409: nothing
        # about the team's state would make it succeed later.
        raise _fail(400, exc.code, str(exc)) from exc
    if allowed:
        return
    if is_substitute:
        raise _fail(409, "bench_full", "This team has no substitute places left")
    raise _fail(
        409,
        "slot_taken" if not offering else "slot_already_offered",
        f"The {slot_code} slot is not available on this team",
    )


# ── captain flows ────────────────────────────────────────────────────────────


async def create_team(
    session: AsyncSession,
    *,
    tournament_id: int,
    auth_user: models.AuthUser,
    name: str,
    slot_code: str,
    body: RegistrationCreate,
) -> tuple[models.BalancerRegistrationTeam, RegistrationRead]:
    """Register a new team, with the caller as captain occupying one slot.

    The captain is a member like any other — decision 5: they take a real slot and
    their own registration goes through the same validation as a solo entrant. One
    transaction, so a team can never exist without its captain's registration.
    """
    cleaned_name = name.strip()
    if not cleaned_name:
        raise _fail(400, "team_name_required", "A team needs a name")
    if "#" in cleaned_name:
        # The materialization seam derives ``Team.name`` as everything before the
        # first "#" (the battle-tag convention the balancer/draft payloads use), so
        # a name containing one would be silently truncated on export — and the
        # exported_team_id backfill, keyed on the full name, would then miss.
        raise _fail(400, "team_name_invalid", 'A team name cannot contain "#"')

    tournament = await _assert_registration_open(session, tournament_id)
    shape = await _resolve_shape(session, tournament)
    max_substitutes = await _max_substitutes(session, tournament_id)

    team = models.BalancerRegistrationTeam(
        tournament_id=tournament_id,
        workspace_id=tournament.workspace_id,
        name=cleaned_name,
        name_normalized=cleaned_name.lower(),
        status=TEAM_FORMING,
    )
    session.add(team)
    try:
        await session.flush()
    except IntegrityError as exc:
        # The partial unique index on (tournament_id, lower(name)) — decision 10,
        # mirroring the export writer's dedup rule so a silent two-teams-into-one
        # merge is impossible.
        raise _fail(409, "team_name_taken", "A team with this name is already registered") from exc

    # An empty roster: the captain's own slot must exist in the shape, and this is
    # the check that rejects e.g. "tank" on a role-less tournament.
    occupancy = await _occupancy(session, team, shape, max_substitutes=max_substitutes)
    _check_slot(occupancy, slot_code, is_substitute=False, offering=False)

    read = await submit_public_registration(
        session,
        tournament_id=tournament_id,
        auth_user=auth_user,
        body=body,
        team_placement=TeamPlacement(registration_team_id=team.id, slot_code=slot_code),
        commit=False,
    )
    team.captain_registration_id = read.id
    team.status = _status_for(
        await _occupancy(
            session,
            team,
            shape,
            max_substitutes=max_substitutes,
        )
    )
    register_tournament_realtime_update(session, tournament_id, "registration_changed")
    try:
        await session.commit()
    except IntegrityError as exc:
        # ``commit=False`` moved the duplicate-registration and duplicate-name
        # races out of the submit helper's own ``try``, so they surface here.
        raise _fail(409, "already_registered", "You are already registered for this tournament") from exc
    return team, read


def _owned_by(auth_user_id: int) -> sa.ColumnElement[bool]:
    """Is this registration owned by that account?

    ``workspace_member`` carries no ``auth_user_id`` — identity runs through
    ``player_id`` (``dbarch02`` dropped the direct column), so the chain is
    member -> player -> auth user. Same predicate ``get_registration`` uses;
    spelled once here so the team flows cannot drift from it.
    """
    return models.BalancerRegistration.workspace_member.has(
        models.WorkspaceMember.player.has(models.User.auth_user_id == auth_user_id)
    )


async def _assert_captain(
    session: AsyncSession,
    team: models.BalancerRegistrationTeam,
    auth_user: models.AuthUser,
) -> None:
    """Only the captain edits a roster.

    A team whose ``captain_registration_id`` is NULL is structurally broken (the
    captain's registration was hard-deleted); deny every mutation rather than
    letting any member take over, and leave it to the organizer to reject.
    """
    if team.captain_registration_id is None:
        raise _fail(409, "team_has_no_captain", "This team has no captain and must be handled by an organizer")
    is_captain = await session.scalar(
        sa.select(models.BalancerRegistration.id).where(
            models.BalancerRegistration.id == team.captain_registration_id,
            _owned_by(auth_user.id),
        )
    )
    if is_captain is None:
        raise _fail(403, "not_captain", "Only the team captain can do this")


async def invite_member(
    session: AsyncSession,
    *,
    team_id: int,
    auth_user: models.AuthUser,
    slot_code: str,
    is_substitute: bool = False,
    target_auth_user_id: int | None = None,
    ttl: timedelta | None = DEFAULT_INVITE_TTL,
) -> tuple[models.BalancerRegistrationTeamInvite, str | None]:
    """Offer one roster slot. Returns the invite and, for a link invite, the raw
    token — which is shown exactly once and never stored.

    Decision 3: two addressing modes on one entity. ``target_auth_user_id`` is an
    in-app offer to a known account; without it the invite is a shareable link for
    someone who has no account yet.
    """
    # Metered BEFORE the row lock: a limiter behind the lock would let a flood
    # serialize on the team row and hold it, turning the throttle into a
    # lock-contention amplifier.
    team = await session.scalar(
        sa.select(models.BalancerRegistrationTeam).where(
            models.BalancerRegistrationTeam.id == team_id,
            models.BalancerRegistrationTeam.deleted_at.is_(None),
        )
    )
    if team is None:
        raise _fail(404, "team_not_found", "Team not found")
    await assert_invite_attempt_allowed(tournament_id=team.tournament_id, auth_user_id=auth_user.id)

    team = await _lock_team(session, team_id)
    _assert_mutable(team)
    tournament = await _assert_registration_open(session, team.tournament_id)
    await _assert_captain(session, team, auth_user)

    # §7 control 2: the slot reservation caps *concurrent* pending invites, but an
    # invite -> revoke -> invite loop stays inside every slot rule. This cumulative
    # ceiling counts every invite ever created for the team, so the loop ends.
    issued = await session.scalar(
        sa.select(sa.func.count(models.BalancerRegistrationTeamInvite.id)).where(
            models.BalancerRegistrationTeamInvite.team_id == team.id
        )
    )
    if (issued or 0) >= TEAM_INVITE_TOTAL_CAP:
        raise _fail(
            409,
            "invite_cap_reached",
            "This team has issued too many invites; an organizer must intervene",
        )

    shape = await _resolve_shape(session, tournament)
    occupancy = await _occupancy(
        session, team, shape, max_substitutes=await _max_substitutes(session, team.tournament_id)
    )
    # ``offering=True``: a pending invite reserves its slot, so a captain cannot
    # hold ten open offers for one place.
    _check_slot(occupancy, slot_code, is_substitute=is_substitute, offering=True)

    raw_token: str | None = None
    token_hash: str | None = None
    if target_auth_user_id is None:
        raw_token, token_hash = generate_invite_token()

    invite = models.BalancerRegistrationTeamInvite(
        team_id=team.id,
        slot_code=slot_code,
        is_substitute=is_substitute,
        target_auth_user_id=target_auth_user_id,
        token_sha256=token_hash,
        expires_at=datetime.now(UTC) + ttl if ttl is not None else None,
        state=INVITE_PENDING,
        invited_by=auth_user.id,
    )
    session.add(invite)
    await session.commit()
    return invite, raw_token


async def revoke_invite(
    session: AsyncSession,
    *,
    invite_id: int,
    auth_user: models.AuthUser,
) -> None:
    """Withdraw an outstanding offer, releasing its reserved slot."""
    invite = await session.get(models.BalancerRegistrationTeamInvite, invite_id)
    if invite is None:
        raise _fail(404, "invite_not_found", "Invite not found")
    team = await _lock_team(session, invite.team_id)
    await _assert_captain(session, team, auth_user)
    if invite.state != INVITE_PENDING:
        raise _diagnose_dead_invite(invite)
    invite.state = INVITE_REVOKED
    await session.commit()


# ── invitee flows ────────────────────────────────────────────────────────────


def _diagnose_dead_invite(invite: models.BalancerRegistrationTeamInvite) -> ApiHTTPException:
    """Turn a rowcount-0 guard result into a distinct machine code (§12.1).

    Called only *after* the guarded ``UPDATE`` has already decided, so this read
    cannot reintroduce the race it is explaining. Four situations with four
    different recourses would otherwise collapse into one opaque failure.
    """
    if invite.state == INVITE_ACCEPTED:
        return _fail(409, "invite_already_accepted", "This invite has already been accepted")
    if invite.state == INVITE_REVOKED:
        return _fail(409, "invite_revoked", "This invite was withdrawn by the captain")
    if invite.state == INVITE_DECLINED:
        return _fail(409, "invite_declined", "This invite was already declined")
    expires_at = invite.expires_at
    if expires_at is not None and expires_at <= datetime.now(UTC):
        return _fail(409, "invite_expired", "This invite has expired — ask the captain for a new one")
    # Pending, unexpired, and still rejected by the guard: the only remaining
    # explanation is a concurrent acceptance that committed between the guard and
    # this read.
    return _fail(409, "invite_already_accepted", "This invite has already been accepted")


async def _resolve_invite(
    session: AsyncSession,
    *,
    auth_user: models.AuthUser,
    token: str | None,
    invite_id: int | None,
) -> models.BalancerRegistrationTeamInvite:
    """Find the invite being redeemed, by token or by id.

    Token lookup is by *hash*, which the partial unique index serves as a single
    indexed read — the raw value is never compared against anything stored.
    """
    if token is not None:
        invite = await session.scalar(
            sa.select(models.BalancerRegistrationTeamInvite).where(
                models.BalancerRegistrationTeamInvite.token_sha256 == hash_invite_token(token)
            )
        )
    elif invite_id is not None:
        invite = await session.get(models.BalancerRegistrationTeamInvite, invite_id)
    else:
        raise _fail(400, "invite_reference_required", "An invite id or token is required")
    if invite is None:
        raise _fail(404, "invite_not_found", "Invite not found")
    # A targeted invite is addressed to one account; a link invite is bearer.
    if invite.target_auth_user_id is not None and invite.target_auth_user_id != auth_user.id:
        raise _fail(403, "invite_not_for_you", "This invite was sent to a different account")
    return invite


async def accept_invite(
    session: AsyncSession,
    *,
    auth_user: models.AuthUser,
    body: RegistrationCreate,
    token: str | None = None,
    invite_id: int | None = None,
) -> tuple[models.BalancerRegistrationTeam, int]:
    """Redeem an invite: take the offered slot, registering if necessary.

    Returns the team and the id of the registration now holding the slot.

    Everything below happens in one transaction while holding the team's row lock,
    which is what makes the slot check binding. Ordering matters: every rejection
    that can be known up front is raised *before* the invite is consumed, so a
    failed acceptance never burns the invite.

    ``body`` is used ONLY when the redeemer has no registration yet. An existing
    one is attached to the team instead — see the comment at the write below.
    """
    # Metered before the token lookup, so a guessing flood is throttled without
    # even reaching the index. Fails OPEN: 256 bits of entropy already make
    # guessing infeasible, so this is defence in depth, not the defence.
    await assert_accept_attempt_allowed(auth_user_id=auth_user.id)

    invite = await _resolve_invite(session, auth_user=auth_user, token=token, invite_id=invite_id)
    team = await _lock_team(session, invite.team_id)
    _assert_mutable(team)
    tournament = await _assert_registration_open(session, team.tournament_id)
    shape = await _resolve_shape(session, tournament)
    max_substitutes = await _max_substitutes(session, team.tournament_id)

    occupancy = await _occupancy(session, team, shape, max_substitutes=max_substitutes)
    # ``offering=False``: this invite must not block its own acceptance.
    _check_slot(occupancy, invite.slot_code, is_substitute=bool(invite.is_substitute), offering=False)

    # §3.3's guard: state and expiry are checked *in the UPDATE*, so two
    # simultaneous redemptions of one link cannot both win.
    consumed = await session.execute(
        sa.update(models.BalancerRegistrationTeamInvite)
        .where(
            models.BalancerRegistrationTeamInvite.id == invite.id,
            models.BalancerRegistrationTeamInvite.state == INVITE_PENDING,
            sa.or_(
                models.BalancerRegistrationTeamInvite.expires_at.is_(None),
                models.BalancerRegistrationTeamInvite.expires_at > sa.func.now(),
            ),
        )
        .values(state=INVITE_ACCEPTED, accepted_at=datetime.now(UTC))
        .returning(models.BalancerRegistrationTeamInvite.id)
    )
    if consumed.first() is None:
        await session.refresh(invite)
        raise _diagnose_dead_invite(invite)

    # A player who already registered solo is a FREE AGENT, not a duplicate.
    #
    # There is exactly one registration row per player per tournament (the partial
    # unique index guarantees it), so "solo registration" and "team registration"
    # are the same row in two states. Accepting an invite therefore *attaches* the
    # existing row to the team rather than creating a second one — which the index
    # would reject anyway, and which `submit_public_registration` used to turn into
    # an `already_registered` 409. That 409 left a solo registrant permanently
    # unable to join any team: withdrawal is final, so there was no way out.
    #
    # The submitted ``body`` is deliberately IGNORED on this path: the player
    # already answered the form, and the only thing the invite decides is which
    # slot they occupy. Their recorded roles and ranks stand.
    existing = await get_registration(session, team.tournament_id, auth_user.id)
    if existing is not None:
        if existing.status in _SLOT_RELEASING_STATUSES:
            # Withdrawn or rejected. Reviving it here would smuggle a re-entry past
            # the rule that withdrawal is final, which exists because a withdrawal
            # after check-in invalidates a composed roster.
            raise _fail(
                409,
                "registration_terminal",
                "Your registration for this tournament is no longer active",
            )
        existing.registration_team_id = team.id
        existing.team_slot_code = invite.slot_code
        existing.is_substitute = bool(invite.is_substitute)
        await session.flush()
        registration_id = existing.id
    else:
        read = await submit_public_registration(
            session,
            tournament_id=team.tournament_id,
            auth_user=auth_user,
            body=body,
            team_placement=TeamPlacement(
                registration_team_id=team.id,
                slot_code=invite.slot_code,
                is_substitute=bool(invite.is_substitute),
            ),
            commit=False,
        )
        registration_id = read.id
    invite.accepted_registration_id = registration_id
    # Projected, not re-read: the new member's row is already flushed, but
    # computing the post-write status here keeps it inside the lock.
    team.status = _status_for(
        await _occupancy(session, team, shape, max_substitutes=max_substitutes),
    )
    register_tournament_realtime_update(session, team.tournament_id, "registration_changed")
    try:
        await session.commit()
    except IntegrityError as exc:
        raise _fail(409, "already_registered", "You are already registered for this tournament") from exc
    return team, registration_id


async def decline_invite(
    session: AsyncSession,
    *,
    auth_user: models.AuthUser,
    token: str | None = None,
    invite_id: int | None = None,
) -> None:
    """Refuse an offer, releasing its reserved slot back to the captain."""
    invite = await _resolve_invite(session, auth_user=auth_user, token=token, invite_id=invite_id)
    if invite.state != INVITE_PENDING:
        raise _diagnose_dead_invite(invite)
    invite.state = INVITE_DECLINED
    await session.commit()


# ── roster edits ─────────────────────────────────────────────────────────────


async def _release_member(
    session: AsyncSession,
    team: models.BalancerRegistrationTeam,
    registration: models.BalancerRegistration,
    shape: RosterShape,
    *,
    max_substitutes: int,
) -> None:
    """Detach a member from the roster and recompute the team's status.

    The registration itself is *withdrawn*, not deleted: it is a real person's
    real entry, and the admin registration table plus the audit trail both expect
    it to survive. Clearing the three team columns is what frees the slot.
    """
    registration.status = "withdrawn"
    registration.registration_team_id = None
    registration.team_slot_code = None
    registration.is_substitute = False
    await session.flush()
    team.status = _status_for(await _occupancy(session, team, shape, max_substitutes=max_substitutes))
    register_tournament_realtime_update(session, team.tournament_id, "registration_changed")


async def kick_member(
    session: AsyncSession,
    *,
    team_id: int,
    registration_id: int,
    auth_user: models.AuthUser,
) -> None:
    """Captain removes an accepted member; the vacated slot returns to open."""
    team = await _lock_team(session, team_id)
    _assert_mutable(team)
    tournament = await _assert_registration_open(session, team.tournament_id)
    await _assert_captain(session, team, auth_user)

    if registration_id == team.captain_registration_id:
        raise _fail(409, "cannot_kick_captain", "A captain cannot remove themselves; transfer or disband instead")
    registration = await session.get(models.BalancerRegistration, registration_id)
    if registration is None or registration.registration_team_id != team.id:
        raise _fail(404, "member_not_found", "This player is not on the team")

    shape = await _resolve_shape(session, tournament)
    await _release_member(
        session,
        team,
        registration,
        shape,
        max_substitutes=await _max_substitutes(session, team.tournament_id),
    )
    await session.commit()


async def leave_team(
    session: AsyncSession,
    *,
    team_id: int,
    auth_user: models.AuthUser,
) -> None:
    """A member withdraws themselves. Symmetric with :func:`kick_member` by
    decision 12 — but a captain must transfer or disband, never silently vanish
    from a team other people have already joined."""
    team = await _lock_team(session, team_id)
    _assert_mutable(team)
    tournament = await _assert_registration_open(session, team.tournament_id)

    registration = await session.scalar(
        sa.select(models.BalancerRegistration).where(
            models.BalancerRegistration.registration_team_id == team.id,
            _owned_by(auth_user.id),
        )
    )
    if registration is None:
        raise _fail(404, "member_not_found", "You are not on this team")
    if registration.id == team.captain_registration_id:
        raise _fail(409, "captain_must_transfer", "Transfer captaincy or disband the team instead")

    shape = await _resolve_shape(session, tournament)
    await _release_member(
        session,
        team,
        registration,
        shape,
        max_substitutes=await _max_substitutes(session, team.tournament_id),
    )
    await session.commit()


async def transfer_captaincy(
    session: AsyncSession,
    *,
    team_id: int,
    registration_id: int,
    auth_user: models.AuthUser,
) -> None:
    """Hand captaincy to another accepted member. Rosters are unchanged."""
    team = await _lock_team(session, team_id)
    _assert_mutable(team)
    await _assert_registration_open(session, team.tournament_id)
    await _assert_captain(session, team, auth_user)

    successor = await session.get(models.BalancerRegistration, registration_id)
    if successor is None or successor.registration_team_id != team.id:
        raise _fail(404, "member_not_found", "This player is not on the team")
    if successor.is_substitute:
        # A bench player holds no starter slot, so making them captain would leave
        # the roster with a captain outside its own shape.
        raise _fail(409, "captain_must_be_starter", "A substitute cannot captain the team")
    team.captain_registration_id = successor.id
    await session.commit()


async def disband_team(
    session: AsyncSession,
    *,
    team_id: int,
    auth_user: models.AuthUser,
) -> None:
    """Captain dissolves the team.

    Members' registrations survive as withdrawn rows — decision from step 3, and
    the reason the captain FK is ``SET NULL`` rather than a cascade: a captain
    walking away must not delete other people's entries.
    """
    team = await _lock_team(session, team_id)
    _assert_mutable(team)
    await _assert_registration_open(session, team.tournament_id)
    await _assert_captain(session, team, auth_user)

    # Only the STATUS changes: the team link is retained deliberately.
    #
    # Clearing it (as ``kick_member``/``leave_team`` correctly do) would leave the
    # member with a withdrawn registration and no explanation — §12.5's exact dead
    # end, since the "your team was disbanded" line on their own card is derived
    # from this FK. Keeping it costs nothing: ``_roster_members`` filters withdrawn
    # rows out, so slot accounting and the export are unaffected.
    #
    # The distinction is meaningful: kick/leave means "you are not on this team",
    # disband/reject means "this team ended".
    for registration in await _roster_members(session, team.id):
        registration.status = "withdrawn"
    await session.execute(
        sa.update(models.BalancerRegistrationTeamInvite)
        .where(
            models.BalancerRegistrationTeamInvite.team_id == team.id,
            models.BalancerRegistrationTeamInvite.state == INVITE_PENDING,
        )
        .values(state=INVITE_REVOKED)
    )
    team.status = TEAM_DISBANDED
    team.deleted_at = datetime.now(UTC)
    team.deleted_by = auth_user.id
    register_tournament_realtime_update(session, team.tournament_id, "registration_changed")
    await session.commit()


# ── organizer flows ──────────────────────────────────────────────────────────


async def count_unassigned_players(session: AsyncSession, tournament_id: int) -> int:
    """Live registrations belonging to no team — the free agents.

    These are invisible to the export: it materializes registered teams, and on a
    team-registration tournament neither the balancer nor the draft runs. So an
    approved player nobody invited silently never becomes a ``tournament.player``.
    Surfacing the count is what lets an organizer notice them BEFORE pressing
    export, which is the only moment it is still cheap to fix.

    Withdrawn and rejected rows are excluded on the same rule the roster reader
    uses: they released their slot and are not waiting for anything.
    """
    return (
        await session.scalar(
            sa.select(sa.func.count(models.BalancerRegistration.id)).where(
                models.BalancerRegistration.tournament_id == tournament_id,
                models.BalancerRegistration.registration_team_id.is_(None),
                models.BalancerRegistration.deleted_at.is_(None),
                models.BalancerRegistration.status.notin_(_SLOT_RELEASING_STATUSES),
            )
        )
    ) or 0


async def list_teams(
    session: AsyncSession,
    *,
    tournament_id: int,
    include_terminal: bool = False,
) -> list[tuple[models.BalancerRegistrationTeam, RosterOccupancy]]:
    """Every registered team with its live occupancy — the organizer's answer to
    "who is incomplete, and what are they missing?" (§8).

    Occupancy is recomputed rather than read off ``status``: the denormalized
    column answers "complete?" for indexed filtering, but the organizer needs the
    per-slot shortfall, which only the shape comparison produces.
    """
    tournament = await session.get(models.Tournament, tournament_id)
    if tournament is None:
        raise _fail(404, "tournament_not_found", "Tournament not found")
    shape = await _resolve_shape(session, tournament)
    max_substitutes = await _max_substitutes(session, tournament_id)

    conditions = [models.BalancerRegistrationTeam.tournament_id == tournament_id]
    if not include_terminal:
        conditions.append(models.BalancerRegistrationTeam.deleted_at.is_(None))
        conditions.append(models.BalancerRegistrationTeam.status.in_(sorted(_MUTABLE_TEAM_STATUSES)))
    result = await session.scalars(
        sa.select(models.BalancerRegistrationTeam)
        .where(*conditions)
        .order_by(models.BalancerRegistrationTeam.name_normalized)
    )
    return [(team, await _occupancy(session, team, shape, max_substitutes=max_substitutes)) for team in list(result)]


async def reject_team(
    session: AsyncSession,
    *,
    tournament_id: int,
    team_id: int,
    auth_user: models.AuthUser,
    withdraw_members: bool = True,
) -> models.BalancerRegistrationTeam:
    """Organizer refuses a team — the counterpart of rejecting a registration.

    ``tournament_id`` is required and asserted, not decorative: the caller's
    permission was checked against *that* tournament's workspace, so accepting a
    ``team_id`` from any other tournament would let an organizer of one event
    reject teams in another.

    ``withdraw_members`` defaults to True because leaving the members' rows
    approved is the §12.5 dead end: a player holding a live registration for a
    tournament they cannot play in, with nothing on their card explaining why.
    Passing False keeps them in the solo pool, which is the right call when the
    team is rejected for being incomplete rather than unwelcome.
    """
    team = await _lock_team(session, team_id)
    if team.tournament_id != tournament_id:
        # Deliberately 404, not 403: confirming the team exists elsewhere would
        # leak roster membership across workspaces.
        raise _fail(404, "team_not_found", "Team not found")
    if team.exported_team_id is not None:
        raise _fail(409, "team_already_exported", "This team has already been exported to the tournament")
    if team.status in (TEAM_REJECTED, TEAM_DISBANDED):
        raise _fail(409, "team_not_forming", f"This team is already {team.status}")

    for registration in await _roster_members(session, team.id):
        if withdraw_members:
            registration.status = "withdrawn"
        else:
            # Returning to the solo pool DOES mean leaving the team, so here the
            # link is cleared. When members are withdrawn it is retained, so their
            # own card can say the team was rejected rather than leaving them with
            # an unexplained withdrawal (§12.5).
            registration.registration_team_id = None
            registration.team_slot_code = None
            registration.is_substitute = False
    await session.execute(
        sa.update(models.BalancerRegistrationTeamInvite)
        .where(
            models.BalancerRegistrationTeamInvite.team_id == team.id,
            models.BalancerRegistrationTeamInvite.state == INVITE_PENDING,
        )
        .values(state=INVITE_REVOKED)
    )
    team.status = TEAM_REJECTED
    team.deleted_at = datetime.now(UTC)
    team.deleted_by = auth_user.id
    register_tournament_realtime_update(session, team.tournament_id, "registration_changed")
    await session.commit()
    return team


# ── read models ──────────────────────────────────────────────────────────────


async def describe_team(
    session: AsyncSession,
    team: models.BalancerRegistrationTeam,
    *,
    include_invites: bool = False,
) -> RegistrationTeamRead:
    """Serialize a team with its live occupancy.

    ``include_invites`` is off by default because a public roster must not leak who
    has been asked and declined; only the captain's own view and the organizer's
    pass True.
    """
    tournament = await session.get(models.Tournament, team.tournament_id)
    if tournament is None:
        raise _fail(404, "tournament_not_found", "Tournament not found")
    shape = await _resolve_shape(session, tournament)
    max_substitutes = await _max_substitutes(session, team.tournament_id)
    occupancy = await _occupancy(session, team, shape, max_substitutes=max_substitutes)

    members = [
        RegistrationTeamMemberRead(
            registration_id=registration.id,
            display_name=registration.display_name,
            battle_tag=registration.battle_tag,
            slot_code=registration.team_slot_code,
            is_substitute=bool(registration.is_substitute),
            is_captain=registration.id == team.captain_registration_id,
            status=registration.status,
        )
        for registration in await _roster_members(session, team.id)
    ]
    invites = (
        [serialize_invite(invite) for invite in await _pending_invites(session, team.id)] if include_invites else []
    )
    return serialize_registration_team(team, occupancy, members=members, invites=invites)
