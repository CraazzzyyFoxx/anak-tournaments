import { afterEach, describe, expect, it, vi } from "vitest";

import { notificationHref } from "@/lib/notifications/href";
import type { NotificationItem } from "@/types/notification.types";

const item: NotificationItem = {
  id: 1,
  audience: "user",
  kind: "registration.approved",
  payload: {},
  workspace_id: null,
  published_at: "2026-09-08T00:00:00Z",
  expires_at: null,
  is_read: false
};

afterEach(() => vi.unstubAllEnvs());

describe("notification destinations", () => {
  it("opens the participant surface from numeric tournament snapshots", () => {
    for (const kind of [
      "team_invite.received",
      "registration.approved",
      "registration.rejected",
      "team.kicked",
      "team.rejected",
      "team.disbanded",
    ]) {
      expect(notificationHref({ ...item, kind, payload: { tournament_id: 42 } })).toBe(
        "/tournaments/42/participants"
      );
    }
  });

  it("opens the room where captains can correct disputed map reports", () => {
    expect(
      notificationHref({
        ...item,
        kind: "encounter.report_disputed",
        payload: { tournament_id: 42, encounter_id: 87, map_id: 3, map_index: 1 }
      })
    ).toBe("/tournaments/42/pregame/87");
    expect(
      notificationHref({
        ...item,
        kind: "encounter.report_disputed",
        payload: { encounter_id: 87 }
      })
    ).toBeNull();
    expect(
      notificationHref({
        ...item,
        kind: "encounter.report_disputed",
        payload: { tournament_id: 42, encounter_id: "87/../../admin" }
      })
    ).toBeNull();
    // The staff twin lands in the same room — that is where the organizer
    // controls that end the dispute live.
    expect(
      notificationHref({
        ...item,
        kind: "encounter.dispute_review",
        payload: { tournament_id: 42, encounter_id: 87, position: 0, team_names: ["A", "B"] }
      })
    ).toBe("/tournaments/42/pregame/87");
  });

  it("opens the pregame room for a scheduled match, and the tournament for an opened phase", () => {
    expect(
      notificationHref({
        ...item,
        kind: "encounter.scheduled",
        payload: {
          tournament_id: 42,
          encounter_id: 87,
          scheduled_at: "2026-09-25T18:00:00Z",
          team_names: ["A", "B"]
        }
      })
    ).toBe("/tournaments/42/pregame/87");
    for (const kind of ["registration.opened", "check_in.opened"]) {
      expect(
        notificationHref({ ...item, kind, payload: { tournament_id: 42, tournament_name: "Cup" } })
      ).toBe("/tournaments/42");
      expect(notificationHref({ ...item, kind, payload: { tournament_name: "Cup" } })).toBeNull();
    }
  });

  // The bell is read on whatever host the reader is on, often another community's, where the mix is not
  // reachable; so the room link is the platform's, like the Discord DM's `PUBLIC_SITE_URL` link.
  it("sends a mix captain to the lobby's own room on the platform host", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://platform.test");
    // Dynamic on purpose: `config/site` reads the env at module load, like the production build inlines it.
    const { notificationHref: platformHref } = await import("@/lib/notifications/href");
    for (const kind of ["mix.ban_room_opened", "mix.draft_started"]) {
      expect(
        platformHref({ ...item, kind, workspace_id: 5, payload: { custom_game_id: 12, mix_name: "Friday", lobby: "B" } })
      ).toBe("https://platform.test/balancer/mix/12/lobby/B");
      expect(platformHref({ ...item, kind, payload: { custom_game_id: 12, lobby: "../admin" } })).toBeNull();
      expect(platformHref({ ...item, kind, payload: { custom_game_id: "12", lobby: "B" } })).toBeNull();
      expect(platformHref({ ...item, kind, payload: { lobby: "B" } })).toBeNull();
    }
  });

  it("rejects malformed IDs instead of coercing wire values into routes", () => {
    for (const tournament_id of [
      undefined,
      null,
      "42",
      "../../admin",
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1
    ]) {
      expect(notificationHref({ ...item, payload: { tournament_id } })).toBeNull();
    }
  });

  it("never substitutes unrelated team routes or system-provided hrefs", () => {
    expect(
      notificationHref({
        ...item,
        kind: "team_invite.answered",
        payload: { team_id: 7, invite_id: 9, answer: "accepted", href: "/teams/7" }
      })
    ).toBeNull();
    expect(
      notificationHref({ ...item, kind: "future.kind", payload: { href: "/admin" } })
    ).toBeNull();
    expect(notificationHref({ ...item, payload: { href: "/admin" } })).toBeNull();
  });

  it("uses the existing safe announcement link contract", () => {
    const announcement = { ...item, kind: "announcement.published" };
    expect(
      notificationHref({ ...announcement, payload: { href: "https://example.com/news" } })
    ).toBe("https://example.com/news");
    expect(notificationHref({ ...announcement, payload: { href: "/news" } })).toBe("/news");
    expect(
      notificationHref({ ...announcement, payload: { href: "javascript:alert(1)" } })
    ).toBeNull();
    expect(notificationHref({ ...announcement, payload: { href: "//example.com" } })).toBeNull();
  });
});
