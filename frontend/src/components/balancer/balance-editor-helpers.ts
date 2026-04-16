import type {
  BalancerRosterKey,
  InternalBalancePayload,
  InternalBalancePlayer,
} from "@/types/balancer-admin.types";

import {
  calculateTeamAverageValueFromPayload,
} from "@/app/balancer/components/balancer-page-helpers";

export const BALANCE_EDITOR_ROLE_CAPACITY: Record<BalancerRosterKey, number> = {
  Tank: 1,
  Damage: 2,
  Support: 2,
};

export const BALANCE_EDITOR_ROLE_LABELS: Record<BalancerRosterKey, string> = {
  Tank: "Tank",
  Damage: "Damage",
  Support: "Support",
};

export const BALANCE_EDITOR_ROLE_ACCENTS: Record<BalancerRosterKey, { text: string }> = {
  Tank: { text: "text-sky-300" },
  Damage: { text: "text-orange-300" },
  Support: { text: "text-emerald-300" },
};

export type BalancePlayerLocation = {
  teamIndex: number;
  roleKey: BalancerRosterKey;
  playerIndex: number;
};

export type BalanceDropTarget =
  | {
      kind: "role-container";
      teamIndex: number;
      roleKey: BalancerRosterKey;
    }
  | {
      kind: "insert-slot";
      teamIndex: number;
      roleKey: BalancerRosterKey;
      insertIndex: number;
    }
  | {
      kind: "player-row";
      teamIndex: number;
      roleKey: BalancerRosterKey;
      playerIndex: number;
      playerId: string;
    };

export function cloneBalancePayload(payload: InternalBalancePayload): InternalBalancePayload {
  return JSON.parse(JSON.stringify(payload)) as InternalBalancePayload;
}

export function findBalancePlayerLocation(
  payload: InternalBalancePayload,
  playerId: string,
): BalancePlayerLocation | null {
  for (const [teamIndex, team] of payload.teams.entries()) {
    for (const roleKey of Object.keys(team.roster) as BalancerRosterKey[]) {
      const playerIndex = team.roster[roleKey].findIndex((player) => player.uuid === playerId);
      if (playerIndex >= 0) {
        return { teamIndex, roleKey, playerIndex };
      }
    }
  }

  return null;
}

export function parseBalanceDropContainerId(
  containerId: string,
): { teamIndex: number; roleKey: BalancerRosterKey } | null {
  const [teamIndexRaw, roleKeyRaw] = containerId.split(":");
  if (!teamIndexRaw || !roleKeyRaw) {
    return null;
  }
  if (!["Tank", "Damage", "Support"].includes(roleKeyRaw)) {
    return null;
  }

  return {
    teamIndex: Number(teamIndexRaw),
    roleKey: roleKeyRaw as BalancerRosterKey,
  };
}

export function resolveBalanceDropTarget(
  overId: string | null,
  data: unknown,
): BalanceDropTarget | null {
  if (typeof data === "object" && data !== null && "kind" in data) {
    if (
      data.kind === "role-container" &&
      "teamIndex" in data &&
      "roleKey" in data
    ) {
      return data as BalanceDropTarget;
    }

    if (
      data.kind === "insert-slot" &&
      "teamIndex" in data &&
      "roleKey" in data &&
      "insertIndex" in data
    ) {
      return data as BalanceDropTarget;
    }

    if (
      data.kind === "player-row" &&
      "teamIndex" in data &&
      "roleKey" in data &&
      "playerIndex" in data &&
      "playerId" in data
    ) {
      return data as BalanceDropTarget;
    }
  }

  if (!overId) {
    return null;
  }

  const parsedContainer = parseBalanceDropContainerId(overId);
  if (!parsedContainer) {
    return null;
  }

  return {
    kind: "role-container",
    teamIndex: parsedContainer.teamIndex,
    roleKey: parsedContainer.roleKey,
  };
}

export function parseInternalBalancePlayerId(player: InternalBalancePlayer): number | null {
  const parsed = Number(player.uuid);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getDraggedBalancePlayer(
  payload: InternalBalancePayload,
  playerId: string,
): { player: InternalBalancePlayer; roleKey: BalancerRosterKey } | null {
  const location = findBalancePlayerLocation(payload, playerId);
  if (!location) {
    return null;
  }

  return {
    player: payload.teams[location.teamIndex].roster[location.roleKey][location.playerIndex],
    roleKey: location.roleKey,
  };
}

export function moveBalancePlayer(
  payload: InternalBalancePayload,
  activeId: string,
  target: BalanceDropTarget | null,
): InternalBalancePayload | null {
  if (!target) {
    return null;
  }

  const from = findBalancePlayerLocation(payload, activeId);
  if (!from) {
    return null;
  }

  const next = cloneBalancePayload(payload);
  const sourcePlayers = next.teams[from.teamIndex].roster[from.roleKey];
  const [player] = sourcePlayers.splice(from.playerIndex, 1);
  if (!player) {
    return null;
  }

  const targetPlayers = next.teams[target.teamIndex].roster[target.roleKey];

  if (target.kind === "insert-slot") {
    const insertIndex =
      from.teamIndex === target.teamIndex &&
      from.roleKey === target.roleKey &&
      target.insertIndex > from.playerIndex
        ? target.insertIndex - 1
        : target.insertIndex;

    if (
      from.teamIndex === target.teamIndex &&
      from.roleKey === target.roleKey &&
      insertIndex === from.playerIndex
    ) {
      return null;
    }

    if (
      from.teamIndex !== target.teamIndex ||
      from.roleKey !== target.roleKey
    ) {
      if (targetPlayers.length >= BALANCE_EDITOR_ROLE_CAPACITY[target.roleKey]) {
        return null;
      }

      applyAssignedRolePreference(player, target.roleKey);
    }

    targetPlayers.splice(Math.min(insertIndex, targetPlayers.length), 0, player);
    return recalculateBalancePayloadStats(next);
  }

  if (target.kind === "player-row") {
    if (
      from.teamIndex === target.teamIndex &&
      from.roleKey === target.roleKey &&
      from.playerIndex === target.playerIndex
    ) {
      return null;
    }

    if (from.teamIndex === target.teamIndex && from.roleKey === target.roleKey) {
      const insertIndex = Math.min(target.playerIndex, sourcePlayers.length);
      sourcePlayers.splice(insertIndex, 0, player);
      return recalculateBalancePayloadStats(next);
    }

    if (targetPlayers.length < BALANCE_EDITOR_ROLE_CAPACITY[target.roleKey]) {
      applyAssignedRolePreference(player, target.roleKey);
      targetPlayers.splice(Math.min(target.playerIndex, targetPlayers.length), 0, player);
      return recalculateBalancePayloadStats(next);
    }

    const targetPlayer = targetPlayers[target.playerIndex];
    if (!targetPlayer) {
      return null;
    }

    targetPlayers.splice(target.playerIndex, 1, player);
    sourcePlayers.splice(from.playerIndex, 0, targetPlayer);
    applyAssignedRolePreference(player, target.roleKey);
    applyAssignedRolePreference(targetPlayer, from.roleKey);
    return recalculateBalancePayloadStats(next);
  }

  if (from.teamIndex === target.teamIndex && from.roleKey === target.roleKey) {
    if (from.playerIndex === sourcePlayers.length) {
      return null;
    }

    sourcePlayers.push(player);
    return recalculateBalancePayloadStats(next);
  }

  if (targetPlayers.length >= BALANCE_EDITOR_ROLE_CAPACITY[target.roleKey]) {
    return null;
  }

  applyAssignedRolePreference(player, target.roleKey);
  targetPlayers.push(player);

  return recalculateBalancePayloadStats(next);
}

function applyAssignedRolePreference(
  player: InternalBalancePlayer,
  roleKey: BalancerRosterKey,
) {
  player.preferences = [
    roleKey,
    ...player.preferences.filter((preference) => preference !== roleKey),
  ];
}

function recalculateBalancePayloadStats(
  next: InternalBalancePayload,
): InternalBalancePayload {
  next.teams = next.teams.map((team) => ({
    ...team,
    avgMMR: calculateTeamAverageValueFromPayload(team),
  }));

  if (next.statistics) {
    next.statistics.averageMMR =
      next.teams.reduce(
        (sum, team) => sum + calculateTeamAverageValueFromPayload(team),
        0,
      ) / next.teams.length;
  }

  return next;
}
