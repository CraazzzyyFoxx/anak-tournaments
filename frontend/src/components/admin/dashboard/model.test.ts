import { describe, expect, it } from "vitest";

import {
  auditEntityHref,
  dayLabel,
  groupAuditActivity,
  groupByDay,
  issueHref
} from "@/components/admin/dashboard/model";
import { formatterFor } from "@/lib/datetime/formatter";
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

describe("groupByDay and dayLabel", () => {
  // Moscow is UTC+3 all year: 21:00Z is the viewer's midnight, not UTC's.
  const format = formatterFor("en", "Europe/Moscow");
  const words = { today: "Today", tomorrow: "Tomorrow", yesterday: "Yesterday" };

  it("splits runs on the viewer's midnight", () => {
    const at = ["2026-10-24T20:30:00Z", "2026-10-24T21:30:00Z", "2026-10-24T22:30:00Z", "2026-10-26T09:00:00Z"];

    expect(groupByDay(at, (value) => value, format).map((day) => day.items)).toEqual([
      [at[0]],
      [at[1], at[2]],
      [at[3]]
    ]);
  });

  it("names the days around now in the viewer's zone and dates the rest", () => {
    const now = new Date("2026-10-24T09:00:00Z");
    const label = (iso: string) => dayLabel(format, new Date(iso), now, words);

    expect(label("2026-10-24T20:59:00Z")).toBe("Today");
    expect(label("2026-10-24T21:00:00Z")).toBe("Tomorrow");
    expect(label("2026-10-23T08:00:00Z")).toBe("Yesterday");
    expect(label("2026-10-27T10:00:00Z")).toBe("Tue, Oct 27");
  });
});
