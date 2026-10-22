import { duelSeats, duelWinner } from "@/lib/encounter/seats";
import { isEncounterCompleted } from "@/lib/encounter/status";

import type { BracketMatch, RoundGroup } from "./view";

/** The two seats' team ids, slot 1 first; 0 while a seat is empty or has no source team. */
function teamIdsOf(match: BracketMatch): [number, number] {
  const [one, two] = duelSeats(match.teams);
  return [one?.team_id ?? 0, two?.team_id ?? 0];
}

function scoresOf(match: BracketMatch) {
  const [one, two] = duelSeats(match.teams);
  return { one: one?.score ?? 0, two: two?.score ?? 0 };
}

interface SwissRecord {
  wins: number;
  draws: number;
  losses: number;
}

interface SwissPool {
  /** "1-0", or "1-0-0" (W-D-L) once the stage has a draw anywhere. */
  label: string;
  matches: BracketMatch[];
}

interface SwissRound {
  round: number;
  /** Best record first: 2-0, 1-1, 0-2. */
  pools: SwissPool[];
}

export interface SwissPools {
  rounds: SwissRound[];
  /**
   * Match id → the seat whose record differs from its pool's (a Monrad float
   * down), and that record. The match sits in its better team's pool.
   */
  floats: Map<number, { slot: 1 | 2; label: string }>;
}

const ZERO: SwissRecord = { wins: 0, draws: 0, losses: 0 };

/** Positive: `left` is the better record. */
function compareRecords(left: SwissRecord, right: SwissRecord) {
  return left.wins - right.wins || left.draws - right.draws || right.losses - left.losses;
}

/**
 * A Swiss stage's rounds, each split into pools by the record its teams
 * brought into it — the HLTV / major view of a Swiss stage.
 *
 * A team that is in the stage (it plays some round) but not in this one sat
 * the round out on a bye, scored as a win.
 * ponytail: a bye always counts as a win; read `swiss_bye_points` here if a
 * stage ever pays a bye less than a win.
 */
export function swissPools(groups: RoundGroup[]): SwissPools {
  const ordered = [...groups].sort((left, right) => left.round - right.round);
  const stageTeams = new Set<number>();
  let hasDraw = false;
  for (const group of ordered) {
    for (const match of group.matches) {
      for (const teamId of teamIdsOf(match)) if (teamId > 0) stageTeams.add(teamId);
      if (isEncounterCompleted(match) && duelWinner(scoresOf(match)) == null) hasDraw = true;
    }
  }
  const format = ({ wins, draws, losses }: SwissRecord) =>
    hasDraw ? `${wins}-${draws}-${losses}` : `${wins}-${losses}`;

  const records = new Map<number, SwissRecord>();
  const recordOf = (teamId: number) => records.get(teamId) ?? ZERO;
  const add = (teamId: number, key: keyof SwissRecord) => {
    const record = recordOf(teamId);
    records.set(teamId, { ...record, [key]: record[key] + 1 });
  };

  const floats: SwissPools["floats"] = new Map();
  const rounds = ordered.map((group) => {
    const pools = new Map<string, { record: SwissRecord; matches: BracketMatch[] }>();
    for (const match of group.matches) {
      const [oneId, twoId] = teamIdsOf(match);
      const one = recordOf(oneId);
      const two = recordOf(twoId);
      const oneBetter = compareRecords(one, two) >= 0;
      const record = oneBetter ? one : two;
      const label = format(record);
      if (compareRecords(one, two) !== 0) {
        floats.set(
          match.id,
          oneBetter ? { slot: 2, label: format(two) } : { slot: 1, label: format(one) }
        );
      }
      const pool = pools.get(label) ?? { record, matches: [] };
      pool.matches.push(match);
      pools.set(label, pool);
    }

    const played = new Set<number>();
    for (const match of group.matches) {
      const [oneId, twoId] = teamIdsOf(match);
      played.add(oneId);
      played.add(twoId);
      if (!isEncounterCompleted(match)) continue;
      const winner = duelWinner(scoresOf(match));
      if (winner == null) {
        add(oneId, "draws");
        add(twoId, "draws");
      } else {
        add(oneId, winner === 1 ? "wins" : "losses");
        add(twoId, winner === 1 ? "losses" : "wins");
      }
    }
    for (const teamId of stageTeams) {
      if (!played.has(teamId)) add(teamId, "wins");
    }

    return {
      round: group.round,
      pools: [...pools.entries()]
        .sort((left, right) => compareRecords(right[1].record, left[1].record))
        .map(([label, pool]) => ({ label, matches: pool.matches }))
    };
  });

  return { rounds, floats };
}
