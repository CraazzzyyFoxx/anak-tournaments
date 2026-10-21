import type { RankOverviewContext, RankOverviewRow } from "@/services/workspace-player.service";

/** A role column: the game's role code, or `null` for a game whose rows carry none. */
export type RoleKey = string | null;

/** The current layers with a row of their own, in reading order. `effective_mix` only fills an author's gaps. */
export const MATRIX_LAYERS = ["effective_tournament", "canon", "native", "hidden"] as const;
export type MatrixLayer = (typeof MATRIX_LAYERS)[number];

export interface MatrixCell {
  row: RankOverviewRow;
  /** An author's role with no value of their own, shown as their mix book's effective value. */
  mix: boolean;
}

export interface MatrixLine {
  key: string;
  layer: MatrixLayer | "author";
  /** The author's name on an author line. */
  label: string | null;
  cells: Map<RoleKey, MatrixCell>;
  /** The source every cell shares; `null` when the cells differ or carry none. */
  source: RankOverviewRow["source"];
}

export interface RankMatrix {
  /** Only the roles some cell fills, in the game's order; a role the game does not know after, `null` last. */
  roles: RoleKey[];
  /** Only the layers with a value. */
  layers: MatrixLine[];
  /** One line per author, by name. */
  authors: MatrixLine[];
}

/** Orders roles as the game lists them; one it does not know goes after, the role-less column last. */
function roleRank(roleOrder: readonly string[]) {
  return (role: RoleKey) => {
    if (role === null) return Number.POSITIVE_INFINITY;
    const index = roleOrder.indexOf(role);
    return index === -1 ? roleOrder.length : index;
  };
}

/** A delta as a reader expects it: "+120", "-80", "0". */
export const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

/** The six current layers of one person in one game, pivoted to layer × role (the person hub's «Текущие ранги»). */
export function pivotCurrentRanks(rows: readonly RankOverviewRow[], roleOrder: readonly string[]): RankMatrix {
  const layers: MatrixLine[] = MATRIX_LAYERS.map((layer) => ({
    key: layer,
    layer,
    label: null,
    cells: new Map(),
    source: null
  }));
  const authors = new Map<number, MatrixLine>();

  for (const row of rows) {
    const index = MATRIX_LAYERS.indexOf(row.layer as MatrixLayer);
    if (index !== -1) {
      layers[index].cells.set(row.role, { row, mix: false });
    } else if (row.layer === "author" && row.author_user_id != null) {
      const id = row.author_user_id;
      let author = authors.get(id);
      if (!author) {
        author = {
          key: `author:${id}`,
          layer: "author",
          label: row.author_name ?? `#${id}`,
          cells: new Map(),
          source: null
        };
        authors.set(id, author);
      }
      author.cells.set(row.role, { row, mix: false });
    }
  }
  // An author's own number wins; only a role their book leaves open shows what a mix would seat them at.
  for (const row of rows) {
    if (row.layer !== "effective_mix" || row.author_user_id == null) continue;
    const author = authors.get(row.author_user_id);
    if (author && !author.cells.has(row.role)) author.cells.set(row.role, { row, mix: true });
  }

  const filled = [...layers.filter((entry) => entry.cells.size > 0), ...authors.values()];
  for (const entry of filled) {
    const sources = new Set([...entry.cells.values()].map((cell) => cell.row.source));
    entry.source = sources.size === 1 ? [...sources][0] : null;
  }

  const rank = roleRank(roleOrder);
  const roles = [...new Set(filled.flatMap((entry) => [...entry.cells.keys()]))].sort((a, b) => rank(a) - rank(b));

  return {
    roles,
    layers: filled.filter((entry) => entry.layer !== "author"),
    authors: [...authors.values()].sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""))
  };
}

export interface PastGroup {
  key: string;
  context: RankOverviewContext | null;
  /** A mix's book owner. */
  owner: string | null;
  /** The earliest and the latest record of the group. */
  first: string | null;
  last: string | null;
  /** In the game's role order. */
  registration: RankOverviewRow[];
  tournament: RankOverviewRow[];
  /** One run per role (game's role order), each in time order. */
  casual: RankOverviewRow[][];
}

const time = (at: string | null) => (at ? Date.parse(at) : Number.NEGATIVE_INFINITY);

/**
 * The history layers of one person in one game (`registration`, `tournament`, `casual`), one group per tournament or
 * mix (the context's kind + id, its label when it has no id), newest first by the group's latest record.
 */
export function groupPastRanks(rows: readonly RankOverviewRow[], roleOrder: readonly string[]): PastGroup[] {
  const groups = new Map<string, RankOverviewRow[]>();
  for (const row of rows) {
    const { context } = row;
    const key = context ? `${context.kind}:${context.id ?? context.label}` : "none";
    const members = groups.get(key);
    if (members) members.push(row);
    else groups.set(key, [row]);
  }

  const rank = roleRank(roleOrder);
  const byRole = (a: RankOverviewRow, b: RankOverviewRow) => rank(a.role) - rank(b.role);
  const byTime = (a: RankOverviewRow, b: RankOverviewRow) => time(a.at) - time(b.at);

  return [...groups.entries()]
    .map(([key, members]): PastGroup => {
      const chronological = [...members].sort(byTime);
      const casual = new Map<RoleKey, RankOverviewRow[]>();
      for (const row of chronological) {
        if (row.layer !== "casual") continue;
        const run = casual.get(row.role);
        if (run) run.push(row);
        else casual.set(row.role, [row]);
      }
      const context = members[0].context;
      return {
        key,
        context,
        owner: context?.kind === "mix" ? (members.find((row) => row.author_name)?.author_name ?? null) : null,
        first: chronological[0].at,
        last: chronological[chronological.length - 1].at,
        registration: members.filter((row) => row.layer === "registration").sort(byRole),
        tournament: members.filter((row) => row.layer === "tournament").sort(byRole),
        casual: [...casual.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([, run]) => run)
      };
    })
    .sort((a, b) => time(b.last) - time(a.last));
}
