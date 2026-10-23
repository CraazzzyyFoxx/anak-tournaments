"""A NULL rank (not specified, e.g. a 1v1 duel) has no division, in Python and in SQL alike."""

import sqlalchemy as sa

from shared.division_grid import DEFAULT_GRID, canonical_division_number, division_case_expr, division_filter_predicates
from shared.domain.division_rank import resolve_tier_for_rank
from shared.services.division_grid.normalization import DivisionGridNormalizer
from shared.services.division_grid.resolution import resolve_tournament_division, resolve_workspace_division
from shared.testing.factories import division_grid

GRID = division_grid(10, ((1, 1, 1000, None), (2, 2, 500, 999), (3, 3, 1, 499)))


def test_python_resolvers_give_no_division_for_no_rank() -> None:
    # A source version the normalizer has not loaded would raise for a real rank; no rank never gets that far.
    normalizer = DivisionGridNormalizer(10, GRID, {}, {})
    assert resolve_tier_for_rank(GRID, None) is None
    assert GRID.resolve_division_number(None) is None
    assert normalizer.normalize_division(99, None) is None
    assert resolve_tournament_division(None, tournament_grid=GRID) is None
    assert resolve_workspace_division(None, source_version_id=99, fallback_grid=GRID, normalizer=normalizer) is None
    assert canonical_division_number(GRID, None, DEFAULT_GRID) is None
    # A real rank below every band still lands on the floor tier.
    assert resolve_tournament_division(0, tournament_grid=GRID) == 3


def _ranks() -> sa.Subquery:
    rows = [sa.select(sa.cast(sa.null(), sa.Integer).label("rank"))]
    rows += [sa.select(sa.literal(rank, sa.Integer).label("rank")) for rank in (0, 600, 1500)]
    return sa.union_all(*rows).subquery()


def test_sql_division_is_null_for_no_rank_and_filters_drop_it() -> None:
    ranks = _ranks()
    with sa.create_engine("sqlite://").connect() as conn:
        divisions = dict(conn.execute(sa.select(ranks.c.rank, division_case_expr(ranks.c.rank, GRID))).all())
        # Every division (floor included, so the range has no lower bound) and the floor alone.
        everything = conn.execute(
            sa.select(ranks.c.rank).where(*division_filter_predicates(ranks.c.rank, 1, 3, GRID))
        ).scalars()
        floor = conn.execute(
            sa.select(ranks.c.rank).where(*division_filter_predicates(ranks.c.rank, 3, 3, GRID))
        ).scalars()
        assert (sorted(everything), sorted(floor)) == ([0, 600, 1500], [0])
    assert divisions == {None: None, 0: 3, 600: 2, 1500: 1}
