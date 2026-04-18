"use client";

import { useMemo } from "react";
import { Pencil, FileEdit } from "lucide-react";

import type { Encounter } from "@/types/encounter.types";
import type { StageType } from "@/types/tournament.types";

interface BracketViewProps {
  encounters: Encounter[];
  type: StageType;
  onEdit?: (encounter: Encounter) => void;
  onReport?: (encounter: Encounter) => void;
  canEdit?: (encounter: Encounter) => boolean;
  canReport?: (encounter: Encounter) => boolean;
}

interface MatchNodeData {
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  winner: "home" | "away" | null;
  isCompleted: boolean;
}

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  data: MatchNodeData;
  encounter: Encounter;
}

interface LayoutEdge {
  id: string;
  path: string;
  isCompleted: boolean;
}

interface LayoutHeader {
  id: string;
  x: number;
  y: number;
  label: string;
  section: "upper" | "lower";
}

interface RoundGroup {
  round: number;
  matches: Encounter[];
}

interface BracketLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  headers: LayoutHeader[];
  width: number;
  height: number;
}

const CARD_WIDTH = 198;
const CARD_HEIGHT = 60;
const CARD_ROW_HEIGHT = 30;
const ROUND_GAP_X = 42;
const MATCH_GAP_Y = 10;
const HEADER_HEIGHT = 24;
const SECTION_GAP_Y = 52;
const PADDING_X = 16;
const PADDING_Y = 14;

const COMPLETED_STATUSES = new Set(["completed", "finished", "closed"]);
const NAME_SEPARATORS = [" vs. ", " vs ", " VS ", " - ", " v "];

function sortMatches(matches: Encounter[]) {
  return [...matches].sort((left, right) => {
    const leftKey = left.stage_item_id ?? left.challonge_id ?? left.id;
    const rightKey = right.stage_item_id ?? right.challonge_id ?? right.id;

    return leftKey - rightKey;
  });
}

function buildRoundGroups(matches: Encounter[]) {
  const groups = new Map<number, Encounter[]>();

  for (const match of matches) {
    const existing = groups.get(match.round) ?? [];
    existing.push(match);
    groups.set(match.round, existing);
  }

  return [...groups.entries()]
    .sort((left, right) => Math.abs(left[0]) - Math.abs(right[0]))
    .map(([round, roundMatches]) => ({
      round,
      matches: sortMatches(roundMatches),
    }));
}

function splitEncounterName(name: string | null | undefined) {
  const value = name?.trim();

  if (!value) {
    return { homeName: null, awayName: null };
  }

  for (const separator of NAME_SEPARATORS) {
    if (!value.includes(separator)) {
      continue;
    }

    const [homeName, awayName] = value
      .split(separator, 2)
      .map((part) => part.trim());

    if (homeName && awayName) {
      return { homeName, awayName };
    }
  }

  return { homeName: null, awayName: null };
}

function getMatchNames(match: Encounter) {
  const parsed = splitEncounterName(match.name);

  return {
    homeName: match.home_team?.name?.trim() || parsed.homeName || "TBD",
    awayName: match.away_team?.name?.trim() || parsed.awayName || "TBD",
  };
}

function getWinner(match: Encounter): "home" | "away" | null {
  if (!COMPLETED_STATUSES.has(match.status)) {
    return null;
  }

  if (match.score.home === match.score.away) {
    return null;
  }

  return match.score.home > match.score.away ? "home" : "away";
}

function buildPath(source: LayoutNode, target: LayoutNode) {
  const startX = source.x + CARD_WIDTH;
  const startY = source.y + CARD_HEIGHT / 2;
  const endX = target.x;
  const endY = target.y + CARD_HEIGHT / 2;
  const middleX = startX + ROUND_GAP_X / 2;

  return `M ${startX} ${startY} H ${middleX} V ${endY} H ${endX}`;
}

function createNode(match: Encounter, x: number, y: number): LayoutNode {
  const names = getMatchNames(match);

  return {
    id: `match-${match.id}`,
    x,
    y,
    data: {
      homeName: names.homeName,
      awayName: names.awayName,
      homeScore: match.score.home,
      awayScore: match.score.away,
      winner: getWinner(match),
      isCompleted: COMPLETED_STATUSES.has(match.status),
    },
    encounter: match,
  };
}

function addSequentialEdges(
  groups: RoundGroup[],
  nodesById: Map<string, LayoutNode>,
  edges: LayoutEdge[],
  mapper: (matchIndex: number, targetCount: number) => number
) {
  for (let groupIndex = 0; groupIndex < groups.length - 1; groupIndex++) {
    const current = groups[groupIndex].matches;
    const next = groups[groupIndex + 1].matches;

    for (let matchIndex = 0; matchIndex < current.length; matchIndex++) {
      const targetIndex = mapper(matchIndex, next.length);

      if (targetIndex < 0 || targetIndex >= next.length) {
        continue;
      }

      const sourceNode = nodesById.get(`match-${current[matchIndex].id}`);
      const targetNode = nodesById.get(`match-${next[targetIndex].id}`);

      if (!sourceNode || !targetNode) {
        continue;
      }

      edges.push({
        id: `edge-${current[matchIndex].id}-${next[targetIndex].id}`,
        path: buildPath(sourceNode, targetNode),
        isCompleted: COMPLETED_STATUSES.has(current[matchIndex].status),
      });
    }
  }
}

function buildLayout(
  encounters: Encounter[],
  type: StageType
): BracketLayout {
  const hasBracketConnections =
    type === "single_elimination" || type === "double_elimination";
  const upperRounds = buildRoundGroups(encounters.filter((match) => match.round > 0));
  const lowerRounds =
    type === "double_elimination"
      ? buildRoundGroups(encounters.filter((match) => match.round < 0))
      : [];

  const maxColumns = Math.max(upperRounds.length, lowerRounds.length, 1);
  const contentWidth =
    maxColumns * CARD_WIDTH + Math.max(maxColumns - 1, 0) * ROUND_GAP_X;
  const width =
    PADDING_X * 2 +
    contentWidth;

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const headers: LayoutHeader[] = [];

  const upperBaseMatches =
    upperRounds[0]?.matches.length ??
    Math.max(1, ...upperRounds.map((group) => group.matches.length));
  const upperBasePitch = CARD_HEIGHT + MATCH_GAP_Y;
  const upperSectionHeight = Math.max(
    upperBaseMatches * CARD_HEIGHT + Math.max(upperBaseMatches - 1, 0) * MATCH_GAP_Y,
    CARD_HEIGHT
  );
  const upperStartX = PADDING_X;
  const upperHeaderY = PADDING_Y;
  const upperTop = upperHeaderY + HEADER_HEIGHT;

  upperRounds.forEach((group, columnIndex) => {
    const x = upperStartX + columnIndex * (CARD_WIDTH + ROUND_GAP_X);
    const totalHeight =
      group.matches.length * CARD_HEIGHT +
      Math.max(group.matches.length - 1, 0) * MATCH_GAP_Y;
    const startY = upperTop + Math.max(0, (upperSectionHeight - totalHeight) / 2);

    headers.push({
      id: `upper-header-${group.round}`,
      x,
      y: upperHeaderY,
      label: `Round ${group.round}`,
      section: "upper",
    });

    group.matches.forEach((match, matchIndex) => {
      nodes.push(createNode(match, x, startY + matchIndex * upperBasePitch));
    });
  });

  const hasLowerBracket = lowerRounds.length > 0;
  const lowerHeaderY = upperTop + upperSectionHeight + (hasLowerBracket ? SECTION_GAP_Y : 0);
  const lowerTop = lowerHeaderY + HEADER_HEIGHT;
  const maxLowerMatches = Math.max(1, ...lowerRounds.map((group) => group.matches.length));
  const lowerSectionHeight = hasLowerBracket
    ? Math.max(
        maxLowerMatches * CARD_HEIGHT + Math.max(maxLowerMatches - 1, 0) * MATCH_GAP_Y,
        CARD_HEIGHT
      )
    : 0;
  const lowerStartX = PADDING_X;

  lowerRounds.forEach((group, columnIndex) => {
    const x = lowerStartX + columnIndex * (CARD_WIDTH + ROUND_GAP_X);
    const totalHeight =
      group.matches.length * CARD_HEIGHT +
      Math.max(group.matches.length - 1, 0) * MATCH_GAP_Y;
    const startY = lowerTop + Math.max(0, (lowerSectionHeight - totalHeight) / 2);

    headers.push({
      id: `lower-header-${group.round}`,
      x,
      y: lowerHeaderY,
      label: `Lower R${Math.abs(group.round)}`,
      section: "lower",
    });

    group.matches.forEach((match, matchIndex) => {
      nodes.push(createNode(match, x, startY + matchIndex * (CARD_HEIGHT + MATCH_GAP_Y)));
    });
  });

  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  if (hasBracketConnections) {
    addSequentialEdges(upperRounds, nodesById, edges, (matchIndex, targetCount) => {
      const targetIndex = Math.floor(matchIndex / 2);

      return targetIndex < targetCount ? targetIndex : -1;
    });

    addSequentialEdges(lowerRounds, nodesById, edges, (matchIndex, targetCount) => {
      if (targetCount === 0) {
        return -1;
      }

      return Math.min(matchIndex, targetCount - 1);
    });
  }

  const height = hasLowerBracket
    ? lowerTop + lowerSectionHeight + PADDING_Y
    : upperTop + upperSectionHeight + PADDING_Y;

  return {
    nodes,
    edges,
    headers,
    width,
    height,
  };
}

function MatchCard({ data }: { data: MatchNodeData }) {
  const hasVisibleScore =
    data.isCompleted || data.homeScore !== 0 || data.awayScore !== 0;

  const getRowClasses = (side: "home" | "away") => {
    if (data.winner === side) {
      return "bg-emerald-950/70 text-emerald-50";
    }

    if (data.winner && data.winner !== side) {
      return "bg-black/10 text-white/45";
    }

    return "bg-transparent text-white/82";
  };

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/45 shadow-[0_12px_30px_rgba(0,0,0,0.28)] ring-1 ring-white/6 backdrop-blur-sm">
      <div
        className={`flex items-center justify-between gap-2 border-b border-white/10 px-3 transition-colors ${getRowClasses("home")}`}
        style={{ height: CARD_ROW_HEIGHT }}
      >
        <span className="min-w-0 truncate text-[13px] font-medium">{data.homeName}</span>
        <span className="shrink-0 text-[13px] font-semibold tabular-nums">
          {hasVisibleScore ? data.homeScore : "-"}
        </span>
      </div>
      <div
        className={`flex items-center justify-between gap-2 px-3 transition-colors ${getRowClasses("away")}`}
        style={{ height: CARD_ROW_HEIGHT }}
      >
        <span className="min-w-0 truncate text-[13px] font-medium">{data.awayName}</span>
        <span className="shrink-0 text-[13px] font-semibold tabular-nums">
          {hasVisibleScore ? data.awayScore : "-"}
        </span>
      </div>
    </div>
  );
}

function resultStatusBadge(encounter: Encounter) {
  const status = encounter.result_status;
  if (!status || status === "none") return null;
  if (status === "confirmed") return null;
  const label =
    status === "pending_confirmation"
      ? "Ожидает"
      : status === "disputed"
        ? "Спор"
        : status;
  const color =
    status === "pending_confirmation"
      ? "bg-amber-500/80"
      : status === "disputed"
        ? "bg-red-500/80"
        : "bg-white/40";
  return (
    <span
      className={`absolute left-1 top-1 rounded px-1 text-[9px] font-semibold uppercase text-white ${color}`}
    >
      {label}
    </span>
  );
}

export function BracketView({
  encounters,
  type,
  onEdit,
  onReport,
  canEdit,
  canReport,
}: BracketViewProps) {
  const layout = useMemo(() => buildLayout(encounters, type), [encounters, type]);

  if (layout.nodes.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        No bracket matches to display
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/25">
      <div className="max-h-[78vh] overflow-auto">
        <div
          className="relative min-w-full"
          style={{
            width: layout.width,
            height: layout.height,
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.08) 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        >
          <svg
            className="pointer-events-none absolute inset-0"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            fill="none"
          >
            {layout.edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.path}
                stroke={
                  edge.isCompleted
                    ? "rgba(16, 185, 129, 0.55)"
                    : "rgba(255, 255, 255, 0.18)"
                }
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>

          {layout.headers.map((header) => (
            <div
              key={header.id}
              className="absolute"
              style={{ left: header.x, top: header.y, width: CARD_WIDTH }}
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/75">
                <span
                  className={`h-2 w-2 rounded-full ${
                    header.section === "upper" ? "bg-emerald-400" : "bg-sky-400"
                  }`}
                />
                <span>{header.label}</span>
              </div>
            </div>
          ))}

          {layout.nodes.map((node) => {
            const editable = onEdit && (canEdit?.(node.encounter) ?? true);
            const reportable = onReport && (canReport?.(node.encounter) ?? false);
            return (
              <div
                key={node.id}
                className="absolute group"
                style={{ left: node.x, top: node.y, width: CARD_WIDTH, height: CARD_HEIGHT }}
              >
                <MatchCard data={node.data} />
                {resultStatusBadge(node.encounter)}
                {(editable || reportable) && (
                  <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {editable && (
                      <button
                        type="button"
                        className="rounded bg-black/70 p-1 text-white hover:bg-black"
                        aria-label="Редактировать матч"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit?.(node.encounter);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    {reportable && (
                      <button
                        type="button"
                        className="rounded bg-emerald-700/90 p-1 text-white hover:bg-emerald-600"
                        aria-label="Репорт матча"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReport?.(node.encounter);
                        }}
                      >
                        <FileEdit className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
