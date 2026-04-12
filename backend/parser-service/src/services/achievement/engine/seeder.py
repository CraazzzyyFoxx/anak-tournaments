"""Workspace seeder — populates default achievement rules for a new workspace.

All 73 default achievements are defined as condition trees.
Call `seed_workspace(session, workspace_id)` to create them.
"""

from __future__ import annotations

from loguru import logger
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.achievement import (
    AchievementCategory,
    AchievementEvaluationResult,
    AchievementGrain,
    AchievementRule,
    AchievementScope,
    EvaluationRun,
    EvaluationRunTrigger,
)

from .runner import run_evaluation
from .validation import infer_grain

# Hero K/D definitions: (name, slug, description_ru_hero, description_en_hero)
_HERO_KD_DEFS: list[tuple[str, str, str, str]] = [
    ("Nerf this!", "dva", "Диве", "D.Va"),
    ("ANDTHEYSAY", "doomfist", "Думфисте", "Doomfist"),
    ("A C C E L E R A N D O", "lucio", "Люсио", "Lúcio"),
    ("Déjà vu", "tracer", "Трейсер", "Tracer"),
    ("That's \"SIR\" to you", "soldier-76", "Солдате", "Soldier: 76"),
    ("Mada Mada", "genji", "Генжи", "Genji"),
    ("W I N T O N", "winston", "Винтоне", "Winston"),
    ("Simple geometry", "hanzo", "Ханзо", "Hanzo"),
    ("Heroes never die", "mercy", "Мерси", "Mercy"),
    ("Everyone dies", "ana", "Ане", "Ana"),
    ("THIS ENDS NOW", "sojourn", "Соджорн", "Sojourn"),
    ("Кокоё", "kiriko", "Кирико", "Kiriko"),
    ("DIE DIE DIE", "reaper", "Рипере", "Reaper"),
    ("Боевой конь", "orisa", "Орисе", "Orisa"),
    ("Огонь по готовности!", "zarya", "Заре", "Zarya"),
    ("Курарефан1", "pharah", "Фарре", "Pharah"),
    ("За победу мать продам", "bastion", "Бастионе", "Bastion"),
    ("Специалист по взрывам", "junkrat", "Джанкрете", "Junkrat"),
    ("Hey bro, nice ass", "widowmaker", "Видоу", "Widowmaker"),
    ("Maximum efficiency", "baptiste", "Баптисте", "Baptiste"),
    ("BOOOOOOB!!!", "ashe", "Аше", "Ashe"),
    ("Собака сутулая", "cassidy", "МакКри", "Cassidy"),
    ("SUFFER AS I HAD!", "ramattra", "Рамматре", "Ramattra"),
    ("цветочек))", "lifeweaver", "ЛайфВивере", "Lifeweaver"),
    ("Солнце взошло", "illari", "Иллари", "Illari"),
    ("Get rocked", "sigma", "Сигме", "Sigma"),
    ("Молот справедливости", "reinhardt", "Райнхардте", "Reinhardt"),
    ("Мирный ОПГшник", "roadhog", "Хоге", "Roadhog"),
    ("Это мой вертолёт!", "wrecking-ball", "Шаре", "Wrecking Ball"),
    ("MINE!", "junker-queen", "Королеве Мусорщиков", "Junker Queen"),
    ("Too slow", "sombra", "Сомбре", "Sombra"),
    ("Zenyatta experience tranquility", "zenyatta", "Дзенъятте", "Zenyatta"),
    ("Чтож ты наделала...", "moira", "Мойре", "Moira"),
    ("Brrrrr", "mei", "Мэй", "Mei"),
    ("Вжжж", "torbjorn", "Торбьёрне", "Torbjörn"),
    ("Скукота", "symmetra", "Симметре", "Symmetra"),
    ("Pew pew pew", "echo", "Эхо", "Echo"),
    ("MUY CALIENTE", "mauga", "Мауге", "Mauga"),
    ("Шнык нюхает", "venture", "Венчуре", "Venture"),
    ("Скрилл-Степ", "juno", "Джуно", "Juno"),
    ("Hazard zone!", "hazard", "Хазарде", "Hazard"),
    ("Маленькая рысь", "brigitte", "Бригитте", "Brigitte"),
]


def _hero_kd_rules(workspace_id: int) -> list[AchievementRule]:
    """Generate hero K/D rules for all heroes."""
    rules = []
    for name, slug, ru_hero, en_hero in _HERO_KD_DEFS:
        rules.append(AchievementRule(
            workspace_id=workspace_id,
            slug=slug,
            name=name,
            description_ru=f"Иметь лучшее K/D на {ru_hero} за турнир",
            description_en=f"Have the best K/D as {en_hero} during the tournament",
            category=AchievementCategory.hero,
            scope=AchievementScope.tournament,
            grain=AchievementGrain.user_tournament,
            condition_tree={"type": "hero_kd_best", "params": {"hero_slug": slug, "min_time": 600, "min_matches": 3}},
            depends_on=["matches.statistics"],
        ))
    return rules


def _match_rules(workspace_id: int) -> list[AchievementRule]:
    """Match-based achievements."""
    return [
        AchievementRule(
            workspace_id=workspace_id, slug="balanced", name="Набалансил",
            description_ru="Сыграть матч с близостью 0%", description_en="Play a match with closeness 0%",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"type": "match_criteria", "params": {"field": "closeness", "op": "==", "value": 0}},
            depends_on=["matches.match", "tournament.encounter"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="hard_game", name="Тяжёлая игра",
            description_ru="Сыграть матч с близостью 1%", description_en="Play a match with closeness 1%",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"type": "match_criteria", "params": {"field": "closeness", "op": "==", "value": 1}},
            depends_on=["matches.match", "tournament.encounter"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="7_years_in_azkaban", name="7 лет в Азкабане",
            description_ru="Сыграть матч длительностью 25+ минут", description_en="Play a match lasting 25+ minutes",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"type": "match_criteria", "params": {"field": "match_time", "op": ">=", "value": 1500}},
            depends_on=["matches.match", "tournament.encounter"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="fast", name="Скоростной",
            description_ru="Сыграть матч длительностью менее 5 минут", description_en="Play a match lasting under 5 minutes",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"type": "match_criteria", "params": {"field": "match_time", "op": "<=", "value": 300}},
            depends_on=["matches.match", "tournament.encounter"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="friendly", name="Дружелюбный",
            description_ru="Сыграть карту с 0 убийствами", description_en="Play a map with 0 kills",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"type": "stat_threshold", "params": {"stat": "Eliminations", "op": "==", "value": 0}},
            depends_on=["matches.statistics"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="boris-dick", name="Борис Дик",
            description_ru="Выиграть карту без единой смерти", description_en="Win a map without dying once",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"AND": [
                {"type": "stat_threshold", "params": {"stat": "Deaths", "op": "==", "value": 0}},
                {"type": "match_win"},
            ]},
            depends_on=["matches.statistics", "tournament.encounter"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="john-wick", name="Джон Уик",
            description_ru="60+ элимов за карту", description_en="60+ eliminations per map",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"type": "stat_threshold", "params": {"stat": "Eliminations", "op": ">=", "value": 60}},
            depends_on=["matches.statistics"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="just-dont-fuck-around", name="Ты не охуел?",
            description_ru="20+ смертей за карту", description_en="20+ deaths per map",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"type": "stat_threshold", "params": {"stat": "Deaths", "op": ">=", "value": 20}},
            depends_on=["matches.statistics"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="the-shift-factory-is-done", name="Смена на заводе закончилась",
            description_ru="30000+ хилла за карту", description_en="30000+ healing per map",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"type": "stat_threshold", "params": {"stat": "HealingDealt", "op": ">=", "value": 30000}},
            depends_on=["matches.statistics"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="shooting-and-screaming", name="Стреляю и ору",
            description_ru="35000+ урона за карту", description_en="35000+ damage per map",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"type": "stat_threshold", "params": {"stat": "HeroDamageDealt", "op": ">=", "value": 35000}},
            depends_on=["matches.statistics"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="fiasko", name="Фиаско",
            description_ru="3+ env смертей за карту", description_en="3+ environmental deaths per map",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"type": "stat_threshold", "params": {"stat": "EnvironmentalDeaths", "op": ">=", "value": 3}},
            depends_on=["matches.statistics"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="boop-master", name="Буп мастер",
            description_ru="3+ env убийств за карту", description_en="3+ environmental kills per map",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"type": "stat_threshold", "params": {"stat": "EnvironmentalKills", "op": ">=", "value": 3}},
            depends_on=["matches.statistics"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="bullet-is-not-stupid", name="Пуля не дура",
            description_ru="10+ scoped crit kills за карту", description_en="10+ scoped critical hit kills per map",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"type": "stat_threshold", "params": {"stat": "ScopedCriticalHitKills", "op": ">=", "value": 10}},
            depends_on=["matches.statistics"],
        ),
    ]


def _overall_rules(workspace_id: int) -> list[AchievementRule]:
    """Overall/global achievements."""
    return [
        AchievementRule(
            workspace_id=workspace_id, slug="welcome", name="Welcome to the club",
            description_ru="Принять участие в турнире", description_en="Participate in a tournament",
            category=AchievementCategory.overall, scope=AchievementScope.glob, grain=AchievementGrain.user,
            condition_tree={"type": "tournament_count", "params": {"op": ">=", "value": 1}},
            depends_on=["tournament.player"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="honor-and-glory", name="Честь и слава",
            description_ru="Выиграть турнир", description_en="Win a tournament",
            category=AchievementCategory.overall, scope=AchievementScope.glob, grain=AchievementGrain.user_tournament,
            condition_tree={"type": "standing_position", "params": {"op": "==", "value": 1}},
            depends_on=["tournament.standing"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="best-player-winrate", name="Лучший по винрейту",
            description_ru="Топ 20 по винрейту", description_en="Top 20 by win rate",
            category=AchievementCategory.overall, scope=AchievementScope.glob, grain=AchievementGrain.user,
            condition_tree={"type": "global_winrate", "params": {"order": "desc", "limit": 20}},
            depends_on=["tournament.player", "tournament.encounter"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="worst-player-winrate", name="Худший по винрейту",
            description_ru="Антитоп 20 по винрейту", description_en="Bottom 20 by win rate",
            category=AchievementCategory.overall, scope=AchievementScope.glob, grain=AchievementGrain.user,
            condition_tree={"type": "global_winrate", "params": {"order": "asc", "limit": 20}},
            depends_on=["tournament.player", "tournament.encounter"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="space-created", name="Space Created",
            description_ru="1000+ смертей за всё время", description_en="1000+ lifetime deaths",
            category=AchievementCategory.overall, scope=AchievementScope.glob, grain=AchievementGrain.user,
            condition_tree={"type": "global_stat_sum", "params": {"stat": "Deaths", "op": ">=", "value": 1000}},
            depends_on=["matches.statistics"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="versatile-player", name="Разносторонний игрок",
            description_ru="Играть на 3+ ролях за всё время", description_en="Play 3+ roles overall",
            category=AchievementCategory.overall, scope=AchievementScope.glob, grain=AchievementGrain.user,
            condition_tree={"type": "distinct_count", "params": {"field": "role", "op": ">=", "value": 3, "scope": "global"}},
            depends_on=["tournament.player"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="captain-jack-sparrow", name="Капитан Джек Воробей",
            description_ru="Быть капитаном", description_en="Be a team captain",
            category=AchievementCategory.overall, scope=AchievementScope.glob, grain=AchievementGrain.user_tournament,
            condition_tree={"type": "is_captain"},
            depends_on=["tournament.player", "tournament.team"],
        ),
    ]


def _division_rules(workspace_id: int) -> list[AchievementRule]:
    """Division change achievements."""
    return [
        AchievementRule(
            workspace_id=workspace_id, slug="my-strength-is-growing", name="Моя сила растёт",
            description_ru="Подняться на 1+ дивизион после турнира", description_en="Gain 1+ division after a tournament",
            category=AchievementCategory.division, scope=AchievementScope.tournament, grain=AchievementGrain.user_tournament,
            condition_tree={"type": "div_change", "params": {"direction": "up", "min_shift": 1}},
            depends_on=["tournament.player", "analytics.tournament"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="not-good-enough", name="Недостаточно хорош",
            description_ru="Упасть на 1+ дивизион после турнира", description_en="Drop 1+ division after a tournament",
            category=AchievementCategory.division, scope=AchievementScope.tournament, grain=AchievementGrain.user_tournament,
            condition_tree={"type": "div_change", "params": {"direction": "down", "min_shift": 1}},
            depends_on=["tournament.player", "analytics.tournament"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="balance-from-anak", name="Баланс от АНАК",
            description_ru="Подняться на 4+ дивизионов после турнира", description_en="Gain 4+ divisions after a tournament",
            category=AchievementCategory.division, scope=AchievementScope.tournament, grain=AchievementGrain.user_tournament,
            condition_tree={"type": "div_change", "params": {"direction": "up", "min_shift": 4}},
            depends_on=["tournament.player", "analytics.tournament"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="critical-failure", name="Критический провал",
            description_ru="Упасть на 4+ дивизионов после турнира", description_en="Drop 4+ divisions after a tournament",
            category=AchievementCategory.division, scope=AchievementScope.tournament, grain=AchievementGrain.user_tournament,
            condition_tree={"type": "div_change", "params": {"direction": "down", "min_shift": 4}},
            depends_on=["tournament.player", "analytics.tournament"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="im-fine-with-that", name="Меня всё устраивает",
            description_ru="7+ турниров на одной роли и дивизии", description_en="7+ tournaments at same role and division",
            category=AchievementCategory.division, scope=AchievementScope.glob, grain=AchievementGrain.user,
            condition_tree={"type": "stable_streak", "params": {"fields": ["role", "division"], "min_streak": 7}},
            depends_on=["tournament.player"],
        ),
    ]


def _standing_rules(workspace_id: int) -> list[AchievementRule]:
    """Standing/bracket achievements."""
    return [
        AchievementRule(
            workspace_id=workspace_id, slug="dirty-smurf", name="Грязный смурф",
            description_ru="Новичок, 1 место", description_en="Newcomer, 1st place",
            category=AchievementCategory.standing, scope=AchievementScope.tournament, grain=AchievementGrain.user_tournament,
            condition_tree={"AND": [
                {"type": "is_newcomer"},
                {"type": "standing_position", "params": {"op": "==", "value": 1}},
                {"type": "tournament_type", "params": {"is_league": False}},
            ]},
            depends_on=["tournament.player", "tournament.standing"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="revenge-is-sweet", name="Месть сладка",
            description_ru="Победить команду, которая вас побеждала ранее", description_en="Beat a team that beat you earlier",
            category=AchievementCategory.standing, scope=AchievementScope.tournament, grain=AchievementGrain.user_tournament,
            condition_tree={"type": "encounter_revenge"},
            depends_on=["tournament.encounter", "tournament.player"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="win-2-plus-consecutive", name="Серия побед",
            description_ru="Выиграть 2+ турнира подряд", description_en="Win 2+ consecutive tournaments",
            category=AchievementCategory.standing, scope=AchievementScope.glob, grain=AchievementGrain.user,
            condition_tree={"type": "consecutive", "params": {"metric": "win", "min_streak": 2}},
            depends_on=["tournament.standing", "tournament.player"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="afgan", name="Афган",
            description_ru="Проиграв в верхней сетке, пройти нижнюю и выиграть турнир (Double Elimination)",
            description_en="After losing in upper bracket, fight through lower bracket and win the tournament (Double Elimination)",
            category=AchievementCategory.standing, scope=AchievementScope.tournament, grain=AchievementGrain.user_tournament,
            condition_tree={"AND": [
                {"type": "standing_position", "params": {"op": "==", "value": 1}},
                {"type": "bracket_path", "params": {"played_lower_bracket": True}},
                {"type": "tournament_format", "params": {"format": "double_elim"}},
            ]},
            depends_on=["tournament.standing", "tournament.encounter", "tournament.player"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="victory-through-intelligence", name="Победа умом",
            description_ru="Победите в матче, в котором вы отыграли статистически хуже, чем враги",
            description_en="Win a match where your team had no players in top-3 MVP by stats",
            category=AchievementCategory.match, scope=AchievementScope.match, grain=AchievementGrain.user_match,
            condition_tree={"AND": [
                {"type": "match_win"},
                {"type": "match_mvp_check", "params": {"stat": "Performance", "top_n": 3, "op": "==", "value": 0}},
            ]},
            depends_on=["matches.statistics", "tournament.encounter"],
        ),
    ]


def _team_rules(workspace_id: int) -> list[AchievementRule]:
    """Team composition achievements."""
    return [
        AchievementRule(
            workspace_id=workspace_id, slug="accuracy-is-above-all-else", name="Точность превыше всего",
            description_ru="В команде 2+ primary damage", description_en="Team has 2+ primary damage dealers",
            category=AchievementCategory.team, scope=AchievementScope.tournament, grain=AchievementGrain.user_tournament,
            condition_tree={"type": "team_players_match", "params": {
                "mode": "count", "count_op": ">=", "count_value": 2,
                "condition": {"AND": [
                    {"type": "player_role", "params": {"role": "Damage"}},
                    {"type": "player_flag", "params": {"flag": "primary"}},
                ]},
            }},
            depends_on=["tournament.player", "tournament.team"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="no_mercy", name="No mercy",
            description_ru="В команде 2+ primary support", description_en="Team has 2+ primary supports",
            category=AchievementCategory.team, scope=AchievementScope.tournament, grain=AchievementGrain.user_tournament,
            condition_tree={"type": "team_players_match", "params": {
                "mode": "count", "count_op": ">=", "count_value": 2,
                "condition": {"AND": [
                    {"type": "player_role", "params": {"role": "Support"}},
                    {"type": "player_flag", "params": {"flag": "primary"}},
                ]},
            }},
            depends_on=["tournament.player", "tournament.team"],
        ),
    ]


def _hero_misc_rules(workspace_id: int) -> list[AchievementRule]:
    """Hero-related (non-KD) achievements."""
    return [
        AchievementRule(
            workspace_id=workspace_id, slug="mystery-heroes", name="Таинственные герои",
            description_ru="Сыграть 7+ героев (>60 сек) за турнир", description_en="Play 7+ heroes (>60 sec) in a tournament",
            category=AchievementCategory.hero, scope=AchievementScope.tournament, grain=AchievementGrain.user_tournament,
            condition_tree={"type": "distinct_count", "params": {"field": "hero", "op": ">=", "value": 7, "scope": "tournament", "min_playtime": 60}},
            depends_on=["matches.statistics"],
        ),
        AchievementRule(
            workspace_id=workspace_id, slug="swiss-knife", name="Швейцарский нож",
            description_ru="Сыграть 20+ героев (>60 сек) за всё время", description_en="Play 20+ heroes (>60 sec) overall",
            category=AchievementCategory.hero, scope=AchievementScope.glob, grain=AchievementGrain.user,
            condition_tree={"type": "distinct_count", "params": {"field": "hero", "op": ">=", "value": 20, "scope": "global", "min_playtime": 60}},
            depends_on=["matches.statistics"],
        ),
    ]


def _all_default_rules(workspace_id: int) -> list[AchievementRule]:
    """Build the full list of default achievement rules for a workspace."""
    return [
        *_match_rules(workspace_id),
        *_overall_rules(workspace_id),
        *_division_rules(workspace_id),
        *_standing_rules(workspace_id),
        *_team_rules(workspace_id),
        *_hero_misc_rules(workspace_id),
        *_hero_kd_rules(workspace_id),
    ]


def get_default_rule_slugs() -> list[str]:
    """Return the canonical supported slug catalog in sorted order."""
    return sorted(rule.slug for rule in _all_default_rules(0))


async def seed_workspace(
    session: AsyncSession,
    workspace_id: int,
    *,
    replace_catalog: bool = False,
) -> tuple[int, int]:
    """Seed a workspace with default achievement rules (upsert).

    If a rule with the same slug already exists in the workspace,
    updates its condition_tree, category, scope, grain, depends_on.
    Otherwise creates a new rule.

    When replace_catalog=True, unsupported rules are deleted from the workspace.
    Returns (upserted_count, removed_count).
    """
    all_rules = _all_default_rules(workspace_id)
    count = 0
    removed = 0
    supported_slugs = {rule.slug for rule in all_rules}
    existing_rules = list(
        (
            await session.execute(
                sa.select(AchievementRule).where(
                    AchievementRule.workspace_id == workspace_id,
                )
            )
        ).scalars()
    )
    existing_by_slug = {rule.slug: rule for rule in existing_rules}

    if replace_catalog:
        for existing in existing_rules:
            if existing.slug in supported_slugs:
                continue
            await session.delete(existing)
            removed += 1

    for rule in all_rules:
        inferred_grain = infer_grain(rule.condition_tree)
        if inferred_grain != rule.grain:
            raise ValueError(
                f"Seed rule '{rule.slug}' has grain '{rule.grain}' but infers '{inferred_grain.value}'"
            )

        existing = existing_by_slug.get(rule.slug)

        if existing:
            existing.condition_tree = rule.condition_tree
            existing.category = rule.category
            existing.scope = rule.scope
            existing.grain = rule.grain
            existing.depends_on = rule.depends_on
            existing.name = rule.name
            existing.description_ru = rule.description_ru
            existing.description_en = rule.description_en
        else:
            session.add(rule)

        count += 1

    await session.flush()
    logger.info(
        f"Seeded workspace {workspace_id} with {count} achievement rules (upsert), removed {removed}"
    )
    return count, removed


async def hard_reset_workspace(
    session: AsyncSession,
    workspace_id: int,
) -> tuple[int, int, int, EvaluationRun]:
    """Replace the supported catalog, clear results, and fully re-evaluate the workspace."""
    seeded, removed = await seed_workspace(
        session,
        workspace_id,
        replace_catalog=True,
    )

    workspace_rule_ids = sa.select(AchievementRule.id).where(
        AchievementRule.workspace_id == workspace_id
    )
    deleted_results = await session.execute(
        sa.delete(AchievementEvaluationResult).where(
            AchievementEvaluationResult.achievement_rule_id.in_(workspace_rule_ids)
        )
    )
    cleared_results = deleted_results.rowcount or 0

    run = await run_evaluation(
        session=session,
        workspace_id=workspace_id,
        trigger=EvaluationRunTrigger.manual,
    )
    logger.info(
        f"Hard-reset workspace {workspace_id}: seeded={seeded}, removed={removed}, "
        f"cleared_results={cleared_results}, run={run.id}"
    )
    return seeded, removed, cleared_results, run
