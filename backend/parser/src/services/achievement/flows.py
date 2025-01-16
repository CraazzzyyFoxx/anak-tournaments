from sqlalchemy.ext.asyncio import AsyncSession

from src.services.tournament import service as tournament_service

from src import schemas

from . import service

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
        tournament_required=True,
        function=service.create_swiss_knife_achievements,
    ),
}


function_overall_map: dict[str, schemas.AchievementFunction] = {
    "welcome" : schemas.AchievementFunction(
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
        tournament_required=False,
        function=service.calculate_ill_definitely_survive_achievements,
    ),
    "killer-machine": schemas.AchievementFunction(
        slug="killer-machine",
        tournament_required=False,
        function=service.calculate_killer_machine_achievements,
    ),
    "just-shoot-in-the-head": schemas.AchievementFunction(
        slug="just-shoot-in-the-head",
        tournament_required=False,
        function=service.calculate_just_shoot_in_the_head_achievements,
    ),
    "poop-forever": schemas.AchievementFunction(
        slug="poop-forever",
        tournament_required=False,
        function=service.calculate_poop_forever_achievements,
    ),
    "one-shot-one-kill": schemas.AchievementFunction(
        slug="one-shot-one-kill",
        tournament_required=False,
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
    for tournament in await tournament_service.get_all(session):
        if tournament.id >= 21:
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


async def calculate_captains_with_5_division_and_above_achievements(session: AsyncSession) -> None:
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


async def calculate_we_work_with_what_we_have_achievements(session: AsyncSession) -> None:
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


async def calculate_the_shift_factory_is_done_achievements(session: AsyncSession) -> None:
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


async def calculate_achievements(session: AsyncSession) -> None:
    await service.bulk_initial_create_achievements(session)

    await create_hero_kd_achievements(session)
    await service.calculate_welcome_to_club_achievements(session)
    await service.calculate_captain_jack_sparrow_achievements(session)
    await calculate_to_bottom_achievements(session)
    await service.calculate_my_strength_is_growing_achievements(session)
    await service.calculate_not_good_enough_achievements(session)
    await calculate_i_need_more_power_achievements(session)
    await calculate_accuracy_is_above_all_else_achievements(session)
    await calculate_simple_geometry_achievements(session)
    await calculate_no_mercy_achievements(session)
    await calculate_heal_for_a_fee_achievements(session)
    await calculate_beginners_are_lucky_achievements(session)
    await service.calculate_versatile_player_achievements(session)
    await calculate_captains_with_5_division_and_above_achievements(session)
    await service.calculate_samurai_has_no_purpose_achievements(session)
    await service.calculate_best_player_winrate_achievements(session)
    await service.calculate_worst_player_winrate_achievements(session)
    await service.calculate_honor_and_glory_achievements(session)
    await service.calculate_two_wins_players_achievements(session)
    await service.calculate_three_wins_players_achievements(session)
    await service.calculate_sisyphus_and_stone_achievements(session)
    await service.calculate_dahao_achievements(session)
    await service.calculate_pathological_sucker_achievements(session)
    await service.calculate_lord_of_all_the_elements_achievements(session)
    await service.calculate_just_shooting_achievements(session)
    await service.calculate_im_fine_with_that_achievements(session)
    await service.calculate_consistent_winner_achievements(session)
    await service.calculate_old_achievements(session)
    await service.calculate_young_blood_achievements(session)
    await service.calculate_lfs_4500_achievements(session)
    await service.calculate_my_drill_will_pierce_the_sky_achievements(session)
    await service.calculate_balance_from_anak_achievements(session)
    await service.calculate_critical_failure_achievements(session)
    await service.calculate_backyard_cyber_athlete_achievements(session)
    await service.calculate_were_not_suckers_achievements(session)
    await calculate_reverse_sweep_champion_achievements(session)
    await calculate_the_best_among_the_best_achievements(session)
    await service.calculate_its_genetics_achievements(session)
    await calculate_im_screwed_run_achievements(session)
    await calculate_we_work_with_what_we_have_achievements(session)
    await calculate_were_so_fucked_achievements(session)
    await calculate_ill_definitely_survive_achievements(session)
    await calculate_killer_machine_achievements(session)
    await calculate_just_shoot_in_the_head_achievements(session)
    await calculate_poop_forever_achievements(session)
    await calculate_one_shot_one_kill_achievements(session)
    await calculate_friendly_achievements(session)
    await calculate_boris_dick_achievements(session)
    await calculate_just_dont_fuck_around_achievements(session)
    await calculate_john_wick_achievements(session)
    await calculate_the_shift_factory_is_done_achievements(session)
    await calculate_shooting_and_screaming_achievements(session)
    await calculate_fiasko_achievements(session)
    await calculate_boop_master_achievements(session)
    await calculate_bullet_is_not_stupid_achievements(session)
    await calculate_balanced_achievements(session)
    await calculate_hard_game_achievements(session)
    await calculate_7_years_in_azkaban_achievements(session)
    await calculate_fast_game_achievements(session)
    await service.create_space_created_achievements(session)
    await service.calculate_fucking_casino_mouth(session)
    await service.calculate_regular_boar_achievements(session)
    await calculate_revenge_achievement(session)
    await calculate_dirty_smurf_achievements(session)
    await calculate_win_with_20_div_achievement(session)
    await service.calculate_consecutive_wins_achievement(session)
    await service.calculate_five_second_day_streak_achievement(session)
    await calculate_freak_achievements(session)
    await calculate_lower_bracket_run_achievement(session)
    await calculate_mystery_heroes_achievements(session)
    await service.create_swiss_knife_achievements(session)