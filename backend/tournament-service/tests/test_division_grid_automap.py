from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))


automap = importlib.import_module("src.domain.division_grid.automap")
division_service = importlib.import_module("src.services.division_grid.service")


def _tier(tier_id: int, slug: str, rank_min: int, rank_max: int | None, name: str | None = None):
    return SimpleNamespace(
        id=tier_id,
        slug=slug,
        name=name or slug.replace("-", " ").title(),
        rank_min=rank_min,
        rank_max=rank_max,
    )


def _rules_by_source(result):
    grouped: dict[int, list] = {}
    for rule in result.rules:
        grouped.setdefault(rule.source_tier_id, []).append(rule)
    return grouped


def test_identical_slugs_produce_primary_identity_rules() -> None:
    source = [_tier(1, "bronze", 1000, 1099), _tier(2, "silver", 1100, 1199)]
    target = [_tier(11, "bronze", 1000, 1099), _tier(12, "silver", 1100, 1199)]

    result = automap.generate_mapping_rules(source, target)

    assert result.conflicts == []
    grouped = _rules_by_source(result)
    assert grouped[1][0].target_tier_id == 11
    assert grouped[1][0].weight == 1.0
    assert grouped[1][0].is_primary is True
    assert grouped[2][0].target_tier_id == 12


def test_renamed_slug_falls_back_to_rank_overlap() -> None:
    source = [_tier(1, "old-bronze", 1000, 1099)]
    target = [_tier(11, "new-bronze", 1000, 1099), _tier(12, "silver", 1100, 1199)]

    result = automap.generate_mapping_rules(source, target)

    assert result.conflicts == []
    grouped = _rules_by_source(result)
    assert len(grouped[1]) == 1
    assert grouped[1][0].target_tier_id == 11
    assert grouped[1][0].weight == 1.0
    assert grouped[1][0].is_primary is True


def test_split_source_tier_weights_sum_to_one_with_primary() -> None:
    # source spans 1000..1199 (200 wide); targets split it 1000..1149 (150) + 1150..1199 (50)
    source = [_tier(1, "wide", 1000, 1199)]
    target = [_tier(11, "low", 1000, 1149), _tier(12, "high", 1150, 1199)]

    result = automap.generate_mapping_rules(source, target)

    assert result.conflicts == []
    grouped = _rules_by_source(result)
    rules = sorted(grouped[1], key=lambda r: r.target_tier_id)
    assert {r.target_tier_id for r in rules} == {11, 12}
    total = round(sum(r.weight for r in rules), 6)
    assert total == 1.0
    primary = [r for r in rules if r.is_primary]
    assert len(primary) == 1
    assert primary[0].target_tier_id == 11  # larger overlap (150 vs 50)
    assert primary[0].weight > 0.5


def test_open_ended_top_tiers_overlap_via_ceiling() -> None:
    source = [_tier(1, "top", 4500, None)]
    target = [_tier(11, "champion", 4500, None), _tier(12, "gm", 4000, 4499)]

    result = automap.generate_mapping_rules(source, target)

    assert result.conflicts == []
    grouped = _rules_by_source(result)
    assert grouped[1][0].target_tier_id == 11
    assert grouped[1][0].is_primary is True


def test_no_slug_and_no_overlap_is_a_conflict() -> None:
    source = [_tier(1, "orphan", 5000, 5099)]
    target = [_tier(11, "bronze", 1000, 1099)]

    result = automap.generate_mapping_rules(source, target)

    assert result.rules == []
    assert len(result.conflicts) == 1
    conflict = result.conflicts[0]
    assert conflict.source_tier_id == 1
    assert conflict.slug == "orphan"


def test_mixed_batch_reports_only_the_unmapped_tier() -> None:
    source = [
        _tier(1, "bronze", 1000, 1099),  # slug match
        _tier(2, "renamed", 1100, 1199),  # overlap match
        _tier(3, "orphan", 9000, 9099),  # conflict
    ]
    target = [_tier(11, "bronze", 1000, 1099), _tier(12, "silver", 1100, 1199)]

    result = automap.generate_mapping_rules(source, target)

    grouped = _rules_by_source(result)
    assert set(grouped.keys()) == {1, 2}
    assert [c.source_tier_id for c in result.conflicts] == [3]


def test_generated_rules_satisfy_runtime_validation() -> None:
    # A complete generation must pass the same validation the runtime mapping
    # upsert enforces (weights sum to 1.0 per source tier, primary for splits).
    source = [_tier(1, "wide", 1000, 1199), _tier(2, "top", 1200, None)]
    target = [
        _tier(11, "low", 1000, 1149),
        _tier(12, "high", 1150, 1199),
        _tier(13, "apex", 1200, None),
    ]

    result = automap.generate_mapping_rules(source, target)

    assert result.is_complete
    source_tier_ids = {tier.id for tier in source}
    assert division_service._validate_mapping(source_tier_ids, result.rules) is True


def test_automap_fully_resolves_realistic_ow2_grid_rename() -> None:
    # Smoke: the default 40-tier OW2 grid, re-slugged but keeping the same rank
    # ranges (a structural save that reorganizes labels), must auto-map with zero
    # conflicts via rank overlap and pass runtime validation.
    writes = division_service.get_default_ow2_tiers_write()
    source = [
        SimpleNamespace(id=index + 1, slug=w.slug, name=w.name, rank_min=w.rank_min, rank_max=w.rank_max)
        for index, w in enumerate(writes)
    ]
    target = [
        SimpleNamespace(
            id=1000 + index + 1,
            slug=f"renamed-{w.slug}",
            name=w.name,
            rank_min=w.rank_min,
            rank_max=w.rank_max,
        )
        for index, w in enumerate(writes)
    ]

    result = automap.generate_mapping_rules(source, target)

    assert result.conflicts == []
    assert result.is_complete
    covered = {rule.source_tier_id for rule in result.rules}
    assert covered == {tier.id for tier in source}
    assert division_service._validate_mapping({tier.id for tier in source}, result.rules) is True
