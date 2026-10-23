"""``derive_match`` reproduces P4's frozen impact outputs exactly (``fixtures/stats_derived_parity.json``).

The native parity database holds the legacy matches whose backfill outputs are frozen in the golden. Each match is read
back as the document the decoder would have produced (raw and event-count facts, observed roles, a kill), bound with the
roster ranks the backfill read, and derived against the real active baselines. The three baseline-dependent codes must
equal the golden's ``objects`` bit for bit, under the exact/type/signed-zero/canonical-reduction contract of
``test_stats_derived_parity`` (same ``_canonical_expected`` witness; no new tolerance).
"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.core import impact as impact_consts
from shared.core.enums import LogStatsName
from shared.disciplines.ingest import BoundMatch, BoundParticipant
from shared.disciplines.overwatch import baselines, impact, ingest
from shared.disciplines.overwatch.backfill import BackfillService
from shared.disciplines.overwatch.impact_backfill import NEW_STAT_MEMBERS
from shared.schemas.match_doc import MatchDoc
from tests.test_stats_derived_parity import _assert_exact, _canonical_expected

BASELINE_DEPENDENT = ("impact_points", "overperformance_score", "impact_rank")


async def decoded_document(session, service: BackfillService, match_id: int) -> tuple[MatchDoc, BoundMatch]:
    stat_rows = await service._load_stat_rows(session, match_id)
    refs = await service._load_player_refs(session, match_id)
    hero_types = await service._load_hero_types(session)
    players = await service._load_players(session, match_id)
    kills = await service._load_kills(session, match_id)
    impact.assign_fights(kills)
    member_users = {row.workspace_member_id: row.user_id for row in players}
    counts = impact.build_event_counts(kills, hero_types, member_user_ids=member_users)

    keep = stat_rows[stat_rows["hero_id"].isna() & ~stat_rows["name"].isin(NEW_STAT_MEMBERS)]
    cells = [(int(r.user_id), int(r.round), r.name.value, float(r.value)) for r in keep.itertuples(index=False)]
    counts = counts[counts["round"] > 0]
    codes = {name: LogStatsName[name].value for name in impact_consts.EVENT_STATS}
    for r in counts.itertuples(index=False):
        cells += [(int(r.user_id), int(r.round), codes[name], float(getattr(r, name))) for name in codes]
    totals = counts.groupby("user_id", as_index=False)[list(impact_consts.EVENT_STATS)].sum()
    for r in totals.itertuples(index=False):
        cells += [(int(r.user_id), 0, codes[name], float(getattr(r, name))) for name in codes]

    seats = sorted({row.encounter_team_id for row in players})
    team_key = {seat: ("home", "away")[min(index, 1)] for index, seat in enumerate(seats)}
    document = MatchDoc.model_validate(
        {
            "protocol": "owt.match/1",
            "discipline": "overwatch",
            "source": {"kind": "upload"},
            "played_at": "2026-10-18T12:00:00Z",
            "duration_s": 1e6,
            "map": "any",
            "teams": [{"key": "home"}, {"key": "away"}],
            "participants": [
                {
                    "key": str(row.user_id),
                    "team": team_key[row.encounter_team_id],
                    "identity": {"provider": "battlenet", "id": f"Player{row.user_id}#1234"},
                    "role": (
                        {"dimension": "player_role", "role": refs[row.user_id].role.slot_code}
                        if row.user_id in refs and refs[row.user_id].role is not None
                        else None
                    ),
                }
                for row in players
            ],
            "segments": [{"index": n, "kind": "round"} for n in sorted({c[1] for c in cells if c[1] > 0})],
            "facts": [
                {"participant": str(user), "stat": stat, "value": value, "segment": rnd}
                for user, rnd, stat, value in cells
            ],
            "events": [{"t": 1.0, "type": "kill", "actor": str(players[0].user_id)}] if kills else [],
        }
    )
    bound = BoundMatch(
        workspace_id=1,
        encounter_id=1,
        encounter_game_id=1,
        participants={
            str(row.user_id): BoundParticipant(
                member_id=row.workspace_member_id,
                user_id=row.user_id,
                encounter_team_id=row.encounter_team_id,
                rank=refs[row.user_id].rank if row.user_id in refs else None,
                role=None,
            )
            for row in players
        },
    )
    return document, bound


@pytest.mark.parametrize("name", ["match", "match_reversed"])
def test_derive_match_equals_the_frozen_p4_derived_objects(stats_parity_database, name):
    url, ids = stats_parity_database

    async def run() -> None:
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                service = baselines.baseline_service
                await service.invalidate_cache(discipline="overwatch")
                await service.recompute(session, discipline="overwatch")
                backfill = BackfillService()
                document, bound = await decoded_document(session, backfill, ids[name])
                derived = await ingest.derive_match(session, document, bound)
        finally:
            await engine.dispose()

        golden = {
            (row["user_id"], row["round"], row["stat_code"]): row["value"]
            for row in _canonical_expected()["matches"][name]["objects"]
            if row["hero_id"] is None and row["stat_code"] in BASELINE_DEPENDENT
        }
        actual = {
            (int(f.participant), f.segment, f.stat): f.value for f in derived.facts if f.stat in BASELINE_DEPENDENT
        }
        assert golden, "the frozen golden holds impact objects for this match"
        _assert_exact(dict(sorted(actual.items())), dict(sorted(golden.items())))

        # The performance rank is recomputed after binding: points descending within a segment, ties by user id (the
        # fixture's stored `performance` facts are synthetic, so the oracle is that rule applied to the points).
        def rank(facts):
            return sorted(((f.participant, f.segment, f.value) for f in facts if f.stat == "performance"), key=repr)

        points = [(f.segment, -f.value, int(f.participant)) for f in document.facts if f.stat == "performance_points"]
        by_segment: dict[int, list] = {}
        for segment, _negative, user in sorted(points):
            by_segment.setdefault(segment, []).append(user)
        oracle = [(str(u), s, float(i)) for s, users in by_segment.items() for i, u in enumerate(users, 1)]
        assert rank(derived.facts) == sorted(oracle, key=repr) != []
        replaced = {*BASELINE_DEPENDENT, "performance"}
        assert [f for f in derived.facts if f.stat not in replaced] == [
            f for f in document.facts if f.stat not in replaced
        ]

    asyncio.run(run())
