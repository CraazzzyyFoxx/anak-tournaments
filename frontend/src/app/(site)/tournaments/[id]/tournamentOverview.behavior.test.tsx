import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { HydrationBoundary } from "@tanstack/react-query";
import { Fragment, isValidElement, Suspense, type ReactElement } from "react";

import { ApiError } from "@/lib/api-error";
import tournamentService from "@/services/tournament.service";
import type { Tournament } from "@/types/tournament.types";

import TournamentOverviewBoundary from "./TournamentOverviewBoundary";

mock.module("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key
}));
mock.module("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key
}));
mock.module("@/lib/site-metadata", () => ({
  resolveSiteMetadata: async () => ({ name: "Test OWT", origin: "https://example.test" })
}));

const { default: TournamentLayout, generateMetadata } = await import("./layout");
const { default: TournamentIndexPage } = await import("./page");

const overviewFixture: Tournament = {
  id: 72,
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: null,
  workspace_id: 4,
  name: "Summer Clash",
  start_date: new Date("2026-07-15T12:00:00Z"),
  end_date: new Date("2026-07-16T12:00:00Z"),
  description: "Public tournament",
  challonge_id: null,
  challonge_slug: null,
  is_league: false,
  is_finished: false,
  is_hidden: false,
  team_formation: "balancer",
  status: "live",
  auto_transitions_enabled: true,
  allow_late_registration: false,
  phase_schedule: [],
  win_points: 3,
  draw_points: 1,
  loss_points: 0,
  stages: [],
  participants_count: 84,
  registrations_count: 96,
  teams_count: 12,
  division_grid_version_id: null,
  division_grid_version: null
};

const paramsFor = (id: string) => Promise.resolve({ id });
const afterTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
const invalidRawIds = [
  "not-a-number",
  "0",
  "-3",
  "2.5",
  "1e2",
  "0x48",
  "+72",
  "072",
  " 72",
  "72 ",
  "9007199254740992"
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function captureThrown(operation: () => Promise<unknown>) {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error;
  }
}

afterEach(() => {
  (tournamentService.getPublicOverview as { mockRestore?: () => void }).mockRestore?.();
});

describe("TournamentLayout streaming overview", () => {
  it("keeps the overview hydration boundary decoupled from the client shell while unresolved", async () => {
    const pendingOverview = deferred<Tournament>();
    const overviewSpy = spyOn(tournamentService, "getPublicOverview").mockReturnValue(
      pendingOverview.promise
    );
    const layoutPromise = TournamentLayout({ children: null, params: paramsFor("7301") });

    const firstResult = await Promise.race([
      layoutPromise.then((result) => ({ kind: "layout" as const, result })),
      afterTurn().then(() => ({ kind: "waiting" as const }))
    ]);

    if (firstResult.kind === "waiting") {
      pendingOverview.resolve({ ...overviewFixture, id: 7301 });
      await layoutPromise;
    }

    expect(firstResult.kind).toBe("layout");
    if (firstResult.kind !== "layout") return;
    expect(firstResult.result.type).toBe(Fragment);
    const [suspenseEl, clientLayoutEl] = (
      firstResult.result.props as { children: ReactElement[] }
    ).children;
    expect(suspenseEl.type).toBe(Suspense);
    const suspenseProps = suspenseEl.props as { fallback: unknown; children: ReactElement };
    // A re-suspended overview fetch must never blank/replace the client shell,
    // so the Suspense carries no fallback of its own.
    expect(suspenseProps.fallback).toBeNull();
    expect(overviewSpy).not.toHaveBeenCalled();
    // TournamentClientLayout is a sibling of the Suspense, not wrapped by it.
    expect(clientLayoutEl.type).not.toBe(Suspense);
    expect((clientLayoutEl.props as { children: unknown }).children).toBeNull();

    const boundaryPromise = TournamentOverviewBoundary(
      suspenseProps.children.props as Parameters<typeof TournamentOverviewBoundary>[0]
    );
    const boundaryBeforeOverview = await Promise.race([
      boundaryPromise.then(() => "resolved" as const),
      afterTurn().then(() => "waiting" as const)
    ]);

    expect(overviewSpy).toHaveBeenCalledTimes(1);
    expect(boundaryBeforeOverview).toBe("waiting");

    pendingOverview.resolve({ ...overviewFixture, id: 7301 });
    const hydrated = await boundaryPromise;
    expect(isValidElement(hydrated)).toBe(true);
    if (!isValidElement(hydrated)) throw new Error("Expected hydrated overview element");
    expect(hydrated.type).toBe(HydrationBoundary);
  });

  it("uses intentional streamed notFound control flow for an API 404", async () => {
    const overviewSpy = spyOn(tournamentService, "getPublicOverview").mockRejectedValue(
      new ApiError(404, [{ msg: "Tournament not found", code: "not_found" }])
    );

    const thrown = await captureThrown(() =>
      Promise.resolve(TournamentOverviewBoundary({ tournamentId: 7302 }))
    );

    expect(overviewSpy).toHaveBeenCalledTimes(1);
    expect(thrown).toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("returns nothing for a non-404 overview failure, deferring to the client shell's own retry", async () => {
    const overviewSpy = spyOn(tournamentService, "getPublicOverview").mockRejectedValue(
      new Error("upstream unavailable")
    );

    const result = await TournamentOverviewBoundary({ tournamentId: 7303 });

    expect(overviewSpy).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("hydrates a successful overview after the boundary resolves", async () => {
    const overviewSpy = spyOn(tournamentService, "getPublicOverview").mockResolvedValue({
      ...overviewFixture,
      id: 7304
    });

    const result = await TournamentOverviewBoundary({ tournamentId: 7304 });

    expect(overviewSpy).toHaveBeenCalledTimes(1);
    expect(isValidElement(result)).toBe(true);
    if (!isValidElement(result)) throw new Error("Expected a React element");
    expect(result.type).toBe(HydrationBoundary);
  });

  it("accepts canonical decimal id 72 without blocking the outer shell", async () => {
    const overviewSpy = spyOn(tournamentService, "getPublicOverview").mockResolvedValue(
      overviewFixture
    );

    const result = await TournamentLayout({ children: null, params: paramsFor("72") });

    expect(result.type).toBe(Fragment);
    expect(overviewSpy).not.toHaveBeenCalled();
  });


  for (const invalidId of invalidRawIds) {
    it(`rejects invalid id ${invalidId} before streaming without an API request`, async () => {
      const overviewSpy = spyOn(tournamentService, "getPublicOverview").mockResolvedValue(
        overviewFixture
      );

      const thrown = await captureThrown(() =>
        TournamentLayout({ children: null, params: paramsFor(invalidId) })
      );

      expect(overviewSpy).not.toHaveBeenCalled();
      expect(thrown).toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    });
  }

  it("returns fallback metadata for non-canonical ids without an overview request", async () => {
    const overviewSpy = spyOn(tournamentService, "getPublicOverview").mockResolvedValue(
      overviewFixture
    );

    for (const invalidId of invalidRawIds) {
      const metadata = await generateMetadata({ params: paramsFor(invalidId) });
      expect(metadata.title).toBe("tournamentDetail.metaTitleFallback | Test OWT");
    }

    expect(overviewSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-canonical index-route alias before loading or redirecting", async () => {
    const overviewSpy = spyOn(tournamentService, "getPublicOverview").mockResolvedValue(
      overviewFixture
    );

    const thrown = await captureThrown(() =>
      TournamentIndexPage({ params: paramsFor("0x48"), searchParams: Promise.resolve({}) })
    );

    expect(overviewSpy).not.toHaveBeenCalled();
    expect(thrown).toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});
