from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, NamedTuple

__all__ = (
    "MergeRanksResult",
    "RankSource",
    "ResolvedRank",
    "RoleRank",
    "merge_ranks",
    "normalize_battle_tag",
    "normalize_battle_tag_key",
    "pick_rank",
)


@dataclass(frozen=True, slots=True)
class RoleRank:
    role: str
    rank_value: int
    updated_at: datetime | None
    id: int | None = None


class MergeRanksResult(NamedTuple):
    keep: list
    delete_ids: list[int]
    move: list


def normalize_battle_tag(value: str | None) -> str | None:
    """Normalize a battle tag by collapsing spaces around '#'.

    Returns None for empty/whitespace-only input.
    """
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    return re.sub(r"\s*#\s*", "#", text)


def normalize_battle_tag_key(value: str | None) -> str | None:
    """Create a case-insensitive, space-free lookup key from a battle tag.

    Returns None for empty/whitespace-only input.
    """
    normalized = normalize_battle_tag(value)
    if not normalized:
        return None
    return normalized.replace(" ", "").strip().lower()


def _when(rank: object) -> datetime:
    value = getattr(rank, "updated_at", None)
    if value is None:
        return datetime.min.replace(tzinfo=UTC)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def merge_ranks(survivor_ranks: Sequence[object], donor_ranks: Sequence[object]) -> MergeRanksResult:
    """Per role, later updated_at wins. Tie keeps survivor. Missing roles move."""
    by_s = {getattr(row, "role"): row for row in survivor_ranks}
    by_d = {getattr(row, "role"): row for row in donor_ranks}
    keep: list = []
    delete_ids: list[int] = []
    move: list = []
    for role in set(by_s) | set(by_d):
        survivor = by_s.get(role)
        donor = by_d.get(role)
        if donor is None:
            keep.append(survivor)
            continue
        if survivor is None:
            keep.append(donor)
            move.append(donor)
            continue
        if _when(donor) > _when(survivor):
            keep.append(donor)
            move.append(donor)
            sid = getattr(survivor, "id", None)
            if sid is not None:
                delete_ids.append(sid)
        else:
            keep.append(survivor)
            did = getattr(donor, "id", None)
            if did is not None:
                delete_ids.append(did)
    return MergeRanksResult(keep=keep, delete_ids=delete_ids, move=move)


RankSource = Literal["override", "host", "canon", "ow", "none"]


@dataclass(frozen=True)
class ResolvedRank:
    value: int | None
    source: RankSource


def pick_rank(
    *,
    override: int | None,
    canon: int | None,
    ow: int | None,
    host: int | None = None,
) -> ResolvedRank:
    if override is not None:
        return ResolvedRank(override, "override")
    if host is not None:
        return ResolvedRank(host, "host")
    if canon is not None:
        return ResolvedRank(canon, "canon")
    if ow is not None:
        return ResolvedRank(ow, "ow")
    return ResolvedRank(None, "none")
