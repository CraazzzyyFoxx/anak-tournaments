import type {
  Encounter,
  EncounterGameWithMap,
  Match,
  MatchWithStats
} from "@/types/encounter.types";
import { acceptedScore, seriesMatchesByPosition } from "@/components/pick-ban/pick-ban-model";
import type { PlayerWithStats, TeamWithStats } from "@/types/team.types";
import { LogStatsName } from "@/types/stats.types";
import { duelSeats, duelWinner, type Duel, type DuelSlot } from "@/lib/encounter/seats";
import { getEncounterWinner, isEncounterCompleted } from "@/lib/encounter/status";

/**
 * Derivations for the encounter (series) detail page.
 *
 * Everything here reads the encounter payload the page already fetches, or the
 * per-map `MatchWithStats` responses the stats panel loads — no extra endpoint
 * knowledge lives in the components. A duel is read by slot: slot 1 is `one`,
 * slot 2 is `two`.
 */

/**
 * A parsed map's score from the encounter's seat order. A log records its own
 * home/away (V4), which is the encounter's flipped whenever the lobby put the
 * slot-2 team first — read raw, a 3–0 for slot 1 printed as 0–3.
 */
export function encounterSeatScore(
  match: Pick<Match, "score" | "home_team_id">,
  encounter: Pick<Encounter, "teams">
): Duel<number> {
  const [, two] = duelSeats(encounter.teams);
  return two?.team_id != null && match.home_team_id === two.team_id
    ? { one: match.score.away, two: match.score.home }
    : { one: match.score.home, two: match.score.away };
}

/**
 * One slot of the series: a position the encounter opened a game for, or a
 * placeholder for a map the format allows but that was never needed (a 3–0 in
 * a Bo5 leaves two empty slots).
 *
 * `game` and `match` are two separate contracts for the same position. The
 * game carries the RESULT — what the captains agreed or an admin ruled — and
 * the match is the parsed log, which may exist for a position with no result
 * and may disagree with one. Neither is derived from the other.
 */
export interface SeriesSlot {
  /** 1-based position in the series. */
  index: number;
  /** The encounter's own result for this position; null on a pre-games payload. */
  game: EncounterGameWithMap | null;
  match: Match | null;
  /** The parsed log's score, in the encounter's seat order. */
  parsedScore: Duel<number> | null;
  winner: DuelSlot | null;
  /** The map the encounter says is being played right now. */
  isLive: boolean;
}

export function buildSeriesSlots(encounter: Encounter): SeriesSlot[] {
  const matches = encounter.matches ?? [];
  const games = encounter.games ?? [];
  // `best_of` is the ceiling, but a series can carry more positions than its
  // format (re-plays, organizer fixes), so never truncate the real ones.
  const slotCount = Math.max(encounter.best_of || 0, games.length, matches.length);
  const live = isEncounterCompleted(encounter) ? null : encounter.current_map_index;
  const positions = Array.from({ length: slotCount }, (_, index) => index + 1);

  // Before the games backfill an encounter carries matches only; index them
  // positionally, the way the page did when a Match row WAS the result.
  if (games.length === 0) {
    return positions.map((position) => {
      const match = matches[position - 1] ?? null;
      const parsedScore = match ? encounterSeatScore(match, encounter) : null;
      return {
        index: position,
        game: null,
        match,
        parsedScore,
        winner: parsedScore ? duelWinner(parsedScore) : null,
        isLive: live != null && live === position - 1
      };
    });
  }

  // The parsed log belongs to the position it names (`map_index`), never to
  // the map alone: a series may play one map twice. A positionless row (every
  // parsed log) is adopted by the earliest position holding its map that has
  // no exact row of its own.
  const gameAt = (position: number) => games.find((game) => game.position === position) ?? null;
  const byPosition = seriesMatchesByPosition(
    matches,
    positions.map((position) => gameAt(position)?.map_id ?? -1)
  );

  return positions.map((position, index) => {
    const game = gameAt(position);
    const accepted = acceptedScore(game, encounter.teams);
    const match = byPosition[index];
    return {
      index: position,
      game,
      match,
      parsedScore: match ? encounterSeatScore(match, encounter) : null,
      // The accepted score decides the position; the parsed log is a separate
      // fact and never overrides it.
      winner: accepted == null ? null : duelWinner(accepted),
      isLive: live != null && live === index
    };
  });
}

/** Maps each seat actually took, counted from the per-map results. */
export function countMapWins(encounter: Encounter): { one: number; two: number; drawn: number } {
  let one = 0;
  let two = 0;
  let drawn = 0;
  for (const match of encounter.matches ?? []) {
    const winner = duelWinner(encounterSeatScore(match, encounter));
    if (winner === 1) one += 1;
    else if (winner === 2) two += 1;
    else drawn += 1;
  }
  return { one, two, drawn };
}

type SeriesOutcome = "win" | "draw" | "unplayed";

export interface SeriesVerdict {
  outcome: SeriesOutcome;
  /** Slot of the winning seat, or null on a draw / an unfinished series. */
  winner: DuelSlot | null;
  loser: DuelSlot | null;
}

/**
 * The series result. Deliberately gated on completion the same way
 * `getEncounterWinner` is: a live 1–0 has a leader, not a winner.
 */
export function getSeriesVerdict(encounter: Encounter): SeriesVerdict {
  if (!isEncounterCompleted(encounter)) {
    return { outcome: "unplayed", winner: null, loser: null };
  }
  const winner = getEncounterWinner(encounter);
  if (winner == null) return { outcome: "draw", winner: null, loser: null };
  return { outcome: "win", winner, loser: winner === 1 ? 2 : 1 };
}

/** Total played time of the series, in seconds. `null` when no map reported one. */
export function getSeriesSeconds(encounter: Encounter): number | null {
  const matches = encounter.matches ?? [];
  let total = 0;
  let any = false;
  for (const match of matches) {
    if (match.time != null && match.time > 0) {
      total += match.time;
      any = true;
    }
  }
  return any ? total : null;
}

/** Localized `1h 04m 30s` / `12m 05s` / `48s`. Units come from the catalog. */
export function formatSeriesClock(
  seconds: number | null | undefined,
  units: { h: string; m: string; s: string }
): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}${units.h} ${pad(minutes)}${units.m} ${pad(rest)}${units.s}`;
  if (minutes > 0) return `${minutes}${units.m} ${pad(rest)}${units.s}`;
  return `${rest}${units.s}`;
}

/** `closeness` is a 0..1 fraction; the UI shows whole percent. */
export function formatCloseness(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

// ─── Series statistics aggregation ──────────────────────────────────────────
//
// Per-map stats arrive as `Record<round, Record<LogStatsName, number>>` with
// round `0` = whole map. To describe a SERIES we fold every map's round-0 row
// into one synthetic round-0 row per player, then re-derive the ratio stats
// with the parser's own formulas (`parser-service` →
// `_calculate_and_add_derived_stats`) instead of averaging per-map ratios,
// which would weight a 3-minute map the same as a 12-minute one.

/** Summed across maps. */
const ADDITIVE_STATS: readonly LogStatsName[] = [
  LogStatsName.Eliminations,
  LogStatsName.FinalBlows,
  LogStatsName.Deaths,
  LogStatsName.Assists,
  LogStatsName.OffensiveAssists,
  LogStatsName.DefensiveAssists,
  LogStatsName.AllDamageDealt,
  LogStatsName.BarrierDamageDealt,
  LogStatsName.HeroDamageDealt,
  LogStatsName.HealingDealt,
  LogStatsName.HealingReceived,
  LogStatsName.SelfHealing,
  LogStatsName.DamageTaken,
  LogStatsName.DamageBlocked,
  LogStatsName.UltimatesEarned,
  LogStatsName.UltimatesUsed,
  LogStatsName.Multikills,
  LogStatsName.SoloKills,
  LogStatsName.ObjectiveKills,
  LogStatsName.EnvironmentalKills,
  LogStatsName.EnvironmentalDeaths,
  LogStatsName.CriticalHits,
  LogStatsName.ScopedCriticalHitKills,
  LogStatsName.ShotsFired,
  LogStatsName.ShotsHit,
  LogStatsName.ShotsMissed,
  LogStatsName.ScopedShotsFired,
  LogStatsName.ScopedShotsHit,
  LogStatsName.HeroTimePlayed,
  LogStatsName.FirstPicks,
  LogStatsName.FirstDeaths,
  LogStatsName.UltimateKills,
  LogStatsName.SupportKills
];

/** A series' "best multikill" is the best single map's, not their sum. */
const MAX_STATS: readonly LogStatsName[] = [LogStatsName.MultikillBest];

/**
 * Ratio stats recomputed from the summed numerator/denominator. `parser-service`
 * divides by `denominator.replace(0, 1)`, so a zero denominator yields the bare
 * numerator — mirrored here so a series row and a map row agree.
 */
const RATIO_STATS: readonly { name: LogStatsName; over: LogStatsName; by: LogStatsName }[] = [
  { name: LogStatsName.KD, over: LogStatsName.Eliminations, by: LogStatsName.Deaths },
  { name: LogStatsName.FBE, over: LogStatsName.FinalBlows, by: LogStatsName.Eliminations },
  { name: LogStatsName.DamageFB, over: LogStatsName.HeroDamageDealt, by: LogStatsName.FinalBlows }
];

/** Accuracy percentages are fractions (0..1) recomputed from shot counts. */
const ACCURACY_STATS: readonly { name: LogStatsName; hit: LogStatsName; fired: LogStatsName }[] = [
  { name: LogStatsName.WeaponAccuracy, hit: LogStatsName.ShotsHit, fired: LogStatsName.ShotsFired },
  {
    name: LogStatsName.CriticalHitAccuracy,
    hit: LogStatsName.CriticalHits,
    fired: LogStatsName.ShotsHit
  },
  {
    name: LogStatsName.ScopedAccuracy,
    hit: LogStatsName.ScopedShotsHit,
    fired: LogStatsName.ScopedShotsFired
  }
];

/**
 * Stats no honest series value exists for, so they are left absent (rendered as
 * `—`) rather than guessed: `impact_points`/`impact_rank`/`overperformance_score`
 * come out of the analytics model, and `scoped_critical_hit_accuracy` needs a
 * scoped-critical-HITS counter the API does not expose.
 */
const SERIES_UNAVAILABLE_STATS: readonly LogStatsName[] = [
  LogStatsName.ImpactPoints,
  LogStatsName.ImpactRank,
  LogStatsName.OverperformanceScore,
  LogStatsName.ScopedCriticalHitAccuracy,
  LogStatsName.Winrate
];

type StatRow = Partial<Record<LogStatsName, number>>;

const WHOLE_MAP_ROUND = 0;

function readStat(row: StatRow, name: LogStatsName): number {
  const value = row[name];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** `parser-service` divides by `denominator.replace(0, 1)`. */
function ratio(numerator: number, denominator: number): number {
  return numerator / (denominator === 0 ? 1 : denominator);
}

/**
 * `PerformancePoints` uses the parser's exact weights, so the series MVP order
 * is computed the same way each map's is rather than averaged from ranks.
 */
function performancePoints(row: StatRow): number {
  return (
    readStat(row, LogStatsName.Eliminations) * 500 +
    readStat(row, LogStatsName.FinalBlows) * 250 +
    readStat(row, LogStatsName.Assists) * 50 +
    readStat(row, LogStatsName.HeroDamageDealt) +
    readStat(row, LogStatsName.HealingDealt) -
    readStat(row, LogStatsName.Deaths) * 750 +
    readStat(row, LogStatsName.DamageBlocked) * 0.1
  );
}

function foldStatRow(target: StatRow, source: StatRow): void {
  for (const name of ADDITIVE_STATS) {
    const value = source[name];
    if (typeof value === "number" && Number.isFinite(value)) {
      target[name] = (target[name] ?? 0) + value;
    }
  }
  for (const name of MAX_STATS) {
    const value = source[name];
    if (typeof value === "number" && Number.isFinite(value)) {
      target[name] = Math.max(target[name] ?? 0, value);
    }
  }
}

function deriveStatRow(row: StatRow): void {
  // `assists` is itself derived; recompute it when the map rows only carried
  // the offensive/defensive split.
  const splitAssists =
    readStat(row, LogStatsName.OffensiveAssists) + readStat(row, LogStatsName.DefensiveAssists);
  if (row[LogStatsName.Assists] == null && splitAssists > 0) {
    row[LogStatsName.Assists] = splitAssists;
  }

  for (const { name, over, by } of RATIO_STATS) {
    if (row[over] == null && row[by] == null) continue;
    row[name] = ratio(readStat(row, over), readStat(row, by));
  }
  row[LogStatsName.KDA] = ratio(
    readStat(row, LogStatsName.Eliminations) + readStat(row, LogStatsName.Assists),
    readStat(row, LogStatsName.Deaths)
  );
  row[LogStatsName.DamageDelta] =
    readStat(row, LogStatsName.HeroDamageDealt) - readStat(row, LogStatsName.DamageTaken);

  for (const { name, hit, fired } of ACCURACY_STATS) {
    const shots = readStat(row, fired);
    // Leave absent rather than emit 0% for a hero that never fires a weapon.
    if (shots <= 0) {
      delete row[name];
      continue;
    }
    row[name] = readStat(row, hit) / shots;
  }

  row[LogStatsName.PerformancePoints] = performancePoints(row);

  for (const name of SERIES_UNAVAILABLE_STATS) {
    delete row[name];
  }
}

interface SeriesPlayerMeta {
  /** Maps the player actually fielded a hero on. */
  mapsPlayed: number;
  /** 1-based series MVP placement by summed performance points. */
  seriesPlacement: number | null;
}

export interface SeriesAggregate {
  /** Slot 1's team, folded over the series. */
  one: TeamWithStats;
  two: TeamWithStats;
  /** Keyed by player id, for both sides. */
  meta: Record<number, SeriesPlayerMeta>;
  /** Maps whose stats were folded in. */
  mapsCounted: number;
  /** The round key the synthetic teams expose (always the whole-series row). */
  round: number;
}

function heroKey(hero: { id: number }): number {
  return hero.id;
}

function foldPlayer(
  accumulator: Map<
    number,
    { player: PlayerWithStats; stats: StatRow; heroes: Map<number, unknown>; maps: number }
  >,
  player: PlayerWithStats
): void {
  const heroesThisMap = player.heroes?.[WHOLE_MAP_ROUND] ?? [];
  const existing = accumulator.get(player.id);
  const entry = existing ?? {
    player,
    stats: {} as StatRow,
    heroes: new Map<number, unknown>(),
    maps: 0
  };

  foldStatRow(entry.stats, (player.stats?.[WHOLE_MAP_ROUND] ?? {}) as StatRow);
  for (const hero of heroesThisMap) {
    if (!entry.heroes.has(heroKey(hero))) entry.heroes.set(heroKey(hero), hero);
  }
  if (heroesThisMap.length > 0) entry.maps += 1;

  if (!existing) accumulator.set(player.id, entry);
}

function buildSide(
  base: TeamWithStats,
  accumulator: Map<
    number,
    { player: PlayerWithStats; stats: StatRow; heroes: Map<number, unknown>; maps: number }
  >
): { team: TeamWithStats; rows: { id: number; points: number; maps: number }[] } {
  const players: PlayerWithStats[] = [];
  const rows: { id: number; points: number; maps: number }[] = [];

  for (const entry of accumulator.values()) {
    deriveStatRow(entry.stats);
    players.push({
      ...entry.player,
      stats: { [WHOLE_MAP_ROUND]: entry.stats } as PlayerWithStats["stats"],
      heroes: {
        [WHOLE_MAP_ROUND]: Array.from(entry.heroes.values())
      } as PlayerWithStats["heroes"]
    });
    rows.push({
      id: entry.player.id,
      points: entry.stats[LogStatsName.PerformancePoints] ?? 0,
      maps: entry.maps
    });
  }

  return { team: { ...base, players }, rows };
}

/**
 * Fold every loaded map of the series into one synthetic pair of teams whose
 * round-`0` row describes the whole series. The shape is exactly what the
 * per-map stat components already consume, so the series view reuses them
 * instead of growing a parallel set of charts.
 *
 * Sides are resolved by team id against the encounter's seats, not by each
 * map's own `home_team_id` (V4), so a map recorded with the sides flipped still
 * lands on the correct series seat.
 */
export function aggregateSeriesStats(
  matches: MatchWithStats[],
  encounter: Pick<Encounter, "teams">
): SeriesAggregate | null {
  const oneAcc = new Map<
    number,
    { player: PlayerWithStats; stats: StatRow; heroes: Map<number, unknown>; maps: number }
  >();
  const twoAcc = new Map<
    number,
    { player: PlayerWithStats; stats: StatRow; heroes: Map<number, unknown>; maps: number }
  >();
  let oneBase: TeamWithStats | null = null;
  let twoBase: TeamWithStats | null = null;
  const [seatOne, seatTwo] = duelSeats(encounter.teams);
  let mapsCounted = 0;

  for (const match of matches) {
    for (const team of [match.home_team, match.away_team]) {
      if (!team) continue;
      const isOne = team.id === seatOne?.team_id;
      const isTwo = team.id === seatTwo?.team_id;
      if (!isOne && !isTwo) continue;
      if (isOne) oneBase ??= team;
      else twoBase ??= team;
      const accumulator = isOne ? oneAcc : twoAcc;
      for (const player of team.players ?? []) foldPlayer(accumulator, player);
    }
    mapsCounted += 1;
  }

  if (!oneBase || !twoBase) return null;

  const one = buildSide(oneBase, oneAcc);
  const two = buildSide(twoBase, twoAcc);

  // Series MVP order spans both rosters, matching the per-map ranking.
  const ranked = [...one.rows, ...two.rows]
    .filter((row) => row.maps > 0)
    .sort((a, b) => b.points - a.points);
  const meta: Record<number, SeriesPlayerMeta> = {};
  for (const row of [...one.rows, ...two.rows]) {
    const position = ranked.findIndex((candidate) => candidate.id === row.id);
    meta[row.id] = {
      mapsPlayed: row.maps,
      seriesPlacement: position >= 0 ? position + 1 : null
    };
  }

  // `performance` drives the shared MVP badge, so publish the series placement
  // under the same key the per-map rows use.
  for (const team of [one.team, two.team]) {
    for (const player of team.players) {
      const placement = meta[player.id]?.seriesPlacement;
      const row = player.stats[WHOLE_MAP_ROUND] as StatRow;
      if (placement != null) row[LogStatsName.Performance] = placement;
      else delete row[LogStatsName.Performance];
    }
  }

  return { one: one.team, two: two.team, meta, mapsCounted, round: WHOLE_MAP_ROUND };
}
