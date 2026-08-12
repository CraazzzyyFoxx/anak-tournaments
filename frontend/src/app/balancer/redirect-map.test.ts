import { describe, expect, test } from "vitest";

import { balancerRedirectTarget, searchParamsFromRecord } from "./redirect-map";

const params = (init: Record<string, string> = {}) => new URLSearchParams(init);

describe("balancerRedirectTarget", () => {
  test("statuses always goes to the admin statuses route", () => {
    expect(balancerRedirectTarget("/balancer/statuses", params())).toBe("/admin/balancer");
    expect(balancerRedirectTarget("/balancer/statuses", params({ tournament: "7" }))).toBe(
      "/admin/balancer"
    );
  });

  test("registrations without ?tournament= points at the tournament list", () => {
    expect(balancerRedirectTarget("/balancer/registrations", params())).toBe("/admin/tournaments");
  });

  test("registrations with ?tournament= goes to the hub registration tab", () => {
    expect(balancerRedirectTarget("/balancer/registrations", params({ tournament: "12" }))).toBe(
      "/admin/tournaments/12/registration"
    );
  });

  test("registrations carries status/source/group filters (SK-O5)", () => {
    expect(
      balancerRedirectTarget(
        "/balancer/registrations",
        params({ tournament: "12", status: "approved", source: "google_sheets", group: "A" })
      )
    ).toBe("/admin/tournaments/12/registration?status=approved&source=google_sheets&group=A");
  });

  test("registrations drops unknown params", () => {
    expect(
      balancerRedirectTarget("/balancer/registrations", params({ tournament: "12", page: "3" }))
    ).toBe("/admin/tournaments/12/registration");
  });

  test.each([
    ["/balancer/registrations/form", "form"],
    ["/balancer/registrations/rank-autofill", "rank-autofill"],
    ["/balancer/registrations/feed", "feed"],
  ])("%s goes to the hub sub-route", (path, sub) => {
    expect(balancerRedirectTarget(path, params({ tournament: "12", status: "approved" }))).toBe(
      `/admin/tournaments/12/registration/${sub}`
    );
    expect(balancerRedirectTarget(path, params())).toBe("/admin/tournaments");
  });

  test("pool goes to the hub registration tab", () => {
    expect(balancerRedirectTarget("/balancer/pool", params({ tournament: "12" }))).toBe(
      "/admin/tournaments/12/registration"
    );
    expect(balancerRedirectTarget("/balancer/pool", params())).toBe("/admin/tournaments");
  });

  test("applications goes to the registration tab pre-filtered by sheets source", () => {
    expect(balancerRedirectTarget("/balancer/applications", params({ tournament: "12" }))).toBe(
      "/admin/tournaments/12/registration?source=google_sheets"
    );
    expect(balancerRedirectTarget("/balancer/applications", params())).toBe("/admin/tournaments");
  });

  test("unknown balancer paths fall back to the tournament list", () => {
    expect(balancerRedirectTarget("/balancer/unknown", params({ tournament: "12" }))).toBe(
      "/admin/tournaments"
    );
  });
});

describe("searchParamsFromRecord", () => {
  test("takes the first value of repeated params and skips missing ones", () => {
    const params = searchParamsFromRecord({
      tournament: "12",
      status: ["approved", "pending"],
      group: undefined,
    });
    expect(params.get("tournament")).toBe("12");
    expect(params.get("status")).toBe("approved");
    expect(params.has("group")).toBe(false);
  });
});
