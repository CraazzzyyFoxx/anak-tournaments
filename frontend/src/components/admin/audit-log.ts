import adminService from "@/services/admin.service";
import type { AuditLogRead, AuditSource } from "@/types/admin.types";

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
const ENTITY_LABELS = {
  api_key: "API key",
  auth_user: "Account",
  encounter: "Encounter",
  oauth_connection: "OAuth connection",
  permission: "Permission",
  player: "Player",
  player_sub_role: "Sub-role",
  registration: "Registration",
  role: "Role",
  stage: "Stage",
  stage_item: "Stage item",
  stage_item_input: "Stage item input",
  standing: "Standing",
  team: "Team",
  tournament: "Tournament",
  workspace: "Workspace",
} as const satisfies Record<string, string>;

/** The `entity_type` values a per-entity trail may be opened for. */
export type AuditEntityType = keyof typeof ENTITY_LABELS;

/**
 * `Object.hasOwn`, not `in`: `"toString" in ENTITY_LABELS` is true through the
 * prototype, and a URL carrying `?history=toString:1:1` must not pass for a real
 * entity type.
 */
export function isAuditEntityType(value: string | undefined | null): value is AuditEntityType {
  return value != null && Object.hasOwn(ENTITY_LABELS, value);
}

/**
 * Verbs the generic CRUD dispatcher emits across its ten writable entities. Kept
 * as a verb map rather than 26 spelled-out entries so `tournament.delete` and
 * `stage_item_input.update` cannot drift apart in wording.
 */
const VERB_LABELS: Record<string, string> = {
  create: "created",
  update: "updated",
  delete: "deleted",
};

/**
 * Actions whose phrase is not `<entity> <verb>`: the identity flows and the
 * workspace flows. Every key is a call site that exists — nothing aspirational.
 * A phrase for an action nobody writes is worse than none, because the next
 * reader takes its presence as evidence the event is recorded somewhere.
 */
const ACTION_PHRASES: Record<string, string> = {
  "api_key.revoke": "API key revoked",
  "auth_user.delete": "Account deleted",
  "linked_player.assign": "Player linked to an account",
  "linked_player.remove": "Player unlinked from an account",
  "oauth_connection.delete": "OAuth connection removed",
  "permission_deny.add": "Permission denied to a user",
  "permission_deny.remove": "Permission deny lifted",
  // Soft deactivation, not a hard delete (`deactivate_sub_role`): a reader who
  // acts on "deleted" would go looking for a row that is still there.
  "player_sub_role.delete": "Sub-role deactivated",
  "role.assign": "Role granted to a user",
  "role.remove": "Role taken from a user",
  // Registration lifecycle. The bespoke admin handlers write these; only
  // create/update/delete fall out of `<entity> <verb>` on their own.
  "registration.approve": "Registration approved",
  "registration.balancer_include": "Registration added to the balancer pool",
  "registration.balancer_status": "Registration balancer status changed",
  // Bulk rows are filed on the tournament, not the registration: the phrase has
  // to say so, or a reader takes the target for the row that changed.
  "registration.bulk_approve": "Registrations approved in bulk",
  "registration.bulk_balancer_include": "Registrations added to the balancer pool in bulk",
  "registration.bulk_balancer_status": "Registration balancer statuses changed in bulk",
  "registration.check_in": "Registration checked in",
  "registration.check_in_undo": "Registration check-in undone",
  "registration.rank_autofill": "Registration ranks autofilled",
  "registration.reject": "Registration rejected",
  "registration.restore": "Registration restored",
  "registration.withdraw": "Registration withdrawn",
  "workspace.branding_update": "Workspace branding changed",
  // Kept alongside `domain_set`: clearing a custom domain is its own endpoint
  // with its own security meaning, and takes a workspace off its own hostname.
  "workspace.domain_clear": "Custom domain removed",
  "workspace.domain_set": "Custom domain set",
  "workspace.domain_verified": "Custom domain verified",
};

const AUDIT_SOURCE_LABELS: Record<AuditSource, string> = {
  admin: "Admin panel",
  challonge: "Challonge sync",
  discord: "Discord",
  scheduler: "Scheduler",
  system: "System",
};

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

export function describeAuditAction(action: string): AuditActionDescription {
  const phrase = ACTION_PHRASES[action];
  if (phrase) return { label: phrase, raw: action, recognised: true };

  // Split on the LAST dot: `stage_item_input.update` has a dotless entity, but a
  // future `workspace.discord.unlink` would put the verb last all the same.
  const separator = action.lastIndexOf(".");
  const subject = separator === -1 ? action : action.slice(0, separator);
  const verb = separator === -1 ? "" : action.slice(separator + 1);

  const noun = isAuditEntityType(subject) ? ENTITY_LABELS[subject] : undefined;
  const verbLabel = VERB_LABELS[verb];

  if (noun && verbLabel) return { label: `${noun} ${verbLabel}`, raw: action, recognised: true };
  if (noun) return { label: `${noun} — ${humanizeToken(verb).toLowerCase()}`, raw: action, recognised: false };

  const derived = [humanizeToken(subject), humanizeToken(verb).toLowerCase()].filter(Boolean).join(" — ");
  return { label: derived || action || "Unknown action", raw: action, recognised: false };
}

export function auditEntityLabel(entityType: string | null): string | null {
  if (!entityType) return null;
  return isAuditEntityType(entityType) ? ENTITY_LABELS[entityType] : humanizeToken(entityType);
}

export function auditSourceLabel(source: string): string {
  return AUDIT_SOURCE_LABELS[source as AuditSource] ?? humanizeToken(source);
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
): string {
  if (isMachineActor(entry)) return `${auditSourceLabel(entry.source)} (automated)`;
  return entry.actor_label ?? `User #${entry.actor_auth_user_id}`;
}

/** The entity a row is about, named as well as the snapshot allows. */
export function formatAuditTarget(
  entry: Pick<AuditLogRead, "entity_type" | "entity_id" | "entity_label">,
): string | null {
  const noun = auditEntityLabel(entry.entity_type);
  if (!noun) return null;
  if (entry.entity_label) return `${noun} “${entry.entity_label}”`;
  if (entry.entity_id != null) return `${noun} #${entry.entity_id}`;
  return noun;
}

export function formatAuditTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/** Day only — for "history starts on …", where the clock time says nothing. */
export function formatAuditDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" });
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
  /** Rendered value, or `null` when the side does not carry the field. */
  before: string | null;
  after: string | null;
}

/** Compact, readable rendering. Strings stay bare so they are not double-quoted. */
function formatAuditValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") return value.length > 0 ? value : "(empty)";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
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
 * One row per field that actually differs.
 *
 * Writers assemble `before`/`after` from named domain fields, so a key missing
 * from a populated side is a real fact rather than a gap in the capture — but a
 * side that is absent ENTIRELY is a gap, and the two get different kinds.
 */
export function auditDiffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditDiffRow[] {
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();

  const rows: AuditDiffRow[] = [];
  for (const field of fields) {
    const inBefore = before != null && field in before;
    const inAfter = after != null && field in after;
    const beforeValue = inBefore ? before[field] : undefined;
    const afterValue = inAfter ? after[field] : undefined;

    if (inBefore && inAfter) {
      if (sameValue(beforeValue, afterValue)) continue;
      rows.push({
        field,
        kind: "changed",
        before: formatAuditValue(beforeValue),
        after: formatAuditValue(afterValue),
      });
    } else if (inAfter) {
      rows.push({
        field,
        // No before-image at all versus a before-image that simply lacked this key.
        kind: before == null ? "set" : "added",
        before: null,
        after: formatAuditValue(afterValue),
      });
    } else {
      rows.push({ field, kind: "removed", before: formatAuditValue(beforeValue), after: null });
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
    queryKey: ["admin", "audit", "history-start", allWorkspaces ? "all" : workspaceId] as const,
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
    queryKey: [
      "admin",
      "audit",
      "count",
      scope.workspaceId,
      scope.entityType,
      scope.entityId,
    ] as const,
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
