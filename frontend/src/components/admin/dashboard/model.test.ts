import { describe, expect, it } from "vitest";

import { auditEntityHref, groupAuditActivity, issueHref } from "@/components/admin/dashboard/model";
import type { AuditLogRead } from "@/types/admin.types";
import type { DashboardIssue } from "@/types/admin-dashboard.types";

let nextId = 1;
function row(actor: number | null, action: string, entityId: number | null = 1, entityType = "registration"): AuditLogRead {
  return {
    id: nextId++,
    created_at: "2026-10-20T12:00:00Z",
    workspace_id: 1,
    actor_auth_user_id: actor,
    actor_label: actor == null ? null : `admin${actor}`,
    source: actor == null ? "challonge" : "admin",
    action,
    entity_type: entityType,
    entity_id: entityId,
    entity_label: null,
    before_json: null,
    after_json: null,
    reason: null,
    ip_address: null,
    user_agent: null,
    correlation_id: null
  };
}

const shape = (rows: AuditLogRead[]) =>
  groupAuditActivity(rows).map((group) => [group.head.actor_auth_user_id, group.head.action, group.count]);

describe("groupAuditActivity", () => {
  it("merges a run of the same actor and action into one counted group", () => {
    const groups = groupAuditActivity([
      row(2, "registration.approve", 10),
      row(2, "registration.approve", 11),
      row(2, "registration.approve", 12)
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].sameEntity).toBe(false);
  });

  it("splits the same actor doing a different action", () => {
    expect(shape([row(2, "registration.approve"), row(2, "registration.reject")])).toEqual([
      [2, "registration.approve", 1],
      [2, "registration.reject", 1]
    ]);
  });

  it("splits a different actor doing the same action", () => {
    expect(shape([row(2, "registration.approve"), row(3, "registration.approve")])).toEqual([
      [2, "registration.approve", 1],
      [3, "registration.approve", 1]
    ]);
  });

  it("does not merge a repeat that someone else interrupted", () => {
    expect(
      shape([row(2, "registration.approve"), row(3, "team.update"), row(2, "registration.approve")])
    ).toEqual([
      [2, "registration.approve", 1],
      [3, "team.update", 1],
      [2, "registration.approve", 1]
    ]);
  });

  it("splits the same action on a different entity type", () => {
    expect(groupAuditActivity([row(2, "x.update", 1, "team"), row(2, "x.update", 1, "player")])).toHaveLength(2);
  });

  it("keeps a run on one entity linkable and stops at the limit", () => {
    const [single] = groupAuditActivity([row(2, "tournament.update", 7, "tournament"), row(2, "tournament.update", 7, "tournament")]);
    expect(single.sameEntity).toBe(true);
    expect(auditEntityHref(single.head)).toBe("/admin/tournaments/7");

    const many = Array.from({ length: 20 }, (_, index) => row(index + 1, "team.update"));
    expect(groupAuditActivity(many, 15)).toHaveLength(15);
  });
});

describe("auditEntityHref", () => {
  it("links only entities with a page, never prototype keys", () => {
    expect(auditEntityHref({ entity_type: "user", entity_id: 4 })).toBe("/admin/people/4");
    expect(auditEntityHref({ entity_type: "registration", entity_id: 4 })).toBeNull();
    expect(auditEntityHref({ entity_type: "toString", entity_id: 4 })).toBeNull();
    expect(auditEntityHref({ entity_type: "team", entity_id: null })).toBeNull();
  });
});

describe("issueHref", () => {
  // The generated key type is a TS enum; the test speaks the wire values.
  const issue = (key: string) => ({ key: key as DashboardIssue["key"], tournament_id: 9 });

  it("sends each issue to the hub screen that fixes it", () => {
    expect(issueHref(issue("results_disputed"))).toBe("/admin/tournaments/9/matches/reports?result_status=disputed");
    expect(issueHref(issue("pool_need_fix"))).toBe("/admin/tournaments/9/teams/roster");
    expect(issueHref(issue("achievements_pending"))).toBe("/admin/achievements");
  });
});
