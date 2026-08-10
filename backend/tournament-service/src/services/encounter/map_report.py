"""Per-map result confirmation: two independent captain reports for ONE map
of a series, reconciled the moment both arrive. This is what the pick-ban
engine's progressive rounds wait on — closes the gap documented in
``docs/plans/2026-08-09-generic-pickban-engine.md`` §5.5/§5.6/Decision 9-10
(nothing else in the system reports "this map just finished" mid-series;
``EncounterCaptainReport`` only fires once, at series end).

Agreement -> upserts a ``matches.match`` row (``source=captain_report``),
increments ``Encounter.home_score``/``away_score`` (never touches
``result_status`` — that stays the exclusive job of
``captain.set_encounter_result``), marks the map's ``PickBanEntry`` `played`
in both the map and hero pick-ban sessions, and advances both to their next
round. Disagreement -> leaves both reports standing for an admin to resolve
(mirrors ``captain.set_encounter_result``'s own reconciliation, applied here
at map granularity instead of series granularity).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import MapPoolEntryStatus, MatchSource, PickBanKind
from shared.models.matches.match import Match
from shared.models.tournament.encounter import Encounter
from shared.models.tournament.encounter_report import EncounterMapReport
from shared.models.tournament.pick_ban import PickBanEntry
from shared.services import pick_ban_engine as engine
from src.services.encounter import pick_ban_session as pick_ban_session_service
from src.services.encounter.realtime_commit import register_map_veto_realtime_update


async def _get_match(session: AsyncSession, encounter_id: int, map_id: int) -> Match | None:
    result = await session.execute(
        select(Match).where(Match.encounter_id == encounter_id, Match.map_id == map_id)
    )
    return result.scalar_one_or_none()


async def submit_map_report(
    session: AsyncSession,
    encounter: Encounter,
    *,
    map_id: int,
    team_id: int,
    reporter_user_id: int | None,
    home_score: int,
    away_score: int,
) -> dict:
    """Upsert this captain's report for ``map_id``; reconcile if both sides
    have now reported. Returns
    ``{"disputed": bool, "resolved": bool, "match_id": int | None}``."""
    existing = await session.execute(
        select(EncounterMapReport).where(
            EncounterMapReport.encounter_id == encounter.id,
            EncounterMapReport.map_id == map_id,
            EncounterMapReport.team_id == team_id,
        )
    )
    row = existing.scalar_one_or_none()
    if row is None:
        row = EncounterMapReport(encounter_id=encounter.id, map_id=map_id, team_id=team_id)
        session.add(row)
    row.reporter_user_id = reporter_user_id
    row.home_score = home_score
    row.away_score = away_score
    await session.flush()

    other_team_id = (
        encounter.away_team_id if team_id == encounter.home_team_id else encounter.home_team_id
    )
    other_result = await session.execute(
        select(EncounterMapReport).where(
            EncounterMapReport.encounter_id == encounter.id,
            EncounterMapReport.map_id == map_id,
            EncounterMapReport.team_id == other_team_id,
        )
    )
    other_row = other_result.scalar_one_or_none()

    pair = engine.MapReportPair(
        home_report=(row.home_score, row.away_score) if team_id == encounter.home_team_id else (
            (other_row.home_score, other_row.away_score) if other_row else None
        ),
        away_report=(row.home_score, row.away_score) if team_id == encounter.away_team_id else (
            (other_row.home_score, other_row.away_score) if other_row else None
        ),
    )
    reconciliation = engine.reconcile_map_reports(pair)

    if reconciliation.resolved is None:
        await session.commit()
        return {"disputed": reconciliation.disputed, "resolved": False, "match_id": None}

    resolved_home, resolved_away = reconciliation.resolved
    map_pick_ban = await pick_ban_session_service.get_pick_ban_session(session, encounter.id, PickBanKind.MAP)
    entry = None
    if map_pick_ban is not None:
        map_entries = await session.execute(
            select(PickBanEntry).where(
                PickBanEntry.session_id == map_pick_ban.id,
                PickBanEntry.item_id == map_id,
                PickBanEntry.status != MapPoolEntryStatus.AVAILABLE.value,
            )
        )
        entry = map_entries.scalars().first()
    # `played` is the once-per-map transition, and the series score rides it:
    # a captain amending an already-agreed report (or any other re-entry) must
    # correct the map, never count it twice.
    already_played = entry is not None and entry.status == MapPoolEntryStatus.PLAYED.value

    match = await _get_match(session, encounter.id, map_id)
    if match is None:
        match = Match(
            encounter_id=encounter.id,
            map_id=map_id,
            home_team_id=encounter.home_team_id,
            away_team_id=encounter.away_team_id,
            home_score=resolved_home,
            away_score=resolved_away,
            time=None,
            log_name=None,
            source=MatchSource.CAPTAIN_REPORT.value,
        )
        session.add(match)
    else:
        # A log arrived first (or a re-report after a dispute correction):
        # never downgrade a real parsed log back to a captain claim, but do
        # let the captains' agreement correct a captain-report row.
        if match.source == MatchSource.CAPTAIN_REPORT.value:
            match.home_score = resolved_home
            match.away_score = resolved_away

    played_round: int | None = None
    if entry is not None:
        entry.status = MapPoolEntryStatus.PLAYED.value
        played_round = entry.round

    if not already_played:
        encounter.home_score = (encounter.home_score or 0) + (1 if resolved_home > resolved_away else 0)
        encounter.away_score = (encounter.away_score or 0) + (1 if resolved_away > resolved_home else 0)

    if played_round is not None and map_pick_ban is not None:
        # Only the MAP session advances here, and only while the series still
        # has a map to play: the next map's bans open on this result. That
        # map's HERO round opens later, once the map itself is picked --
        # `pick_ban_session.sync_hero_rounds`, because heroes are banned for a
        # known map, not for a map that is still being vetoed.
        winner = engine.winner_side(resolved_home, resolved_away)
        if not engine.series_decided(encounter.home_score or 0, encounter.away_score or 0, encounter.best_of):
            try:
                await pick_ban_session_service.advance_to_next_round(
                    session, map_pick_ban, completed_round=played_round, winner=winner, commit=False
                )
            except engine.RotationNeedsChoice:
                map_pick_ban.awaiting_choice = True
                map_pick_ban.pending_loser_side = "away" if winner == "home" else "home"
                await session.flush()

    register_map_veto_realtime_update(session, encounter.id)
    register_map_veto_realtime_update(session, encounter.id, kind=PickBanKind.HERO.value)
    await session.commit()
    return {"disputed": False, "resolved": True, "match_id": match.id}
