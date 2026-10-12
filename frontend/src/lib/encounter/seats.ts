/**
 * Reading an encounter's seats. An encounter has no sides: its live
 * participations (`teams[]`) are numbered by `slot`, and a duel's slot 1 is
 * drawn on the left, slot 2 on the right. Everything that needs "the two
 * teams" goes through here so no component re-derives an orientation.
 */

type Seated = { slot: number };

/** More than two seats is a lobby (`slot_count > 2`), drawn by the FFA read. */
export function isLobby(encounter: { slot_count: number }): boolean {
  return encounter.slot_count > 2;
}

/** The seats in slot order, whatever order the wire put them in. */
export function seatsBySlot<T extends Seated>(teams: readonly T[] | null | undefined): T[] {
  return [...(teams ?? [])].sort((a, b) => a.slot - b.slot);
}

/** The seat holding `slot`, or null while it is empty. */
export function seatAt<T extends Seated>(teams: readonly T[] | null | undefined, slot: number): T | null {
  return (teams ?? []).find((seat) => seat.slot === slot) ?? null;
}

/** A duel's two seats, slot 1 first; an empty seat reads null. */
export function duelSeats<T extends Seated>(teams: readonly T[] | null | undefined): [T | null, T | null] {
  return [seatAt(teams, 1), seatAt(teams, 2)];
}

/**
 * What `TeamName` draws for a seat: the expanded source team (name + logo)
 * when the read carried it, otherwise the seat's own name snapshot. `null` for
 * an empty seat, which the caller renders as TBD.
 */
export function seatTeam(
  seat: { name: string; team?: { name: string; image_url?: string | null } | null } | null | undefined
): { name: string; image_url?: string | null } | null {
  return seat == null ? null : (seat.team ?? { name: seat.name });
}

/** The slot of one seat of a duel. */
export type DuelSlot = 1 | 2;

/** One value per seat of a duel: slot 1 is `one`, slot 2 is `two`. */
export interface Duel<T> {
  one: T;
  two: T;
}

/** The slot of the higher number, or null on a draw. */
export function duelWinner({ one, two }: Duel<number>): DuelSlot | null {
  if (one === two) return null;
  return one > two ? 1 : 2;
}
