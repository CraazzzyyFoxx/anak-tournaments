from sqlalchemy.ext.asyncio import AsyncSession

from src import schemas
from src.core import errors
from src.services.tournament import flows as tournament_flows
from src.services.tournament import service as tournament_service

from . import service

function_division_map: dict[str, schemas.AchievementFunction] = {
    "my-strength-is-growing": schemas.AchievementFunction(
        slug="my-strength-is-growing",
        tournament_required=False,
        function=service.calculate_my_strength_is_growing_achievements,
    ),
    "not-good-enough": schemas.AchievementFunction(
        slug="not-good-enough",
        tournament_required=False,
        function=service.calculate_not_good_enough_achievements,
    ),
    "i-need-more-power": schemas.AchievementFunction(
        slug="i-need-more-power",
        tournament_required=True,
        function=service.calculate_i_need_more_power_achievements,
    ),
    "balance-from-anak": schemas.AchievementFunction(
        slug="balance-from-anak",
        tournament_required=False,
        function=service.calculate_balance_from_anak_achievements,
    ),
    "critical-failure": schemas.AchievementFunction(
        slug="critical-failure",
        tournament_required=False,
        function=service.calculate_critical_failure_achievements,
    ),
    "my-drill-will-pierce-the-sky": schemas.AchievementFunction(
        slug="my-drill-will-pierce-the-sky",
        tournament_required=False,
        function=service.calculate_my_drill_will_pierce_the_sky_achievements,
    ),
    "im-fine-with-that": schemas.AchievementFunction(
        slug="im-fine-with-that",
        tournament_required=False,
        function=service.calculate_im_fine_with_that_achievements,
    ),
}


function_team_map: dict[str, schemas.AchievementFunction] = {
    "accuracy-is-above-all-else": schemas.AchievementFunction(
        slug="accuracy-is-above-all-else",
        tournament_required=True,
        function=service.calculate_accuracy_is_above_all_else_achievements,
    ),
    "simple-geometry": schemas.AchievementFunction(
        slug="simple-geometry",
        tournament_required=True,
        function=service.calculate_simple_geometry_achievements,
    ),
    "no_mercy": schemas.AchievementFunction(
        slug="no_mercy",
        tournament_required=True,
        function=service.calculate_no_mercy_achievements,
    ),
    "heal_for_a_fee": schemas.AchievementFunction(
        slug="heal_for_a_fee",
        tournament_required=True,
        function=service.calculate_heal_for_a_fee_achievements,
    ),
    "damage-above-5-division": schemas.AchievementFunction(
        slug="damage-above-5-division",
        tournament_required=True,
        function=service.calculate_captains_with_5_division_and_above_achievements,
    ),
    "tank-above-5-division": schemas.AchievementFunction(
        slug="tank-above-5-division",
        tournament_required=True,
        function=service.calculate_captains_with_5_division_and_above_achievements,
    ),
    "support-above-5-division": schemas.AchievementFunction(
        slug="support-above-5-division",
        tournament_required=True,
        function=service.calculate_captains_with_5_division_and_above_achievements,
    ),
    "lfs-4500": schemas.AchievementFunction(
        slug="lfs-4500",
        tournament_required=False,
        function=service.calculate_lfs_4500_achievements,
    ),
    "im-screwed-run": schemas.AchievementFunction(
        slug="im-screwed-run",
        tournament_required=True,
        function=service.calculate_im_screwed_run_achievements,
    ),
    "we-work-with-what-we-have": schemas.AchievementFunction(
        slug="we-work-with-what-we-have",
        tournament_required=True,
        function=service.calculate_we_work_with_what_we_have_achievements,
    ),
    "were-so-fucked": schemas.AchievementFunction(
        slug="were-so-fucked",
        tournament_required=True,
        function=service.calculate_were_so_fucked_achievements,
    ),
}


function_standing_map: dict[str, schemas.AchievementFunction] = {
    "beginners-are-lucky": schemas.AchievementFunction(
        slug="beginners-are-lucky",
        tournament_required=True,
        function=service.calculate_beginners_are_lucky_achievements,
    ),
    "were-not-suckers": schemas.AchievementFunction(
        slug="were-not-suckers",
        tournament_required=False,
        function=service.calculate_were_not_suckers_achievements,
    ),
    "reverse-sweep-champion": schemas.AchievementFunction(
        slug="reverse-sweep-champion",
        tournament_required=True,
        function=service.calculate_reverse_sweep_champion_achievements,
    ),
    "to-the-bottom": schemas.AchievementFunction(
        slug="to-the-bottom",
        tournament_required=True,
        function=service.calculate_to_bottom_achievements,
    ),
    "samurai-has-no-purpose": schemas.AchievementFunction(
        slug="samurai-has-no-purpose",
        tournament_required=False,
        function=service.calculate_samurai_has_no_purpose_achievements,
    ),
    "the-best-among-the-best": schemas.AchievementFunction(
        slug="the-best-among-the-best",
        tournament_required=True,
        function=service.calculate_the_best_among_the_best_achievements,
    ),
    "revenge-is-sweet": schemas.AchievementFunction(
        slug="revenge-is-sweet",
        tournament_required=True,
        function=service.calculate_revenge_achievement,
    ),
    "dirty-smurf": schemas.AchievementFunction(
        slug="dirty-smurf",
        tournament_required=True,
        function=service.calculate_dirty_smurf_achievements,
    ),
    "anchor-in-my-throat": schemas.AchievementFunction(
        slug="anchor-in-my-throat",
        tournament_required=True,
        function=service.calculate_win_with_20_div_achievement,
    ),
    "win-2-plus-consecutive": schemas.AchievementFunction(
        slug="win-2-plus-consecutive",
        tournament_required=False,
        function=service.calculate_consecutive_wins_achievement,
    ),
    "five-second-day-streak": schemas.AchievementFunction(
        slug="five-second-day-streak",
        tournament_required=False,
        function=service.calculate_five_second_day_streak_achievement,
    ),
    "i-killed-i-stole": schemas.AchievementFunction(
        slug="i-killed-i-stole",
        tournament_required=True,
        function=service.calculate_lower_bracket_run_achievement,
    ),
    "well-balanced": schemas.AchievementFunction(
        slug="well-balanced",
        tournament_required=True,
        function=service.calculate_well_balanced_achievements,
    ),
}


function_match_map: dict[str, schemas.AchievementFunction] = {
    "friendly": schemas.AchievementFunction(
        slug="friendly",
        tournament_required=True,
        function=service.calculate_friendly_achievements,
    ),
    "boris_dick": schemas.AchievementFunction(
        slug="boris_dick",
        tournament_required=True,
        function=service.calculate_boris_dick_achievements,
    ),
    "just_dont_fuck_around": schemas.AchievementFunction(
        slug="just_dont_fuck_around",
        tournament_required=True,
        function=service.calculate_just_dont_fuck_around_achievements,
    ),
    "john_wick": schemas.AchievementFunction(
        slug="john_wick",
        tournament_required=True,
        function=service.calculate_john_wick_achievements,
    ),
    "the-shift-factory-is-done": schemas.AchievementFunction(
        slug="the-shift-factory-is-done",
        tournament_required=True,
        function=service.calculate_the_shift_factory_is_done_achievements,
    ),
    "shooting_and_screaming": schemas.AchievementFunction(
        slug="shooting_and_screaming",
        tournament_required=True,
        function=service.calculate_shooting_and_screaming_achievements,
    ),
    "fiasko": schemas.AchievementFunction(
        slug="fiasko",
        tournament_required=True,
        function=service.calculate_fiasko_achievements,
    ),
    "boop_master": schemas.AchievementFunction(
        slug="boop_master",
        tournament_required=True,
        function=service.calculate_boop_master_achievements,
    ),
    "bullet-is-not-stupid": schemas.AchievementFunction(
        slug="bullet-is-not-stupid",
        tournament_required=True,
        function=service.calculate_bullet_is_not_stupid_achievements,
    ),
    "balanced": schemas.AchievementFunction(
        slug="balanced",
        tournament_required=True,
        function=service.calculate_balanced_achievements,
    ),
    "hard_game": schemas.AchievementFunction(
        slug="hard_game",
        tournament_required=True,
        function=service.calculate_hard_game_achievements,
    ),
    "7_years_in_azkaban": schemas.AchievementFunction(
        slug="7_years_in_azkaban",
        tournament_required=True,
        function=service.calculate_7_years_in_azkaban_achievements,
    ),
    "fast": schemas.AchievementFunction(
        slug="fast",
        tournament_required=True,
        function=service.calculate_fast_game_achievements,
    ),
}


function_hero_map: dict[str, schemas.AchievementFunction] = {
    "freak": schemas.AchievementFunction(
        slug="freak",
        tournament_required=True,
        function=service.calculate_freak_achievements,
    ),
    "mystery-heroes": schemas.AchievementFunction(
        slug="mystery-heroes",
        tournament_required=True,
        function=service.calculate_mystery_heroes_achievements,
    ),
    "swiss-knife": schemas.AchievementFunction(
        slug="swiss-knife",
        tournament_required=False,
        function=service.create_swiss_knife_achievements,
    ),
}


function_overall_map: dict[str, schemas.AchievementFunction] = {
    "welcome": schemas.AchievementFunction(
        slug="welcome",
        tournament_required=False,
        function=service.calculate_welcome_to_club_achievements,
    ),
    "honor-and-glory": schemas.AchievementFunction(
        slug="honor-and-glory",
        tournament_required=False,
        function=service.calculate_honor_and_glory_achievements,
    ),
    "versatile-player": schemas.AchievementFunction(
        slug="versatile-player",
        tournament_required=False,
        function=service.calculate_versatile_player_achievements,
    ),
    "two-wins-players": schemas.AchievementFunction(
        slug="two-wins-players",
        tournament_required=False,
        function=service.calculate_two_wins_players_achievements,
    ),
    "three-wins-players": schemas.AchievementFunction(
        slug="three-wins-players",
        tournament_required=False,
        function=service.calculate_three_wins_players_achievements,
    ),
    "sisyphus-and-stone": schemas.AchievementFunction(
        slug="sisyphus-and-stone",
        tournament_required=False,
        function=service.calculate_sisyphus_and_stone_achievements,
    ),
    "old": schemas.AchievementFunction(
        slug="old",
        tournament_required=False,
        function=service.calculate_old_achievements,
    ),
    "young-blood": schemas.AchievementFunction(
        slug="young-blood",
        tournament_required=False,
        function=service.calculate_young_blood_achievements,
    ),
    "dahao": schemas.AchievementFunction(
        slug="dahao",
        tournament_required=False,
        function=service.calculate_dahao_achievements,
    ),
    "pathological-sucker": schemas.AchievementFunction(
        slug="pathological-sucker",
        tournament_required=False,
        function=service.calculate_pathological_sucker_achievements,
    ),
    "lord-of-all-the-elements": schemas.AchievementFunction(
        slug="lord-of-all-the-elements",
        tournament_required=False,
        function=service.calculate_lord_of_all_the_elements_achievements,
    ),
    "backyard-cyber-athlete": schemas.AchievementFunction(
        slug="backyard-cyber-athlete",
        tournament_required=False,
        function=service.calculate_backyard_cyber_athlete_achievements,
    ),
    "its-genetics": schemas.AchievementFunction(
        slug="its-genetics",
        tournament_required=False,
        function=service.calculate_its_genetics_achievements,
    ),
    "captain-jack-sparrow": schemas.AchievementFunction(
        slug="captain-jack-sparrow",
        tournament_required=False,
        function=service.calculate_captain_jack_sparrow_achievements,
    ),
    "worst-player-winrate": schemas.AchievementFunction(
        slug="worst-player-winrate",
        tournament_required=False,
        function=service.calculate_worst_player_winrate_achievements,
    ),
    "best-player-winrate": schemas.AchievementFunction(
        slug="best-player-winrate",
        tournament_required=False,
        function=service.calculate_best_player_winrate_achievements,
    ),
    "consistent-winner": schemas.AchievementFunction(
        slug="consistent-winner",
        tournament_required=False,
        function=service.calculate_consistent_winner_achievements,
    ),
    "just-shooting": schemas.AchievementFunction(
        slug="just-shooting",
        tournament_required=False,
        function=service.calculate_just_shooting_achievements,
    ),
    "ill-definitely-survive": schemas.AchievementFunction(
        slug="ill-definitely-survive",
        tournament_required=True,
        function=service.calculate_ill_definitely_survive_achievements,
    ),
    "killer-machine": schemas.AchievementFunction(
        slug="killer-machine",
        tournament_required=True,
        function=service.calculate_killer_machine_achievements,
    ),
    "just-shoot-in-the-head": schemas.AchievementFunction(
        slug="just-shoot-in-the-head",
        tournament_required=True,
        function=service.calculate_just_shoot_in_the_head_achievements,
    ),
    "poop-forever": schemas.AchievementFunction(
        slug="poop-forever",
        tournament_required=True,
        function=service.calculate_poop_forever_achievements,
    ),
    "one-shot-one-kill": schemas.AchievementFunction(
        slug="one-shot-one-kill",
        tournament_required=True,
        function=service.calculate_one_shot_one_kill_achievements,
    ),
    "space-created": schemas.AchievementFunction(
        slug="space-created",
        tournament_required=False,
        function=service.create_space_created_achievements,
    ),
    "fucking-casino-mouth": schemas.AchievementFunction(
        slug="fucking-casino-mouth",
        tournament_required=False,
        function=service.calculate_fucking_casino_mouth,
    ),
    "regular-boar": schemas.AchievementFunction(
        slug="regular-boar",
        tournament_required=False,
        function=service.calculate_regular_boar_achievements,
    ),
}


async def create_hero_kd_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session, is_finished=True):
        if tournament.id >= 1:
            await service.create_hero_kd_achievements(session, tournament)


async def calculate_to_bottom_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_to_bottom_achievements(session, tournament)


async def calculate_i_need_more_power_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_i_need_more_power_achievements(session, tournament)


async def calculate_accuracy_is_above_all_else_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_accuracy_is_above_all_else_achievements(session, tournament)


async def calculate_simple_geometry_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_simple_geometry_achievements(session, tournament)


async def calculate_no_mercy_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_no_mercy_achievements(session, tournament)


async def calculate_heal_for_a_fee_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_heal_for_a_fee_achievements(session, tournament)


async def calculate_beginners_are_lucky_achievements(session: AsyncSession) -> None:
    tournaments = await tournament_service.get_all(session)

    for tournament in tournaments:
        if tournament.id >= 21:
            await service.calculate_beginners_are_lucky_achievements(session, tournament)


async def calculate_captains_with_5_division_and_above_achievements(
    session: AsyncSession,
) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_captains_with_5_division_and_above_achievements(session, tournament)


async def calculate_reverse_sweep_champion_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_reverse_sweep_champion_achievements(session, tournament)


async def calculate_the_best_among_the_best_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_the_best_among_the_best_achievements(session, tournament)


async def calculate_im_screwed_run_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_im_screwed_run_achievements(session, tournament)


async def calculate_we_work_with_what_we_have_achievements(
    session: AsyncSession,
) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_we_work_with_what_we_have_achievements(session, tournament)


async def calculate_were_so_fucked_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_were_so_fucked_achievements(session, tournament)


async def calculate_ill_definitely_survive_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_ill_definitely_survive_achievements(session, tournament)


async def calculate_killer_machine_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_killer_machine_achievements(session, tournament)


async def calculate_just_shoot_in_the_head_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_just_shoot_in_the_head_achievements(session, tournament)


async def calculate_poop_forever_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_poop_forever_achievements(session, tournament)


async def calculate_one_shot_one_kill_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_one_shot_one_kill_achievements(session, tournament)


async def calculate_friendly_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_friendly_achievements(session, tournament)


async def calculate_boris_dick_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_boris_dick_achievements(session, tournament)


async def calculate_just_dont_fuck_around_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_just_dont_fuck_around_achievements(session, tournament)


async def calculate_john_wick_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_john_wick_achievements(session, tournament)


async def calculate_the_shift_factory_is_done_achievements(
    session: AsyncSession,
) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_the_shift_factory_is_done_achievements(session, tournament)


async def calculate_shooting_and_screaming_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_shooting_and_screaming_achievements(session, tournament)


async def calculate_fiasko_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_fiasko_achievements(session, tournament)


async def calculate_boop_master_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_boop_master_achievements(session, tournament)


async def calculate_bullet_is_not_stupid_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_bullet_is_not_stupid_achievements(session, tournament)


async def calculate_balanced_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_balanced_achievements(session, tournament)


async def calculate_hard_game_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_hard_game_achievements(session, tournament)


async def calculate_7_years_in_azkaban_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_7_years_in_azkaban_achievements(session, tournament)


async def calculate_fast_game_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_fast_game_achievements(session, tournament)


async def calculate_revenge_achievement(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_revenge_achievement(session, tournament)


async def calculate_dirty_smurf_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_dirty_smurf_achievements(session, tournament)


async def calculate_win_with_20_div_achievement(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_win_with_20_div_achievement(session, tournament)


async def calculate_freak_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_freak_achievements(session, tournament)


async def calculate_lower_bracket_run_achievement(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        if tournament.id >= 21:
            await service.calculate_lower_bracket_run_achievement(session, tournament)


async def calculate_mystery_heroes_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_mystery_heroes_achievements(session, tournament)


async def calculate_well_balanced_achievements(session: AsyncSession) -> None:
    for tournament in await tournament_service.get_all(session):
        await service.calculate_well_balanced_achievements(session, tournament)


async def calculate_registered_achievements(
    session: AsyncSession,
    *,
    tournament_id: int | None,
    slugs: list[str] | None = None,
    ensure_created: bool = True,
) -> list[str]:
    """Calculate achievements via a stable registry.

    - If `tournament_id` is provided, tournament-scoped achievement functions run only for that tournament.
    - If `tournament_id` is omitted, tournament-scoped achievement functions run for all tournaments.
    - If `slugs` is omitted, all registered functions are executed.
    """

    if ensure_created:
        await service.bulk_initial_create_achievements(session)

    registry: dict[str, schemas.AchievementFunction] = {
        **function_overall_map,
        **function_hero_map,
        **function_division_map,
        **function_team_map,
        **function_standing_map,
        **function_match_map,
        "hero-kd": schemas.AchievementFunction(
            slug="hero-kd",
            tournament_required=True,
            function=service.create_hero_kd_achievements,
        ),
    }

    slugs_to_run = slugs or list(registry.keys())

    unknown = sorted(set(slugs_to_run) - set(registry.keys()))
    if unknown:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="unknown_achievement_slug",
                    msg=f"Unknown achievement slugs: {', '.join(unknown)}",
                )
            ],
        )

    tournament = None
    if tournament_id is not None:
        tournament = await tournament_flows.get(session, tournament_id, [])

    executed: list[str] = []
    for slug in slugs_to_run:
        fn = registry[slug]

        if not fn.tournament_required:
            await fn.function(session)
            executed.append(slug)
            continue

        if tournament is not None:
            await fn.function(session, tournament)
            executed.append(slug)
            continue

        tournaments = (
            await tournament_service.get_all(session, is_finished=True)
            if slug == "hero-kd"
            else await tournament_service.get_all(session)
        )
        for t in tournaments:
            await fn.function(session, t)
        executed.append(slug)

    return executed
