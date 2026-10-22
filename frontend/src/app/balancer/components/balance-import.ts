import type { useTranslations } from "next-intl";

import type {
  InternalBalancePayload,
  InternalBalancePlayer,
  InternalBalanceTeam
} from "@/types/balancer-admin.types";

import {
  calculateTeamAverageValueFromPayload,
  calculateTeamDiscomfortFromPayload,
  calculateTeamVarianceFromPayload
} from "@/components/balancer/balancer-page-helpers";
import { recalculateBalanceStatistics } from "@/components/balancer/balance-editor-helpers";
import { normalizeInternalPayload } from "@/components/balancer/workspace-helpers";
import { solverSlotCode } from "@/lib/roster/shape";

/** The `balancerTool.page.importErrors` translator the import hands its error messages to. */
export type ImportTranslator = ReturnType<typeof useTranslations<"balancerTool.page.importErrors">>;

/** The file shape every format hint quotes: code, not copy, so it stays untranslated. */
const FORMAT_SHAPE =
  '{ "teams": [{ "name": …, "roster": { "<slot code>": [{ "uuid", "name", "assigned_rating" }] } }] }';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlayer(raw: unknown, where: string, t: ImportTranslator): InternalBalancePlayer {
  const hint = t("formatHint", { shape: FORMAT_SHAPE });
  if (!isRecord(raw)) {
    throw new Error(t("notObject", { where, hint }));
  }
  const { uuid, name, assigned_rating: assignedRating } = raw;
  if (typeof uuid !== "string" && typeof uuid !== "number") {
    throw new Error(t("missingUuid", { where }));
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(t("missingName", { where }));
  }
  if (typeof assignedRating !== "number") {
    throw new Error(t("missingRating", { where, hint }));
  }

  return {
    uuid: String(uuid),
    name,
    assigned_rating: assignedRating,
    role_discomfort: typeof raw.role_discomfort === "number" ? raw.role_discomfort : 0,
    is_captain: raw.is_captain === true,
    is_flex: raw.is_flex === true,
    role_preferences: Array.isArray(raw.role_preferences)
      ? raw.role_preferences.filter((role): role is string => typeof role === "string")
      : [],
    sub_role: typeof raw.sub_role === "string" ? raw.sub_role : null,
    all_ratings: isRecord(raw.all_ratings) ? (raw.all_ratings as Record<string, number>) : {},
    all_discomforts: isRecord(raw.all_discomforts)
      ? (raw.all_discomforts as Record<string, number>)
      : {}
  };
}

function parseTeam(
  raw: unknown,
  index: number,
  slotCodes: readonly string[],
  t: ImportTranslator
): InternalBalanceTeam {
  const hint = t("formatHint", { shape: FORMAT_SHAPE });
  if (!isRecord(raw)) {
    throw new Error(t("teamNotObject", { index: index + 1, hint }));
  }
  const name = typeof raw.name === "string" && raw.name.length > 0 ? raw.name : null;
  if (name === null) {
    throw new Error(t("teamMissingName", { index: index + 1 }));
  }
  const roster = raw.roster;
  if (!isRecord(roster)) {
    throw new Error(t("teamMissingRoster", { team: name, hint }));
  }
  // Reject unknown buckets instead of silently dropping their players: a bucket is a role code of the owner game
  // or the open slot, in any case (a file written by an older editor says `Tank`).
  const unknownRole = Object.keys(roster).find(
    (roleKey) => !slotCodes.includes(solverSlotCode(roleKey))
  );
  if (unknownRole !== undefined) {
    throw new Error(
      t("unsupportedRole", { team: name, role: unknownRole, codes: slotCodes.join(", ") })
    );
  }

  const parsedRoster: Record<string, InternalBalancePlayer[]> = {};
  for (const [roleKey, players] of Object.entries(roster)) {
    if (players === undefined || players === null) {
      continue;
    }
    if (!Array.isArray(players)) {
      throw new Error(t("rosterNotArray", { team: name, role: roleKey }));
    }
    parsedRoster[roleKey] = players.map((player, playerIndex) =>
      parsePlayer(
        player,
        t("teamPlayer", { team: name, role: roleKey, index: playerIndex + 1 }),
        t
      )
    );
  }

  // Aggregates are derived, so recompute whatever the file omitted rather than
  // rendering undefined MMR in the editor.
  const team: InternalBalanceTeam = {
    id: typeof raw.id === "number" ? raw.id : index + 1,
    name,
    average_mmr: 0,
    roster: parsedRoster
  };
  const discomfort = calculateTeamDiscomfortFromPayload(team);

  return {
    ...team,
    average_mmr:
      typeof raw.average_mmr === "number"
        ? raw.average_mmr
        : calculateTeamAverageValueFromPayload(team),
    rating_variance:
      typeof raw.rating_variance === "number"
        ? raw.rating_variance
        : calculateTeamVarianceFromPayload(team),
    total_discomfort:
      typeof raw.total_discomfort === "number" ? raw.total_discomfort : discomfort.total,
    max_discomfort: typeof raw.max_discomfort === "number" ? raw.max_discomfort : discomfort.max
  };
}

/**
 * Parse a balance JSON file into a preview payload.
 *
 * Import only loads a variant into the editor — it never writes tournament
 * teams, so Save / Export to Tournament stay explicit follow-up actions.
 * Throws with a translated message naming the offending field; the import
 * dialog shows it verbatim.
 */
export function parseImportedBalancePayload(
  text: string,
  /** The owner game's slot codes (its role codes and the open slot): the buckets a file may carry. */
  slotCodes: readonly string[],
  t: ImportTranslator
): InternalBalancePayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(t("invalidJson"));
  }

  if (!isRecord(raw) || !Array.isArray(raw.teams)) {
    throw new Error(t("missingTeams", { hint: t("formatHint", { shape: FORMAT_SHAPE }) }));
  }
  if (raw.teams.length === 0) {
    throw new Error(t("noTeams"));
  }

  const payload: InternalBalancePayload = {
    teams: raw.teams.map((team, index) => parseTeam(team, index, slotCodes, t)),
    statistics: isRecord(raw.statistics)
      ? (raw.statistics as InternalBalancePayload["statistics"])
      : undefined,
    benched_players: Array.isArray(raw.benched_players)
      ? raw.benched_players.map((player, index) =>
          parsePlayer(player, t("benchedPlayer", { index: index + 1 }), t)
        )
      : []
  };

  // `PUT .../balance` validates statistics against the solver's `Statistics`
  // schema, where average_mmr, mmr_std_dev, total_teams and players_per_team are
  // required. A file written by hand — or trimmed to the documented
  // `{ teams: [...] }` minimum — imports fine and then 422s on save, so the
  // derivable fields are filled in. Whatever the file states wins: only the
  // solver knows its own objective scores.
  const normalized = normalizeInternalPayload(payload);
  return {
    ...normalized,
    statistics: { ...recalculateBalanceStatistics(normalized), ...payload.statistics }
  };
}
