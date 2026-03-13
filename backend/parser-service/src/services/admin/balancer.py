from __future__ import annotations

import csv
import io
import json
import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import httpx
import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models, schemas
from src.core import config
from src.schemas.admin import balancer as admin_schemas
from src.services.team import flows as team_flows
from src.services.user import flows as user_flows
from src.services.user import service as user_service

BATTLE_TAG_RE = re.compile(config.settings.battle_tag_regex, re.UNICODE)

DEFAULT_ROLE_MAPPING: dict[str, str | None] = {
    "Лайт хил (Мерси, Кирико)": "support",
    "Лайт хил (Мерси, Зен, Люсио, Брига, Мойра)": "support",
    "Лайт хил (Мерси, Зен, Люсио, Брига)": "support",
    "Лайт хил (Мерси, Иллари, Зен, Люсио, Брига, Мойра)": "support",
    "Оба Подкласса Хила": "support",
    "Мейн хил (Ана, Батист, Мойра)": "support",
    "Мейн хил (Юнона, Ана, Батист, Мойра)": "support",
    "Танк": "tank",
    "Танк.": "tank",
    "Оба Подкласса Танка.": "tank",
    "ОффТанк (Заря, Дива, Хог, Сигма)": "tank",
    "МейнТанк (Рейнхард, Винстон, Ориса, Хэммонд)": "tank",
    "Оба Подкласса ДД": "dps",
    "Dps": "dps",
    "Проджектайл ДД (Генджи, Фара, Ханзо, Торбьерн, Джанкрет, Эхо, Мей, Рипер, Сомбра, Симметра, Трейсер)": "dps",
    "Хитскан ДД (Маккри, Вдова, Солдат76, Эш)": "dps",
    "Хитскан ДД (Кэс, Вдова, Солдат76, Эш)": "dps",
    "Я флекс, могу играть абсолютно на всем": None,
}

STREAM_TRUE_VALUES = {
    "1",
    "true",
    "yes",
    "y",
    "да",
    "ага",
    "буду",
    "конечно",
}

VALID_ROLES = {"tank", "dps", "support"}
VALID_ROLE_SUBTYPES = {
    "tank": set(),
    "dps": {"hitscan", "projectile"},
    "support": {"main_heal", "light_heal"},
}
EXPORT_ROLE_ORDER = ["dps", "tank", "support"]
EXPORT_ROLE_PRIORITY = {role: index for index, role in enumerate(EXPORT_ROLE_ORDER)}


def normalize_battle_tag(value: str | None) -> str:
    text = (value or "").strip()
    text = re.sub(r"\s*#\s*", "#", text)
    return text


def normalize_battle_tag_key(value: str | None) -> str:
    return normalize_battle_tag(value).replace(" ", "").strip().lower()


def normalize_header(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def extract_sheet_source(source_url: str) -> tuple[str, str | None]:
    match = re.search(r"/spreadsheets/d/([^/]+)", source_url)
    if not match:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Google Sheets URL")

    sheet_id = match.group(1)
    parsed = urlparse(source_url)
    query = parse_qs(parsed.query)
    gid = query.get("gid", [None])[0]
    if gid is None and parsed.fragment.startswith("gid="):
        gid = parsed.fragment.split("=", 1)[1]

    return sheet_id, gid


def build_csv_export_url(sheet_id: str, gid: str | None) -> str:
    base_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
    if gid:
        return f"{base_url}&gid={gid}"
    return base_url


def parse_submitted_at(value: str | None) -> datetime | None:
    if not value:
        return None

    text = value.strip()
    if not text:
        return None

    formats = (
        "%m/%d/%Y %H:%M:%S",
        "%d.%m.%Y %H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
    )
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue

    try:
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    except ValueError:
        return None


def parse_bool(value: str | None) -> bool:
    if value is None:
        return False
    normalized = normalize_header(value)
    return normalized in STREAM_TRUE_VALUES or normalized.startswith("да")


def unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def extract_battle_tags(value: str | None) -> list[str]:
    if not value:
        return []
    return unique_strings([normalize_battle_tag(match) for match in BATTLE_TAG_RE.findall(value)])


def map_role(raw_role: str | None, role_mapping: dict[str, str | None]) -> str | None:
    if raw_role is None:
        return None

    normalized_value = raw_role.strip()
    if not normalized_value:
        return None

    if normalized_value in role_mapping:
        return role_mapping[normalized_value]

    lowered = normalize_header(normalized_value)
    if "танк" in lowered or lowered == "tank":
        return "tank"
    if "дд" in lowered or "dps" in lowered or "damage" in lowered:
        return "dps"
    if "хил" in lowered or "support" in lowered:
        return "support"
    return None


def sanitize_secondary_roles(primary_role: str | None, roles: list[str] | None) -> list[str]:
    valid_roles = [role for role in roles or [] if role in VALID_ROLES]
    unique_roles = unique_strings(valid_roles)
    if primary_role is None:
        return unique_roles
    return [role for role in unique_roles if role != primary_role]


def infer_role_subtype(raw_role: str | None, mapped_role: str | None) -> str | None:
    if raw_role is None or mapped_role not in VALID_ROLES:
        return None

    lowered = normalize_header(raw_role)
    if mapped_role == "dps":
        if "хитскан" in lowered or "hitscan" in lowered:
            return "hitscan"
        if "проджект" in lowered or "projectile" in lowered:
            return "projectile"
    if mapped_role == "support":
        if "мейн хил" in lowered or "main heal" in lowered:
            return "main_heal"
        if "лайт хил" in lowered or "light heal" in lowered:
            return "light_heal"
    return None


def infer_role_subtype_from_class_flags(role: str, stats: dict[str, Any]) -> str | None:
    primary = bool(stats.get("primary", False))
    secondary = bool(stats.get("secondary", False))

    if primary and secondary:
        return None

    if role == "dps":
        if primary:
            return "hitscan"
        if secondary:
            return "projectile"

    if role == "support":
        if primary:
            return "main_heal"
        if secondary:
            return "light_heal"

    return None


def build_class_subtype_flags(role: str, subtype: str | None) -> tuple[bool, bool]:
    if role == "dps":
        return subtype == "hitscan", subtype == "projectile"

    if role == "support":
        return subtype == "main_heal", subtype == "light_heal"

    return False, False


def filter_ranked_role_entries(
    role_entries: list[dict[str, Any]] | list[admin_schemas.BalancerPlayerRoleEntry] | None,
) -> list[dict[str, Any]]:
    normalized_entries = normalize_role_entries(role_entries)
    return [entry for entry in normalized_entries if entry.get("rank_value") is not None]


def merge_role_candidates_with_subtypes(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged_by_role: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    for candidate in candidates:
        role = candidate["role"]
        if role not in merged_by_role:
            merged_by_role[role] = {**candidate}
            order.append(role)
            continue

        existing = merged_by_role[role]
        if existing.get("subtype") != candidate.get("subtype"):
            existing["subtype"] = None

    return [merged_by_role[role] for role in order]


def extract_application_raw_role_values(application: models.BalancerApplication) -> tuple[str | None, list[str]]:
    raw_row = application.raw_row_json or {}
    primary_role_raw: str | None = None
    additional_roles_raw: list[str] = []

    for key, value in raw_row.items():
        if not isinstance(value, str) or not value.strip():
            continue

        normalized_key = normalize_header(key)
        if normalized_key.startswith("укажите вашу роль") and primary_role_raw is None:
            primary_role_raw = value.strip()
            continue
        if normalized_key.startswith("дополнительная игровая роль"):
            additional_roles_raw.append(value.strip())

    return primary_role_raw, additional_roles_raw


def normalize_role_entries(
    role_entries: list[dict[str, Any]] | list[admin_schemas.BalancerPlayerRoleEntry] | None,
) -> list[dict[str, Any]]:
    normalized_entries: list[dict[str, Any]] = []
    seen_roles: set[str] = set()

    prepared_entries: list[dict[str, Any]] = []
    for entry in role_entries or []:
        if isinstance(entry, dict):
            prepared_entries.append(entry)
        else:
            prepared_entries.append(entry.model_dump())

    prepared_entries.sort(key=lambda item: item.get("priority") or 999)

    for entry in prepared_entries:
        role = entry.get("role")
        if role not in VALID_ROLES or role in seen_roles:
            continue

        subtype = entry.get("subtype")
        if subtype not in VALID_ROLE_SUBTYPES.get(role, set()):
            subtype = None

        division_number = entry.get("division_number")
        rank_value = entry.get("rank_value")

        if division_number is not None and rank_value is None:
            rank_value = resolve_rank_from_division(int(division_number))
        elif rank_value is not None and division_number is None:
            division_number = resolve_division_from_rank(int(rank_value))

        normalized_entries.append(
            {
                "role": role,
                "subtype": subtype,
                "priority": len(normalized_entries) + 1,
                "division_number": int(division_number) if division_number is not None else None,
                "rank_value": int(rank_value) if rank_value is not None else None,
            }
        )
        seen_roles.add(role)

    return normalized_entries


def build_role_entries_from_application(application: models.BalancerApplication) -> list[dict[str, Any]]:
    primary_role_raw, additional_roles_raw = extract_application_raw_role_values(application)
    primary_role = map_role(primary_role_raw, DEFAULT_ROLE_MAPPING)
    additional_roles = sanitize_secondary_roles(
        primary_role,
        [mapped for mapped in (map_role(value, DEFAULT_ROLE_MAPPING) for value in additional_roles_raw) if mapped],
    )

    candidates: list[dict[str, Any]] = []
    if primary_role in VALID_ROLES:
        candidates.append(
            {
                "role": primary_role,
                "subtype": infer_role_subtype(primary_role_raw, primary_role),
                "priority": 1,
                "division_number": None,
                "rank_value": None,
            }
        )

    additional_index = 2
    for raw_role in additional_roles_raw:
        mapped_role = map_role(raw_role, DEFAULT_ROLE_MAPPING)
        if mapped_role not in additional_roles:
            continue
        candidates.append(
            {
                "role": mapped_role,
                "subtype": infer_role_subtype(raw_role, mapped_role),
                "priority": additional_index,
                "division_number": None,
                "rank_value": None,
            }
        )
        additional_index += 1

    merged_candidates = merge_role_candidates_with_subtypes(candidates)
    if merged_candidates:
        return normalize_role_entries(merged_candidates)

    ordered_roles: list[str] = []
    if application.primary_role in VALID_ROLES:
        ordered_roles.append(application.primary_role)

    ordered_roles.extend(
        role
        for role in sanitize_secondary_roles(application.primary_role, application.additional_roles_json or [])
        if role not in ordered_roles
    )

    return normalize_role_entries(
        [
            {
                "role": role,
                "subtype": None,
                "priority": index + 1,
                "division_number": None,
                "rank_value": None,
            }
            for index, role in enumerate(ordered_roles)
        ]
    )


def map_imported_role_entries_to_application(
    application: models.BalancerApplication,
    imported_role_entries: list[dict[str, Any]] | list[admin_schemas.BalancerPlayerRoleEntry] | None,
) -> list[dict[str, Any]]:
    normalized_imported = filter_ranked_role_entries(imported_role_entries)
    allowed_role_entries = build_role_entries_from_application(application)
    imported_by_role = {entry["role"]: entry for entry in normalized_imported}

    merged_entries = [
        {
            "role": allowed_entry["role"],
            "subtype": imported_by_role.get(allowed_entry["role"], {}).get("subtype"),
            "priority": allowed_entry["priority"],
            "division_number": imported_by_role.get(allowed_entry["role"], {}).get("division_number"),
            "rank_value": imported_by_role.get(allowed_entry["role"], {}).get("rank_value"),
        }
        for allowed_entry in allowed_role_entries
        if allowed_entry["role"] in imported_by_role
    ]
    return normalize_role_entries(merged_entries)


def map_existing_role_entries_to_application(
    application: models.BalancerApplication,
    existing_role_entries: list[dict[str, Any]] | list[admin_schemas.BalancerPlayerRoleEntry] | None,
) -> list[dict[str, Any]]:
    normalized_existing = normalize_role_entries(existing_role_entries)
    allowed_role_entries = build_role_entries_from_application(application)
    existing_by_role = {entry["role"]: entry for entry in normalized_existing}

    mapped_entries = [
        {
            "role": allowed_entry["role"],
            "subtype": allowed_entry.get("subtype"),
            "priority": allowed_entry["priority"],
            "division_number": existing_by_role.get(allowed_entry["role"], {}).get("division_number"),
            "rank_value": existing_by_role.get(allowed_entry["role"], {}).get("rank_value"),
        }
        for allowed_entry in allowed_role_entries
    ]
    return normalize_role_entries(mapped_entries)


def sync_legacy_player_fields(player: models.BalancerPlayer, *, is_flex_override: bool | None = None) -> None:
    role_entries = normalize_role_entries(player.role_entries_json or [])
    primary_entry = role_entries[0] if role_entries else None

    player.role_entries_json = role_entries
    if is_flex_override is not None:
        player.is_flex = is_flex_override
    else:
        player.is_flex = sum(1 for entry in role_entries if entry.get("rank_value") is not None) > 1
    player.primary_role = primary_entry["role"] if primary_entry else None
    player.secondary_roles_json = [entry["role"] for entry in role_entries[1:]]
    player.division_number = primary_entry.get("division_number") if primary_entry else None
    player.rank_value = primary_entry.get("rank_value") if primary_entry else None


def extract_players_dict(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if payload.get("format") == "xv-1" and isinstance(payload.get("players"), dict):
        return payload["players"]

    data_root = payload.get("data")
    if isinstance(data_root, dict):
        if isinstance(data_root.get("players"), dict):
            return data_root["players"]

        nested_root = data_root.get("data")
        if isinstance(nested_root, dict) and isinstance(nested_root.get("players"), dict):
            return nested_root["players"]

    if isinstance(payload.get("players"), dict):
        return payload["players"]

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid atravkovs payload")


def build_role_entries_from_classes(classes: dict[str, Any]) -> list[dict[str, Any]]:
    raw_entries: list[dict[str, Any]] = []
    for role, stats in classes.items():
        if role not in VALID_ROLES or not isinstance(stats, dict):
            continue

        rank_raw = stats.get("rank")
        rank_value = int(rank_raw) if isinstance(rank_raw, int | float) and int(rank_raw) > 0 else None
        priority_raw = stats.get("priority")
        priority = int(priority_raw) if isinstance(priority_raw, int | float) else 99
        is_active = bool(stats.get("isActive", False))

        if not is_active and rank_value is None and "priority" not in stats:
            continue

        raw_entries.append(
            {
                "role": role,
                "subtype": stats.get("subtype") or infer_role_subtype_from_class_flags(role, stats),
                "priority": priority,
                "division_number": resolve_division_from_rank(rank_value),
                "rank_value": rank_value,
            }
        )

    return filter_ranked_role_entries(raw_entries)


def parse_imported_player_nodes(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    players_dict = extract_players_dict(payload)
    parsed_players: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    seen_tags: set[str] = set()

    for _, player_node in players_dict.items():
        if not isinstance(player_node, dict):
            continue

        battle_tag = normalize_battle_tag(player_node.get("identity", {}).get("name"))
        normalized_tag = normalize_battle_tag_key(battle_tag)
        if not normalized_tag:
            continue

        if normalized_tag in seen_tags:
            skipped.append(
                {
                    "battle_tag": battle_tag,
                    "battle_tag_normalized": normalized_tag,
                    "reason": "duplicate_in_file",
                }
            )
            continue

        seen_tags.add(normalized_tag)
        meta = player_node.get("meta") if isinstance(player_node.get("meta"), dict) else {}
        role_entries = meta.get("roleEntries") if isinstance(meta.get("roleEntries"), list) else None
        normalized_role_entries = filter_ranked_role_entries(role_entries) if role_entries is not None else None

        if not normalized_role_entries:
            classes = player_node.get("stats", {}).get("classes", {})
            normalized_role_entries = build_role_entries_from_classes(classes if isinstance(classes, dict) else {})

        if not normalized_role_entries:
            skipped.append(
                {
                    "battle_tag": battle_tag,
                    "battle_tag_normalized": normalized_tag,
                    "reason": "no_ranked_roles",
                }
            )
            continue

        admin_notes = meta.get("adminNotes") if isinstance(meta.get("adminNotes"), str) else None
        is_in_pool = bool(meta.get("isInPool", True))
        is_flex = meta.get("isFlex") if isinstance(meta.get("isFlex"), bool) else None

        parsed_players.append(
            {
                "battle_tag": battle_tag,
                "battle_tag_normalized": normalized_tag,
                "role_entries_json": normalized_role_entries,
                "admin_notes": admin_notes,
                "is_in_pool": is_in_pool,
                "is_flex": is_flex,
            }
        )

    return parsed_players, skipped


async def resolve_import_context(
    session: AsyncSession,
    tournament_id: int,
    imported_players: list[dict[str, Any]],
) -> tuple[dict[str, models.BalancerApplication], dict[int, models.BalancerPlayer]]:
    if not imported_players:
        return {}, {}

    result = await session.execute(
        sa.select(models.BalancerApplication)
        .where(models.BalancerApplication.tournament_id == tournament_id)
        .where(models.BalancerApplication.is_active.is_(True))
        .options(selectinload(models.BalancerApplication.player))
        .order_by(models.BalancerApplication.battle_tag_normalized.asc())
    )
    active_applications = list(result.scalars().all())
    applications_by_tag = {application.battle_tag_normalized: application for application in active_applications}
    applications_by_user_id: dict[int, models.BalancerApplication] = {}

    for application in active_applications:
        user_id = application.player.user_id if application.player is not None else None
        if user_id is None:
            user_id = await resolve_public_user_id_for_application(session, application)
        if user_id is None or user_id in applications_by_user_id:
            continue
        applications_by_user_id[user_id] = application

    applications: dict[str, models.BalancerApplication] = {}
    for imported_player in imported_players:
        normalized_tag = imported_player["battle_tag_normalized"]
        direct_application = applications_by_tag.get(normalized_tag)
        if direct_application is not None:
            applications[normalized_tag] = direct_application
            continue

        user = await user_service.find_by_battle_tag(session, imported_player["battle_tag"], ["battle_tag"])
        if user is None:
            continue

        alias_application = applications_by_user_id.get(user.id)
        if alias_application is not None:
            applications[normalized_tag] = alias_application

    existing_players = {
        application.id: application.player for application in applications.values() if application.player is not None
    }
    return applications, existing_players


def serialize_player_for_export(player: models.BalancerPlayer, export_uuid: str) -> dict[str, Any]:
    role_entries = normalize_role_entries(player.role_entries_json or [])
    ordered_active_roles = [entry["role"] for entry in role_entries]
    ordered_roles = ordered_active_roles + [role for role in EXPORT_ROLE_ORDER if role not in ordered_active_roles]
    export_priorities = {role: index for index, role in enumerate(ordered_roles)}
    classes: dict[str, dict[str, Any]] = {}
    for role in EXPORT_ROLE_ORDER:
        entry = next((candidate for candidate in role_entries if candidate["role"] == role), None)
        is_active = bool(entry and entry.get("rank_value") is not None)
        priority = export_priorities[role]
        primary_flag, secondary_flag = build_class_subtype_flags(
            role, entry.get("subtype") if is_active and entry else None
        )
        classes[role] = {
            "rank": entry.get("rank_value") if is_active and entry is not None else 0,
            "playHours": 0,
            "priority": priority,
            "primary": primary_flag,
            "isActive": is_active,
            "secondary": secondary_flag,
        }

    return {
        "identity": {
            "name": player.battle_tag,
            "uuid": export_uuid,
            "isLocked": False,
            "isCaptain": False,
            "isSquire": False,
            "isFullFlex": bool(player.is_flex),
        },
        "stats": {"classes": classes},
        "createdAt": player.created_at.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


def detect_column_mapping(headers: list[str]) -> dict[str, Any]:
    mapping: dict[str, Any] = {"additional_roles": []}

    for index, header in enumerate(headers):
        normalized = normalize_header(header)
        if normalized == "отметка времени":
            mapping["timestamp"] = index
        elif normalized.startswith("ваш battle tag"):
            mapping["battle_tag"] = index
        elif normalized.startswith("ваши battle tag смурфов"):
            mapping["smurf_tags"] = index
        elif normalized.startswith("ваш ник на твиче"):
            mapping["twitch_nick"] = index
        elif normalized.startswith("ваш ник в дискорде"):
            mapping["discord_nick"] = index
        elif normalized.startswith("планируете ли стримить"):
            mapping["stream_pov"] = index
        elif normalized.startswith("в каком последнем турнире"):
            mapping["last_tournament_text"] = index
        elif normalized.startswith("укажите вашу роль"):
            mapping["primary_role"] = index
        elif normalized.startswith("дополнительная игровая роль"):
            mapping["additional_roles"].append(index)
        elif normalized.startswith("любая доп. информация"):
            mapping["notes"] = index

    if not mapping["additional_roles"]:
        mapping.pop("additional_roles")

    return mapping


def row_to_json(headers: list[str], row: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    seen: dict[str, int] = {}

    for index, header in enumerate(headers):
        key_base = header.strip() or f"column_{index}"
        occurrence = seen.get(key_base, 0)
        seen[key_base] = occurrence + 1
        key = key_base if occurrence == 0 else f"{key_base}__{occurrence}"
        result[key] = row[index].strip() if index < len(row) else ""

    return result


def get_row_value(row: list[str], index: int | None) -> str | None:
    if index is None or index < 0 or index >= len(row):
        return None
    value = row[index].strip()
    return value or None


def get_row_values(row: list[str], indexes: list[int] | None) -> list[str]:
    if not indexes:
        return []
    values = [get_row_value(row, index) for index in indexes]
    return [value for value in values if value]


def resolve_rank_from_division(division_number: int | None) -> int | None:
    if division_number is None:
        return None

    rank_map = {
        20: 100,
        19: 250,
        18: 350,
        17: 450,
        16: 550,
        15: 650,
        14: 750,
        13: 850,
        12: 950,
        11: 1050,
        10: 1150,
        9: 1250,
        8: 1350,
        7: 1450,
        6: 1550,
        5: 1650,
        4: 1750,
        3: 1850,
        2: 1950,
        1: 2000,
    }
    return rank_map.get(division_number)


def resolve_division_from_rank(rank_value: int | None) -> int | None:
    if rank_value is None:
        return None
    return team_flows.resolve_player_div(rank_value)


async def get_tournament_sheet(session: AsyncSession, tournament_id: int) -> models.BalancerTournamentSheet | None:
    result = await session.execute(
        sa.select(models.BalancerTournamentSheet).where(models.BalancerTournamentSheet.tournament_id == tournament_id)
    )
    return result.scalar_one_or_none()


async def require_tournament_sheet(session: AsyncSession, tournament_id: int) -> models.BalancerTournamentSheet:
    sheet = await get_tournament_sheet(session, tournament_id)
    if sheet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament sheet not found")
    return sheet


async def ensure_tournament_exists(session: AsyncSession, tournament_id: int) -> None:
    result = await session.execute(sa.select(models.Tournament.id).where(models.Tournament.id == tournament_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")


async def upsert_tournament_sheet(
    session: AsyncSession,
    tournament_id: int,
    data: admin_schemas.BalancerTournamentSheetUpsert,
) -> models.BalancerTournamentSheet:
    await ensure_tournament_exists(session, tournament_id)

    sheet_id, gid = extract_sheet_source(data.source_url)
    sheet = await get_tournament_sheet(session, tournament_id)
    role_mapping = data.role_mapping_json or DEFAULT_ROLE_MAPPING

    if sheet is None:
        sheet = models.BalancerTournamentSheet(
            tournament_id=tournament_id,
            source_url=data.source_url,
            sheet_id=sheet_id,
            gid=gid,
            title=data.title,
            column_mapping_json=data.column_mapping_json,
            role_mapping_json=role_mapping,
            last_sync_status="pending",
        )
        session.add(sheet)
    else:
        sheet.source_url = data.source_url
        sheet.sheet_id = sheet_id
        sheet.gid = gid
        sheet.title = data.title
        if data.column_mapping_json is not None:
            sheet.column_mapping_json = data.column_mapping_json
        if data.role_mapping_json is not None:
            sheet.role_mapping_json = data.role_mapping_json

    await session.commit()
    await session.refresh(sheet)
    return sheet


async def fetch_google_sheet_rows(sheet: models.BalancerTournamentSheet) -> list[list[str]]:
    url = build_csv_export_url(sheet.sheet_id, sheet.gid)
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()

    text = response.text.lstrip("\ufeff")
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google Sheet is empty")
    return rows


def build_application_payload(
    row: list[str],
    headers: list[str],
    column_mapping: dict[str, Any],
    role_mapping: dict[str, str | None],
) -> dict[str, Any] | None:
    battle_tag = normalize_battle_tag(get_row_value(row, column_mapping.get("battle_tag")))
    battle_tag_normalized = normalize_battle_tag_key(battle_tag)
    if not battle_tag_normalized:
        return None

    primary_role_raw = get_row_value(row, column_mapping.get("primary_role"))
    additional_roles_raw = get_row_values(row, column_mapping.get("additional_roles"))
    additional_roles = sanitize_secondary_roles(
        map_role(primary_role_raw, role_mapping),
        [mapped for mapped in (map_role(value, role_mapping) for value in additional_roles_raw) if mapped],
    )

    submitted_at = parse_submitted_at(get_row_value(row, column_mapping.get("timestamp")))
    return {
        "battle_tag": battle_tag,
        "battle_tag_normalized": battle_tag_normalized,
        "smurf_tags_json": extract_battle_tags(get_row_value(row, column_mapping.get("smurf_tags"))),
        "twitch_nick": get_row_value(row, column_mapping.get("twitch_nick")),
        "discord_nick": get_row_value(row, column_mapping.get("discord_nick")),
        "stream_pov": parse_bool(get_row_value(row, column_mapping.get("stream_pov"))),
        "last_tournament_text": get_row_value(row, column_mapping.get("last_tournament_text")),
        "primary_role": map_role(primary_role_raw, role_mapping),
        "additional_roles_json": additional_roles,
        "notes": get_row_value(row, column_mapping.get("notes")),
        "raw_row_json": row_to_json(headers, row),
        "submitted_at": submitted_at,
    }


async def sync_tournament_sheet(
    session: AsyncSession,
    tournament_id: int,
) -> tuple[models.BalancerTournamentSheet, int, int, int, int]:
    sheet = await require_tournament_sheet(session, tournament_id)

    try:
        rows = await fetch_google_sheet_rows(sheet)
        headers = rows[0]
        detected_mapping = detect_column_mapping(headers)
        column_mapping = sheet.column_mapping_json or detected_mapping
        role_mapping = {**DEFAULT_ROLE_MAPPING, **(sheet.role_mapping_json or {})}

        if column_mapping.get("battle_tag") is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Battle tag column not detected")

        latest_payloads: dict[str, tuple[int, dict[str, Any]]] = {}
        for row_index, row in enumerate(rows[1:], start=1):
            payload = build_application_payload(row, headers, column_mapping, role_mapping)
            if payload is None:
                continue

            ordering_key = payload["submitted_at"].timestamp() if payload["submitted_at"] else row_index
            existing = latest_payloads.get(payload["battle_tag_normalized"])
            if existing is None or ordering_key >= existing[0]:
                latest_payloads[payload["battle_tag_normalized"]] = (int(ordering_key), payload)

        result = await session.execute(
            sa.select(models.BalancerApplication)
            .where(models.BalancerApplication.tournament_id == tournament_id)
            .options(selectinload(models.BalancerApplication.player))
        )
        existing_applications = {
            application.battle_tag_normalized: application for application in result.scalars().all()
        }

        created = 0
        updated = 0
        seen_keys: set[str] = set()
        sync_time = datetime.now(UTC)

        for normalized_tag, (_, payload) in latest_payloads.items():
            seen_keys.add(normalized_tag)
            application = existing_applications.get(normalized_tag)
            if application is None:
                application = models.BalancerApplication(
                    tournament_id=tournament_id,
                    tournament_sheet_id=sheet.id,
                    synced_at=sync_time,
                    is_active=True,
                    **payload,
                )
                session.add(application)
                created += 1
                continue

            application.tournament_sheet_id = sheet.id
            application.battle_tag = payload["battle_tag"]
            application.smurf_tags_json = payload["smurf_tags_json"]
            application.twitch_nick = payload["twitch_nick"]
            application.discord_nick = payload["discord_nick"]
            application.stream_pov = payload["stream_pov"]
            application.last_tournament_text = payload["last_tournament_text"]
            application.primary_role = payload["primary_role"]
            application.additional_roles_json = payload["additional_roles_json"]
            application.notes = payload["notes"]
            application.raw_row_json = payload["raw_row_json"]
            application.submitted_at = payload["submitted_at"]
            application.synced_at = sync_time
            application.is_active = True
            updated += 1

        deactivated = 0
        for normalized_tag, application in existing_applications.items():
            if normalized_tag in seen_keys or not application.is_active:
                continue
            application.is_active = False
            application.synced_at = sync_time
            deactivated += 1

        sheet.header_row_json = headers
        sheet.column_mapping_json = column_mapping
        sheet.role_mapping_json = role_mapping
        sheet.last_synced_at = sync_time
        sheet.last_sync_status = "success"
        sheet.last_error = None

        await session.commit()
        await session.refresh(sheet)
        return sheet, created, updated, deactivated, len(latest_payloads)
    except HTTPException as exc:
        sheet.last_sync_status = "failed"
        sheet.last_error = str(exc.detail)
        sheet.last_synced_at = datetime.now(UTC)
        await session.commit()
        raise
    except httpx.HTTPError as exc:
        sheet.last_sync_status = "failed"
        sheet.last_error = str(exc)
        sheet.last_synced_at = datetime.now(UTC)
        await session.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to fetch Google Sheet") from exc


async def list_applications(
    session: AsyncSession,
    tournament_id: int,
    *,
    include_inactive: bool = False,
) -> list[models.BalancerApplication]:
    query = (
        sa.select(models.BalancerApplication)
        .where(models.BalancerApplication.tournament_id == tournament_id)
        .options(selectinload(models.BalancerApplication.player))
        .order_by(models.BalancerApplication.battle_tag_normalized.asc())
    )
    if not include_inactive:
        query = query.where(models.BalancerApplication.is_active.is_(True))

    result = await session.execute(query)
    return list(result.scalars().all())


async def resolve_public_user_id_for_application(
    session: AsyncSession,
    application: models.BalancerApplication,
) -> int | None:
    user_payload = schemas.UserCSV(
        battle_tag=application.battle_tag,
        discord=application.discord_nick,
        twitch=application.twitch_nick,
        smurfs=application.smurf_tags_json or [],
    )
    user = await user_service.find_by_csv(session, user_payload)
    return user.id if user else None


async def create_players_from_applications(
    session: AsyncSession,
    tournament_id: int,
    data: admin_schemas.BalancerPlayerCreateRequest,
) -> list[models.BalancerPlayer]:
    if not data.application_ids:
        return []

    result = await session.execute(
        sa.select(models.BalancerApplication)
        .where(
            models.BalancerApplication.tournament_id == tournament_id,
            models.BalancerApplication.id.in_(data.application_ids),
        )
        .options(selectinload(models.BalancerApplication.player))
    )
    applications = list(result.scalars().all())
    if not applications:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Applications not found")

    for application in applications:
        if application.player is not None:
            continue

        role_entries = build_role_entries_from_application(application)
        user_id = await resolve_public_user_id_for_application(session, application)

        player = models.BalancerPlayer(
            tournament_id=tournament_id,
            application_id=application.id,
            battle_tag=application.battle_tag,
            battle_tag_normalized=application.battle_tag_normalized,
            user_id=user_id,
            role_entries_json=role_entries,
            is_in_pool=True,
        )
        sync_legacy_player_fields(player)
        session.add(player)

    await session.commit()

    result = await session.execute(
        sa.select(models.BalancerPlayer)
        .where(models.BalancerPlayer.tournament_id == tournament_id)
        .where(models.BalancerPlayer.application_id.in_(data.application_ids))
        .order_by(models.BalancerPlayer.battle_tag_normalized.asc())
    )
    return list(result.scalars().all())


async def list_players(
    session: AsyncSession,
    tournament_id: int,
    *,
    in_pool_only: bool = False,
) -> list[models.BalancerPlayer]:
    query = (
        sa.select(models.BalancerPlayer)
        .where(models.BalancerPlayer.tournament_id == tournament_id)
        .order_by(models.BalancerPlayer.battle_tag_normalized.asc())
    )
    if in_pool_only:
        query = query.where(models.BalancerPlayer.is_in_pool.is_(True))
    result = await session.execute(query)
    return list(result.scalars().all())


async def get_player(session: AsyncSession, player_id: int) -> models.BalancerPlayer:
    result = await session.execute(sa.select(models.BalancerPlayer).where(models.BalancerPlayer.id == player_id))
    player = result.scalar_one_or_none()
    if player is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balancer player not found")
    return player


async def update_player(
    session: AsyncSession,
    player_id: int,
    data: admin_schemas.BalancerPlayerUpdate,
) -> models.BalancerPlayer:
    player = await get_player(session, player_id)
    update_data = data.model_dump(exclude_unset=True)

    if "role_entries_json" in update_data:
        player.role_entries_json = normalize_role_entries(update_data["role_entries_json"])

    is_flex_override: bool | None = update_data.get("is_flex")

    for field, value in update_data.items():
        if field in ("role_entries_json", "is_flex"):
            continue
        setattr(player, field, value)

    sync_legacy_player_fields(player, is_flex_override=is_flex_override)

    await session.commit()
    await session.refresh(player)
    return player


async def delete_player(session: AsyncSession, player_id: int) -> None:
    player = await get_player(session, player_id)
    await session.delete(player)
    await session.commit()


async def preview_player_import(
    session: AsyncSession,
    tournament_id: int,
    payload: dict[str, Any],
    *,
    match_application_roles: bool = False,
) -> admin_schemas.BalancerPlayerImportPreviewResponse:
    await ensure_tournament_exists(session, tournament_id)
    imported_players, skipped_entries = parse_imported_player_nodes(payload)
    applications, existing_players = await resolve_import_context(session, tournament_id, imported_players)

    duplicates: list[admin_schemas.BalancerPlayerImportDuplicate] = []
    skipped = [admin_schemas.BalancerPlayerImportSkipped.model_validate(entry) for entry in skipped_entries]
    creatable_players = 0

    for imported_player in imported_players:
        application = applications.get(imported_player["battle_tag_normalized"])
        if application is None:
            skipped.append(
                admin_schemas.BalancerPlayerImportSkipped(
                    battle_tag=imported_player["battle_tag"],
                    battle_tag_normalized=imported_player["battle_tag_normalized"],
                    reason="missing_active_application",
                )
            )
            continue

        imported_role_entries = (
            map_imported_role_entries_to_application(application, imported_player["role_entries_json"])
            if match_application_roles
            else imported_player["role_entries_json"]
        )
        existing_player = existing_players.get(application.id)
        if existing_player is None:
            creatable_players += 1
            continue

        duplicates.append(
            admin_schemas.BalancerPlayerImportDuplicate(
                battle_tag=imported_player["battle_tag"],
                battle_tag_normalized=imported_player["battle_tag_normalized"],
                application_id=application.id,
                existing_player_id=existing_player.id,
                imported_role_entries_json=imported_role_entries,
                existing_role_entries_json=normalize_role_entries(existing_player.role_entries_json),
                imported_is_in_pool=imported_player["is_in_pool"],
                existing_is_in_pool=existing_player.is_in_pool,
                imported_admin_notes=imported_player["admin_notes"],
                existing_admin_notes=existing_player.admin_notes,
            )
        )

    return admin_schemas.BalancerPlayerImportPreviewResponse(
        total_players=len(imported_players) + len(skipped_entries),
        creatable_players=creatable_players,
        duplicate_players=len(duplicates),
        skipped_players=len(skipped),
        duplicates=duplicates,
        skipped=skipped,
    )


async def import_players(
    session: AsyncSession,
    tournament_id: int,
    payload: dict[str, Any],
    *,
    duplicate_strategy: admin_schemas.DuplicateStrategy,
    resolutions: dict[str, admin_schemas.DuplicateResolution] | None = None,
    match_application_roles: bool = False,
) -> admin_schemas.BalancerPlayerImportResult:
    await ensure_tournament_exists(session, tournament_id)
    imported_players, skipped_entries = parse_imported_player_nodes(payload)
    applications, existing_players = await resolve_import_context(session, tournament_id, imported_players)

    created = 0
    replaced = 0
    skipped_duplicates = 0
    skipped_missing_application = 0
    skipped_duplicate_in_file = sum(1 for entry in skipped_entries if entry["reason"] == "duplicate_in_file")
    skipped_no_ranked_roles = sum(1 for entry in skipped_entries if entry["reason"] == "no_ranked_roles")
    unresolved_duplicates: list[str] = []
    resolutions = resolutions or {}

    for imported_player in imported_players:
        application = applications.get(imported_player["battle_tag_normalized"])
        if application is None:
            skipped_missing_application += 1
            continue

        imported_role_entries = (
            map_imported_role_entries_to_application(application, imported_player["role_entries_json"])
            if match_application_roles
            else imported_player["role_entries_json"]
        )

        existing_player = existing_players.get(application.id)
        if existing_player is None:
            user_id = await resolve_public_user_id_for_application(session, application)
            player = models.BalancerPlayer(
                tournament_id=tournament_id,
                application_id=application.id,
                battle_tag=application.battle_tag,
                battle_tag_normalized=application.battle_tag_normalized,
                user_id=user_id,
                role_entries_json=imported_role_entries,
                is_in_pool=imported_player["is_in_pool"],
                admin_notes=imported_player["admin_notes"],
            )
            sync_legacy_player_fields(player, is_flex_override=imported_player["is_flex"])
            session.add(player)
            created += 1
            continue

        if duplicate_strategy == "replace_all":
            resolution = "replace"
        elif duplicate_strategy == "skip_all":
            resolution = "skip"
        else:
            resolution = resolutions.get(imported_player["battle_tag_normalized"])
            if resolution not in {"replace", "skip"}:
                unresolved_duplicates.append(imported_player["battle_tag"])
                continue

        if resolution == "skip":
            skipped_duplicates += 1
            continue

        user_id = await resolve_public_user_id_for_application(session, application)
        existing_player.battle_tag = application.battle_tag
        existing_player.battle_tag_normalized = application.battle_tag_normalized
        existing_player.user_id = user_id
        existing_player.role_entries_json = imported_role_entries
        existing_player.is_in_pool = imported_player["is_in_pool"]
        if imported_player["admin_notes"] is not None:
            existing_player.admin_notes = imported_player["admin_notes"]
        sync_legacy_player_fields(existing_player, is_flex_override=imported_player["is_flex"])
        replaced += 1

    if unresolved_duplicates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unresolved duplicate players: {', '.join(unresolved_duplicates)}",
        )

    await session.commit()
    return admin_schemas.BalancerPlayerImportResult(
        success=True,
        created=created,
        replaced=replaced,
        skipped_duplicates=skipped_duplicates,
        skipped_missing_application=skipped_missing_application,
        skipped_duplicate_in_file=skipped_duplicate_in_file,
        skipped_no_ranked_roles=skipped_no_ranked_roles,
        total_players=len(imported_players) + len(skipped_entries),
    )


async def export_players(
    session: AsyncSession,
    tournament_id: int,
) -> admin_schemas.BalancerPlayerExportResponse:
    await ensure_tournament_exists(session, tournament_id)
    players = await list_players(session, tournament_id)
    serialized_players: dict[str, Any] = {}
    for player in players:
        export_uuid = str(uuid4())
        serialized_players[export_uuid] = serialize_player_for_export(player, export_uuid)
    return admin_schemas.BalancerPlayerExportResponse(format="xv-1", players=serialized_players)


async def sync_player_roles_from_applications(
    session: AsyncSession,
    tournament_id: int,
) -> admin_schemas.BalancerPlayerRoleSyncResponse:
    await ensure_tournament_exists(session, tournament_id)

    result = await session.execute(
        sa.select(models.BalancerPlayer)
        .where(models.BalancerPlayer.tournament_id == tournament_id)
        .options(selectinload(models.BalancerPlayer.application))
        .order_by(models.BalancerPlayer.battle_tag_normalized.asc())
    )
    players = list(result.scalars().all())

    updated = 0
    skipped = 0
    for player in players:
        application = player.application
        if application is None or not application.is_active:
            skipped += 1
            continue

        player.role_entries_json = map_existing_role_entries_to_application(application, player.role_entries_json)
        sync_legacy_player_fields(player, is_flex_override=player.is_flex)
        updated += 1

    await session.commit()
    return admin_schemas.BalancerPlayerRoleSyncResponse(updated=updated, skipped=skipped)


async def get_balance(session: AsyncSession, tournament_id: int) -> models.BalancerBalance | None:
    result = await session.execute(
        sa.select(models.BalancerBalance)
        .where(models.BalancerBalance.tournament_id == tournament_id)
        .options(selectinload(models.BalancerBalance.teams))
    )
    return result.scalar_one_or_none()


def materialize_balance_teams(
    balance_id: int,
    payload: schemas.InternalBalancerTeamsPayload,
) -> list[models.BalancerTeam]:
    teams: list[models.BalancerTeam] = []
    for sort_order, team in enumerate(payload.teams):
        total_sr = sum(player.rating for players in team.roster.values() for player in players)
        teams.append(
            models.BalancerTeam(
                balance_id=balance_id,
                exported_team_id=None,
                name=team.name.split("#")[0],
                balancer_name=team.name,
                captain_battle_tag=team.name,
                avg_sr=team.avg_mmr,
                total_sr=total_sr,
                roster_json=team.model_dump(mode="python", by_alias=True)["roster"],
                sort_order=sort_order,
            )
        )
    return teams


async def save_balance(
    session: AsyncSession,
    tournament_id: int,
    data: admin_schemas.BalanceSaveRequest,
    auth_user: models.AuthUser,
) -> models.BalancerBalance:
    await ensure_tournament_exists(session, tournament_id)
    payload = schemas.InternalBalancerTeamsPayload.model_validate(data.result_json)
    if not payload.teams:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Balance result does not contain teams")

    balance = await get_balance(session, tournament_id)
    if balance is None:
        balance = models.BalancerBalance(
            tournament_id=tournament_id,
            config_json=data.config_json,
            result_json=data.result_json,
            saved_by=auth_user.id,
            saved_at=datetime.now(UTC),
            export_status=None,
            export_error=None,
            exported_at=None,
        )
        session.add(balance)
        await session.flush()
    else:
        balance.config_json = data.config_json
        balance.result_json = data.result_json
        balance.saved_by = auth_user.id
        balance.saved_at = datetime.now(UTC)
        balance.export_status = None
        balance.export_error = None
        balance.exported_at = None
        await session.execute(sa.delete(models.BalancerTeam).where(models.BalancerTeam.balance_id == balance.id))

    session.add_all(materialize_balance_teams(balance.id, payload))
    await session.commit()

    saved_balance = await get_balance(session, tournament_id)
    if saved_balance is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save balance")
    return saved_balance


async def ensure_public_user_for_application(
    session: AsyncSession,
    application: models.BalancerApplication,
) -> models.User:
    payload = schemas.UserCSV(
        battle_tag=application.battle_tag,
        discord=application.discord_nick,
        twitch=application.twitch_nick,
        smurfs=application.smurf_tags_json or [],
    )
    user = await user_service.find_by_csv(session, payload)
    if user is None:
        user = await user_flows.create(session, payload)
    return user


async def ensure_public_users_for_balance(
    session: AsyncSession,
    tournament_id: int,
    payload: schemas.InternalBalancerTeamsPayload,
) -> None:
    normalized_tags = unique_strings(
        [
            normalize_battle_tag_key(player.name)
            for team in payload.teams
            for players in team.roster.values()
            for player in players
        ]
    )
    if not normalized_tags:
        return

    result = await session.execute(
        sa.select(models.BalancerApplication)
        .where(models.BalancerApplication.tournament_id == tournament_id)
        .where(models.BalancerApplication.battle_tag_normalized.in_(normalized_tags))
        .options(selectinload(models.BalancerApplication.player))
    )
    applications = {application.battle_tag_normalized: application for application in result.scalars().all()}

    for normalized_tag in normalized_tags:
        application = applications.get(normalized_tag)
        if application is None:
            continue
        user = await ensure_public_user_for_application(session, application)
        if application.player is not None and application.player.user_id != user.id:
            application.player.user_id = user.id

    await session.commit()


async def export_balance(session: AsyncSession, balance_id: int) -> tuple[models.BalancerBalance, int, int]:
    result = await session.execute(
        sa.select(models.BalancerBalance)
        .where(models.BalancerBalance.id == balance_id)
        .options(selectinload(models.BalancerBalance.teams))
    )
    balance = result.scalar_one_or_none()
    if balance is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balance not found")

    payload = schemas.InternalBalancerTeamsPayload.model_validate(balance.result_json)

    linked_team_ids = [team.exported_team_id for team in balance.teams if team.exported_team_id is not None]
    removed_teams = len(linked_team_ids)

    if linked_team_ids:
        await session.execute(sa.delete(models.Standing).where(models.Standing.team_id.in_(linked_team_ids)))
        await session.execute(sa.delete(models.Player).where(models.Player.team_id.in_(linked_team_ids)))
        await session.execute(sa.delete(models.Team).where(models.Team.id.in_(linked_team_ids)))
        for team in balance.teams:
            team.exported_team_id = None
        await session.commit()

    try:
        await ensure_public_users_for_balance(session, balance.tournament_id, payload)
        balancer_teams = [team.to_balancer_team() for team in payload.teams]
        await team_flows.bulk_create_from_balancer(session, balance.tournament_id, balancer_teams)

        imported_names = [team.name for team in payload.teams]
        result = await session.execute(
            sa.select(models.Team).where(
                models.Team.tournament_id == balance.tournament_id,
                models.Team.balancer_name.in_(imported_names),
            )
        )
        public_teams = {team.balancer_name: team for team in result.scalars().all()}
        for materialized_team in balance.teams:
            public_team = public_teams.get(materialized_team.balancer_name)
            if public_team is not None:
                materialized_team.exported_team_id = public_team.id

        balance.exported_at = datetime.now(UTC)
        balance.export_status = "success"
        balance.export_error = None
        await session.commit()
    except Exception as exc:  # noqa: BLE001
        balance.export_status = "failed"
        balance.export_error = str(exc)
        await session.commit()
        raise

    refreshed = await get_balance(session, balance.tournament_id)
    if refreshed is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to refresh exported balance"
        )
    return refreshed, removed_teams, len(payload.teams)
