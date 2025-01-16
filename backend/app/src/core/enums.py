from enum import StrEnum


class RouteTag(StrEnum):
    """Tags used to classify API routes"""

    ENCOUNTER = "🎮 Encounter"
    MATCH = "🎮 Match"
    TEAMS = "🎮 Teams"
    TOURNAMENT = "🏆 Tournament"
    STANDINGS = "🏆 Standings"
    STATISTICS = "📊 Statistics"
    HERO = "🦸 Hero"
    USER = "👤 User"
    LOGS = "📜 Logs"
    ACHIEVEMENTS = "🏅 Achievements"
    MAP = "🗺️ Map"
    GAMEMODE = "🎮 Gamemode"
    UTILITY = "🔧 Utility"


class HeroClass(StrEnum):
    tank = "Tank"
    damage = "Damage"
    support = "Support"


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


class LogStatsName(StrEnum):
    Eliminations = "eliminations"
    FinalBlows = "final_blows"
    Deaths = "deaths"
    AllDamageDealt = "all_damage_dealt"
    BarrierDamageDealt = "barrier_damage_dealt"
    HeroDamageDealt = "hero_damage_dealt"
    HealingDealt = "healing_dealt"
    HealingReceived = "healing_received"
    SelfHealing = "self_healing"
    DamageTaken = "damage_taken"
    DamageBlocked = "damage_blocked"
    DefensiveAssists = "defensive_assists"
    OffensiveAssists = "offensive_assists"
    UltimatesEarned = "ultimates_earned"
    UltimatesUsed = "ultimates_used"
    MultikillBest = "multikill_best"
    Multikills = "multikills"
    SoloKills = "solo_kills"
    ObjectiveKills = "objective_kills"
    EnvironmentalKills = "environmental_kills"
    EnvironmentalDeaths = "environmental_deaths"
    CriticalHits = "critical_hits"
    CriticalHitAccuracy = "critical_hit_accuracy"
    ScopedAccuracy = "scoped_accuracy"
    ScopedCriticalHitAccuracy = "scoped_critical_hit_accuracy"
    ScopedCriticalHitKills = "scoped_critical_hit_kills"
    ShotsFired = "shots_fired"
    ShotsHit = "shots_hit"
    ShotsMissed = "shots_missed"
    ScopedShotsFired = "scoped_shots_fired"
    ScopedShotsHit = "scoped_shots_hit"
    WeaponAccuracy = "weapon_accuracy"
    HeroTimePlayed = "hero_time_played"

    Performance = "performance"  # self calculated
    PerformancePoints = "performance_points"  # self calculated
    KD = "kd"  # self calculated
    KDA = "kda"  # self calculated
    DamageDelta = "damage_delta"  # self calculated
    FBE = "fbe"  # self calculated
    DamageFB = "damage_fb"  # self calculated
    Assists = "assists"  # self calculated


class EncounterStatus(StrEnum):
    COMPLETED = "completed"
    PENDING = "pending"
    OPEN = "open"


class MatchEvent(StrEnum):
    OffensiveAssist = "offensive_assist"
    DefensiveAssist = "defensive_assist"
    UltimateCharged = "ultimate_charged"
    UltimateStart = "ultimate_start"
    UltimateEnd = "ultimate_end"
    HeroSwap = "hero_swap"
    MercyRez = "mercy_rez"
    EchoDuplicateStart = "echo_duplicate_start"
    EchoDuplicateEnd = "echo_duplicate_end"


class AbilityEvent(StrEnum):
    PrimaryFire = "Primary Fire"
    SecondaryFire = "Secondary Fire"
    Ability1 = "Ability 1"
    Ability2 = "Ability 2"
    Ultimate = "Ultimate"
    Melee = "Melee"
    Crouch = "Crouch"
