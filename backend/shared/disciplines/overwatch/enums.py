"""The Workshop log grammar: row types, kill abilities and the ``player_stat`` column layout.

Only the decoder reads these. ``LogStatsName`` and ``MatchEvent`` stay in ``shared.core.enums``: they are the stat and
event codes the read side (app, tournament, analytics, achievements) already addresses.
"""

from enum import StrEnum

from shared.core.enums import LogStatsName

__all__ = ("AbilityEvent", "LogEventType", "log_stats_index_map")


class LogEventType(StrEnum):
    MatchStart = "match_start"
    MatchEnd = "match_end"
    PlayerJoined = "player_joined"
    RoundStart = "round_start"
    RoundEnd = "round_end"
    SetupComplete = "setup_complete"
    PointProgress = "point_progress"
    ObjectiveUpdated = "objective_updated"
    ObjectiveCaptured = "objective_captured"
    PayloadProgress = "payload_progress"
    PlayerStat = "player_stat"
    Meta = "meta"
    HeroSpawn = "hero_spawn"
    Kill = "kill"
    OffensiveAssist = "offensive_assist"
    DefensiveAssist = "defensive_assist"
    UltimateCharged = "ultimate_charged"
    UltimateStart = "ultimate_start"
    UltimateEnd = "ultimate_end"
    MercyRez = "mercy_rez"
    HeroSwap = "hero_swap"
    EchoDuplicateStart = "echo_duplicate_start"
    EchoDuplicateEnd = "echo_duplicate_end"
    GraviticFlux = "gravitic_flux"
    Earthshatter = "earthshatter"
    ServerLoad = "server_load"
    ChainHook = "chain_hook"


class AbilityEvent(StrEnum):
    PrimaryFire = "Primary Fire"
    SecondaryFire = "Secondary Fire"
    Ability1 = "Ability 1"
    Ability2 = "Ability 2"
    Ultimate = "Ultimate"
    Melee = "Melee"
    Crouch = "Crouch"


#: Column of each stat in a ``player_stat`` row (``data[0]`` is the row's round, 1..3 are team/player/hero).
log_stats_index_map: dict[LogStatsName, int] = {
    LogStatsName.Eliminations: 4,
    LogStatsName.FinalBlows: 5,
    LogStatsName.Deaths: 6,
    LogStatsName.AllDamageDealt: 7,
    LogStatsName.BarrierDamageDealt: 8,
    LogStatsName.HeroDamageDealt: 9,
    LogStatsName.HealingDealt: 10,
    LogStatsName.HealingReceived: 11,
    LogStatsName.SelfHealing: 12,
    LogStatsName.DamageTaken: 13,
    LogStatsName.DamageBlocked: 14,
    LogStatsName.DefensiveAssists: 15,
    LogStatsName.OffensiveAssists: 16,
    LogStatsName.UltimatesEarned: 17,
    LogStatsName.UltimatesUsed: 18,
    LogStatsName.MultikillBest: 19,
    LogStatsName.Multikills: 20,
    LogStatsName.SoloKills: 21,
    LogStatsName.ObjectiveKills: 22,
    LogStatsName.EnvironmentalKills: 23,
    LogStatsName.EnvironmentalDeaths: 24,
    LogStatsName.CriticalHits: 25,
    LogStatsName.CriticalHitAccuracy: 26,
    LogStatsName.ScopedAccuracy: 27,
    LogStatsName.ScopedCriticalHitAccuracy: 28,
    LogStatsName.ScopedCriticalHitKills: 29,
    LogStatsName.ShotsFired: 30,
    LogStatsName.ShotsHit: 31,
    LogStatsName.ShotsMissed: 32,
    LogStatsName.ScopedShotsFired: 33,
    LogStatsName.ScopedShotsHit: 34,
    LogStatsName.WeaponAccuracy: 35,
    LogStatsName.HeroTimePlayed: 36,
}
