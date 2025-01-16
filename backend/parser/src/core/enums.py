from enum import StrEnum


class RouteTag(StrEnum):
    """Tags used to classify API routes"""

    ENCOUNTER = "🎮 Encounter"
    TEAMS = "🎮 Teams"
    TOURNAMENT = "🏆 Tournament"
    STANDINGS = "🏆 Standings"
    HERO = "🦸 Hero"
    USER = "👤 User"
    LOGS = "📜 Logs"
    CHALLONGE = "🏆 Challonge"


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


class EncounterStatus(StrEnum):
    COMPLETED = "complete"
    PENDING = "pending"
    OPEN = "open"


game_mode_dict = {
    "Осада": "Assault",
    "Натиск": "Push",
    "Сопровождение": "Escort",
    "Точка возгорания": "Flashpoint",
    "Гибридный режим": "Hybrid",
    "Контроль": "Control",
    "Битва": "Clash",
}


map_name_dict = {
    "Blizzard World (зима)": "Blizzard World",
    "Blizzard World (winter)": "Blizzard World",
    "Hollywood (Halloween)": "Hollywood",
    "Голливуд (Хеллоуин)": "Hollywood",
    "King's Row": "King’s Row",
    "King's Row (Winter)": "King’s Row",
    "Lijiang Tower (Lunar New Year)": "Lijiang Tower",
    "Circuit royal": "Circuit Royal",
    "Айхенвальд": "Eichenwalde",
    "Антарктический полуостров": "Antarctic Peninsula",
    "Башня Лицзян": "Lijiang Tower",
    "Гавана": "Havana",
    "Голливуд": "Hollywood",
    "Джанкертаун": "Junkertown",
    "Дорадо": "Dorado",
    "Илиос": "Ilios",
    "Кингс Роу": "King’s Row",
    "Кингс Роу (зима)": "King’s Row",
    "Колизей": "Colosseo",
    "Королевская трасса": "Circuit Royal",
    "Мидтаун": "Midtown",
    "Монастырь Шамбала": "Shambali Monastery",
    "Непал": "Nepal",
    "Нумбани": "Numbani",
    "Нью-Джанк": "New Junk City",
    "Нью-Квин-стрит": "New Queen Street",
    "Оазис": "Oasis",
    "Параисо": "Paraíso",
    "Пост наблюдения: Гибралтар": "Watchpoint: Gibraltar",
    "Пусан": "Busan",
    "Риальто": "Rialto",
    "Самоа": "Samoa",
    "Сураваса": "Suravasa",
    "Шоссе 66": "Route 66",
    "Эсперанса": "Esperança",
    "Ханамура": "Hanamura",
    "Рунасапи": "Runasapi",
    "Ханаока": "Hanaoka",
    "Трон Анубиса": "Throne of Anubis",
}


hero_translation = {
    "Кулак Смерти": "Doomfist",
    "Лусио": "Lúcio",
    "Трейсер": "Tracer",
    "Солдат-76": "Soldier: 76",
    "Гэндзи": "Genji",
    "Ана": "Ana",
    "Ангел": "Mercy",
    "Ориса": "Orisa",
    "Заря": "Zarya",
    "Соджорн": "Sojourn",
    "Роковая Вдова": "Widowmaker",
    "Эш": "Ashe",
    "Кэссиди": "Cassidy",
    "Батист": "Baptiste",
    "Симметра": "Symmetra",
    "Мойра": "Moira",
    "Хандзо": "Hanzo",
    "Уинстон": "Winston",
    "Жнец": "Reaper",
    "Фарра": "Pharah",
    "Турбосвин": "Roadhog",
    "Бригитта": "Brigitte",
    "Ткач Жизни": "Lifeweaver",
    "Торбьорн": "Torbjörn",
    "Королева Стервятников": "Junker Queen",
    "Эхо": "Echo",
    "Иллари": "Illari",
    "Мауга": "Mauga",
    "Таран": "Wrecking Ball",
    "Раматтра": "Ramattra",
    "Мэй": "Mei",
    "Дзенъятта": "Zenyatta",
    "Райнхардт": "Reinhardt",
    "Сигма": "Sigma",
    "Крысавчик": "Junkrat",
    "Сомбра": "Sombra",
    "Авентюра": "Venture",
    "Кирико": "Kiriko",
    "Бастион": "Bastion",
    "Юнона": "Juno",
    "Азарт": "Hazard",
}
