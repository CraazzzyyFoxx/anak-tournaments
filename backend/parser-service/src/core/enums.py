# Import all enums from shared library and re-export
from enum import StrEnum

from shared.core.enums import *


# Parser-specific enum
class RouteTag(StrEnum):
    """Tags used to classify API routes"""

    ENCOUNTER = " Encounter"
    TEAMS = " Teams"
    TOURNAMENT = " Tournament"
    STANDINGS = " Standings"
    GAMEMODE = " Gamemode"
    MAP = " Map"
    HERO = " Hero"
    USER = " User"
    LOGS = " Logs"
    CHALLONGE = " Challonge"
    ANALYTICS = " Analytics"
    ACHIEVEMENT = " Achievement"


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
