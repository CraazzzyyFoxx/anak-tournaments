import { useTranslations } from "next-intl";

import type { DateFormatter } from "@/components/kit/format-time";

import adminService from "@/services/admin.service";
import type { AuditLogRead, AuditSource } from "@/types/admin.types";
import { adminQueryKeys } from "@/lib/admin/query-keys";

/**
 * Vocabulary and field-diff helpers shared by the audit feed and the per-entity
 * `AuditTrail`.
 *
 * `action` is `String(64)` written from every service on the platform, not a
 * closed enum, so it is NEVER printed raw: an operator reading `permission_deny.add`
 * has to translate it, and a typo in a call site would look like a real event.
 * The dictionary below is deliberately allowed to lag new call sites — that is
 * what `describeAuditAction`'s derived fallback is for, and why it reports
 * whether the phrase came from the dictionary or from the string itself.
 */

/**
 * Entity nouns, keyed by the `entity_type` the writers actually pair with their
 * actions. Only what is written today: `hero`/`map`/`gamemode`/`achievement` are
 * registered with the CRUD dispatcher but declare read-only actions, so they can
 * never produce a row, and a single-word `entity_type` derives correctly anyway.
 *
 * `as const` is load-bearing since the trail moved into a drawer: the keys ARE
 * the closed set a trail may be opened for (`AuditEntityType`), so a typo in a
 * call site fails the build instead of shipping a trail that silently queries an
 * `entity_type` nobody writes — whose empty state would then assert this entity
 * was never touched, the one claim the journal exists to be able to make truthfully.
 */
const ENTITY_TYPES = [
  "api_key",
  "auth_user",
  "division_grid",
  "encounter",
  "gamemode",
  "hero",
  "map",
  "match_log",
  "oauth_connection",
  "permission",
  "pick_ban",
  "player",
  "player_sub_role",
  "registration",
  "registration_status",
  "registration_team",
  "report_form",
  "role",
  "session",
  "setting",
  "social_account",
  "stage",
  "stage_item",
  "stage_item_input",
  "standing",
  "team",
  "tournament",
  "user",
  "workspace",
] as const;

/** The `entity_type` values a per-entity trail may be opened for. */
export type AuditEntityType = (typeof ENTITY_TYPES)[number];

/**
 * Every entity the feed can be narrowed to, in the order the chip offers them.
 *
 * `Object.keys` of the map above rather than a second hand-kept list: a writer
 * that starts recording a new entity gets its label and its filter option from
 * the same edit, so the two cannot drift.
 */
export const AUDIT_ENTITY_TYPES: readonly AuditEntityType[] = ENTITY_TYPES;

/**
 * A list lookup, not `in` on an object: `"toString" in {}` is true through the
 * prototype, and a URL carrying `?history=toString:1:1` must not pass for a real
 * entity type.
 */
function isAuditEntityType(value: string | undefined | null): value is AuditEntityType {
  return value != null && (ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * Verbs the generic CRUD dispatcher emits across its ten writable entities. Kept
 * as a verb map rather than 26 spelled-out entries so `tournament.delete` and
 * `stage_item_input.update` cannot drift apart in wording.
 */
const CRUD_VERBS = new Set(["create", "update", "delete"]);

/**
 * Actions whose phrase is not `<entity> <verb>`: the identity flows and the
 * workspace flows. Every key is a call site that exists — nothing aspirational.
 * A phrase for an action nobody writes is worse than none, because the next
 * reader takes its presence as evidence the event is recorded somewhere.
 */
/**
 * The `kitAudit.auditLog` messages. A plain call signature rather than next-intl's
 * typed one: action keys are derived from wire values at runtime, and `has`
 * is what tells a known action from a call site this build has never heard of.
 */
export interface AuditTranslator {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

export function useAuditTranslator(): AuditTranslator {
  return useTranslations("kitAudit.auditLog") as unknown as AuditTranslator;
}

/** `tournament.preview_access.add` → `actions.tournament_preview_access_add`: message keys cannot hold dots. */
function actionKey(action: string): string {
  return `actions.${action.replace(/\./g, "_")}`;
}

export interface AuditActionDescription {
  /** Human phrase to render. Never empty. */
  label: string;
  /** The wire value, for a `title` on a phrase we had to derive. */
  raw: string;
  /**
   * `false` when the phrase was derived from the string rather than looked up.
   * The UI marks these so a reader can tell a real event from a call site this
   * build has never heard of.
   */
  recognised: boolean;
}

/** `permission_deny_add` / `domain_set` → `Permission deny add` / `Domain set`. */
function humanizeToken(token: string): string {
  const words = token.replace(/[._-]+/g, " ").trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function describeAuditAction(action: string, t: AuditTranslator): AuditActionDescription {
  if (action && t.has(actionKey(action))) return { label: t(actionKey(action)), raw: action, recognised: true };

  // Split on the LAST dot: `stage_item_input.update` has a dotless entity, but a
  // future `workspace.discord.unlink` would put the verb last all the same.
  const separator = action.lastIndexOf(".");
  const subject = separator === -1 ? action : action.slice(0, separator);
  const verb = separator === -1 ? "" : action.slice(separator + 1);

  const noun = isAuditEntityType(subject) ? t(`entities.${subject}`) : undefined;

  if (noun && CRUD_VERBS.has(verb)) return { label: t(`crud.${verb}`, { entity: noun }), raw: action, recognised: true };
  if (noun) return { label: `${noun} · ${humanizeToken(verb).toLowerCase()}`, raw: action, recognised: false };

  const derived = [humanizeToken(subject), humanizeToken(verb).toLowerCase()].filter(Boolean).join(" · ");
  return { label: derived || action || t("unknownAction"), raw: action, recognised: false };
}

export function auditEntityLabel(entityType: string | null, t: AuditTranslator): string | null {
  if (!entityType) return null;
  return isAuditEntityType(entityType) ? t(`entities.${entityType}`) : humanizeToken(entityType);
}

const AUDIT_SOURCES: readonly AuditSource[] = ["admin", "api_key", "challonge", "discord", "scheduler", "system"];

export function auditSourceLabel(source: string, t: AuditTranslator): string {
  return (AUDIT_SOURCES as readonly string[]).includes(source) ? t(`sources.${source}`) : humanizeToken(source);
}

/**
 * A row with no actor id is a machine actor, not a lost one (FR3), so it gets
 * its own wording instead of an em dash that reads as missing data.
 */
export function isMachineActor(entry: Pick<AuditLogRead, "actor_auth_user_id">): boolean {
  return entry.actor_auth_user_id == null;
}

export function formatAuditActor(
  entry: Pick<AuditLogRead, "actor_auth_user_id" | "actor_label" | "source">,
  t: AuditTranslator,
): string {
  if (isMachineActor(entry)) return t("automated", { source: auditSourceLabel(entry.source, t) });
  return entry.actor_label ?? t("userId", { id: entry.actor_auth_user_id ?? "" });
}

/** The entity a row is about, named as well as the snapshot allows. */
export function formatAuditTarget(
  entry: Pick<AuditLogRead, "entity_type" | "entity_id" | "entity_label">,
  t: AuditTranslator,
): string | null {
  const noun = auditEntityLabel(entry.entity_type, t);
  if (!noun) return null;
  if (entry.entity_label) return t("target", { entity: noun, label: entry.entity_label });
  if (entry.entity_id != null) return t("targetId", { entity: noun, id: entry.entity_id });
  return noun;
}

export function formatAuditTimestamp(format: DateFormatter, value: string): string {
  return format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });
}

/** Day only — for "history starts on …", where the clock time says nothing. */
export function formatAuditDate(format: DateFormatter, value: string): string {
  return format.dateTime(new Date(value), { dateStyle: "medium" });
}

// ─── Field diff ──────────────────────────────────────────────────────────────

/**
 * `set` is the one that earns its keep. All ten CRUD entities go through service
 * hooks, and a service-backed `update` cannot read the row (a service-backed
 * entity may declare `model=None`), so it stages `after` alone with no
 * before-image at all. Calling those fields "added" would assert they did not
 * exist before — a claim about the past made from the absence of a capture,
 * which is exactly the class of false statement this journal exists to retire.
 */
export type AuditDiffKind = "added" | "removed" | "changed" | "set";

export interface AuditDiffRow {
  field: string;
  kind: AuditDiffKind;
  /** Rendered value, or `null` when the side does not carry the field or `children` breaks it down. */
  before: string | null;
  after: string | null;
  /**
   * Per-key breakdown of a nested value — a record, or a list of records such as
   * registration roles — so a one-rank edit reads as that rank instead of two
   * copies of the whole list.
   */
  children?: AuditDiffRow[];
}

type AuditRecord = Record<string, unknown>;

function isAuditRecord(value: unknown): value is AuditRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Compact, readable rendering. Strings stay bare so they are not double-quoted. */
function formatAuditValue(value: unknown, t: AuditTranslator): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "string") return value.length > 0 ? value : t("emptyValue");
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Tag lists and the like: `a, b` reads, `["a","b"]` is wire format.
  if (Array.isArray(value) && value.every((item) => typeof item !== "object" || item === null)) {
    return value.length > 0 ? value.map((item) => formatAuditValue(item, t)).join(", ") : t("noValues");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Keys that name a list element. Pairing by position would turn a removed first
 * role into a change to every role after it; pairing by `role` shows the one
 * that went.
 */
const IDENTITY_KEYS = ["id", "role", "provider", "key", "slug", "name"] as const;

function listIdentity(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  if (isAuditRecord(value) && typeof value.dimension === "string" && typeof value.role === "string") {
    return `${value.dimension}:${value.role}`;
  }
  return null;
}

/** Lists of records as records keyed by element identity, `#1…` when none holds. */
function keyedLists(lists: AuditRecord[][]): AuditRecord[] {
  const key = IDENTITY_KEYS.find((candidate) =>
    lists.every((list) => {
      const ids = list.map((item) => listIdentity(item[candidate]));
      return (
        ids.every((id) => typeof id === "string" || typeof id === "number") &&
        new Set(ids).size === ids.length
      );
    }),
  );
  return lists.map((list) =>
    Object.fromEntries(
      list.map((item, index) => {
        if (key == null) return [`#${index + 1}`, item];
        // The row is already labelled with it.
        const { [key]: id, ...rest } = item;
        return [String(listIdentity(id)), rest];
      }),
    ),
  );
}

/**
 * Both sides as records when the field holds a record or a list of records, or
 * `null` for a leaf. A missing or `null` side counts as empty, so `null → {…}`
 * lists what arrived.
 */
function nestedPair(before: unknown, after: unknown): [AuditRecord, AuditRecord] | null {
  const sides = [before, after].filter((side) => side != null);
  if (sides.length > 0 && sides.every(isAuditRecord)) {
    return [isAuditRecord(before) ? before : {}, isAuditRecord(after) ? after : {}];
  }
  const lists = sides.filter((side): side is AuditRecord[] => Array.isArray(side) && side.every(isAuditRecord));
  if (lists.length === sides.length && lists.some((list) => list.length > 0)) {
    const [keyedBefore, keyedAfter] = keyedLists([
      Array.isArray(before) ? before : [],
      Array.isArray(after) ? after : [],
    ]);
    return [keyedBefore, keyedAfter];
  }
  return null;
}

/** `undefined` is a side that does not carry the field. */
function diffRow(
  field: string,
  kind: AuditDiffKind,
  before: unknown,
  after: unknown,
  t: AuditTranslator,
): AuditDiffRow {
  const pair = nestedPair(before, after);
  // A `set` parent has no before-image, and neither do its parts.
  const children = pair ? auditDiffRows(kind === "set" ? null : pair[0], pair[1], t) : [];
  // Empty only when the parts match and the order alone moved: say it whole.
  if (children.length > 0) return { field, kind, before: null, after: null, children };
  return {
    field,
    kind,
    before: before === undefined ? null : formatAuditValue(before, t),
    after: after === undefined ? null : formatAuditValue(after, t),
  };
}

/**
 * One row per field that actually differs, nested values broken down per key.
 *
 * Writers assemble `before`/`after` from named domain fields, so a key missing
 * from a populated side is a real fact rather than a gap in the capture — but a
 * side that is absent ENTIRELY is a gap, and the two get different kinds.
 */
export function auditDiffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  t: AuditTranslator,
): AuditDiffRow[] {
  // Numeric-aware so `#10` and id `10` land after `9`.
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort(
    (a, b) => a.localeCompare(b, "en", { numeric: true }),
  );

  const rows: AuditDiffRow[] = [];
  for (const field of fields) {
    const inBefore = before != null && Object.hasOwn(before, field);
    const inAfter = after != null && Object.hasOwn(after, field);
    const beforeValue = inBefore ? before[field] : undefined;
    const afterValue = inAfter ? after[field] : undefined;

    if (inBefore && inAfter) {
      if (sameValue(beforeValue, afterValue)) continue;
      rows.push(diffRow(field, "changed", beforeValue, afterValue, t));
    } else if (inAfter) {
      // No before-image at all versus a before-image that simply lacked this key.
      rows.push(diffRow(field, before == null ? "set" : "added", undefined, afterValue, t));
    } else {
      rows.push(diffRow(field, "removed", beforeValue, undefined, t));
    }
  }
  return rows;
}

/** True when at least one row has no previous value on record, not "none". */
export function hasUncapturedBefore(rows: AuditDiffRow[]): boolean {
  return rows.some((row) => row.kind === "set");
}

// ─── Journal start date ──────────────────────────────────────────────────────

/**
 * Oldest row in the reader's scope, or `null` when the journal is empty.
 *
 * Load-bearing for the empty states: there is no backfill, so for the first
 * months most entities predate the journal entirely. Without this date an empty
 * trail reads as "nobody touched this", which is precisely the claim the audit
 * log exists to justify — and it would be false more often than true.
 *
 * Scoped exactly like the feed it explains: an organizer cannot query
 * platform-wide (the endpoint 422s without a workspace), and the workspace's own
 * first row is the honest answer for them anyway.
 */
export function auditHistoryStartQuery(scope: {
  workspaceId?: number | null;
  allWorkspaces?: boolean;
}) {
  const { workspaceId = null, allWorkspaces = false } = scope;

  return {
    queryKey: adminQueryKeys.auditHistoryStart(allWorkspaces ? "all" : workspaceId),
    queryFn: async (): Promise<string | null> => {
      const page = await adminService.listAudit({
        page: 1,
        per_page: 1,
        sort: "created_at",
        order: "asc",
        workspace_id: allWorkspaces ? null : workspaceId,
        allWorkspaces,
      });
      return page.results[0]?.created_at ?? null;
    },
    // The first row never moves once written; re-asking on every mount would
    // double the requests behind every trail on the page.
    staleTime: 10 * 60 * 1000,
  };
}

// ─── Per-entity trail scope ──────────────────────────────────────────────────

/**
 * One page of a trail. Ten fills the drawer without scrolling on a laptop, and
 * "Load more" costs one request rather than a page-size selector nobody tunes
 * while reading one entity's history top to bottom.
 */
export const AUDIT_TRAIL_PAGE_SIZE = 10;

/** The drawer's entire identity, and the only thing its URL param carries. */
export interface AuditTrailScope {
  entityType: AuditEntityType;
  entityId: number;
  /**
   * Passed explicitly rather than read from the ambient workspace store, so the
   * trail reads the journal the mutation was authorized against. A pasted link
   * has no component left to supply it, which is why it rides in the URL too.
   */
  workspaceId: number;
}

/** `?history=tournament:12:3` — deep-linkable, and cheap to parse. */
export const AUDIT_TRAIL_PARAM = "history";

export function encodeAuditTrailScope(scope: AuditTrailScope): string {
  return `${scope.entityType}:${scope.entityId}:${scope.workspaceId}`;
}

/**
 * `null` for anything that is not a scope we can honour — an unknown
 * `entity_type`, a non-numeric id, a truncated param. A bad link opens nothing;
 * it never opens a drawer pointed at an entity that cannot exist.
 */
export function parseAuditTrailScope(value: string | null | undefined): AuditTrailScope | null {
  if (!value) return null;

  const [entityType, rawEntityId, rawWorkspaceId] = value.split(":");
  if (!isAuditEntityType(entityType)) return null;

  const entityId = Number(rawEntityId);
  const workspaceId = Number(rawWorkspaceId);
  if (!Number.isInteger(entityId) || entityId <= 0) return null;
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) return null;

  return { entityType, entityId, workspaceId };
}

export function sameAuditTrailScope(
  a: AuditTrailScope | null,
  b: AuditTrailScope | null,
): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return (
    a.entityType === b.entityType &&
    a.entityId === b.entityId &&
    a.workspaceId === b.workspaceId
  );
}

export function auditTrailQueryKey(scope: AuditTrailScope) {
  return [
    "admin",
    "audit",
    "trail",
    scope.workspaceId,
    scope.entityType,
    scope.entityId,
  ] as const;
}

/**
 * `total` alone, for the badge on the trigger.
 *
 * Deliberately its own request rather than a peek at the trail's first page:
 * the drawer's pages are only fetched once it opens, and the whole point of the
 * badge is to tell a reader whether opening it is worth it. `per_page: 1` keeps
 * that promise cheap — one row on the wire, not ten.
 */
export function auditTrailCountQuery(scope: AuditTrailScope) {
  return {
    queryKey: adminQueryKeys.auditCount(scope.workspaceId, scope.entityType, scope.entityId),
    queryFn: async (): Promise<number> => {
      const page = await adminService.listAudit({
        workspace_id: scope.workspaceId,
        entity_type: scope.entityType,
        entity_id: scope.entityId,
        page: 1,
        per_page: 1,
      });
      return page.total;
    },
    // A refusal is not a retryable condition, and the badge simply stays absent.
    retry: false,
    staleTime: 60 * 1000,
  };
}
