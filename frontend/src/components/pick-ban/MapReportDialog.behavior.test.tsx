// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { ApiError } from "@/lib/api/error";
import { notify } from "@/lib/notify";
import type { PickBanGame } from "@/types/tournament.types";

import { MapReportDialog } from "./MapReportDialog";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const reportGame = vi.fn();
vi.mock("@/services/pickBan.service", () => ({
  default: { reportGame: (...args: unknown[]) => reportGame(...args), selectGameMap: vi.fn() }
}));
vi.mock("@/lib/notify", () => ({
  notify: { apiError: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }
}));

const REPORT = en.pickBan.room.mapReport;
const HOME = 71;
const AWAY = 72;
const GAME: PickBanGame = {
  id: 901,
  position: 1,
  map_id: 21,
  state: "awaiting_result",
  result_source: null,
  result_version: 1,
  confirmed_at: null,
  results: [],
  claims: []
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function submitRefusedWith(code: string) {
  reportGame.mockRejectedValue(new ApiError(409, [{ msg: "server text", code }]));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en}>
          <MapReportDialog
            encounterId={4242}
            game={GAME}
            mapName="Summoner's Rift"
            seats={[
              { id: HOME, slot: 1, name: "Bright Wolves" },
              { id: AWAY, slot: 2, name: "Quiet Foxes" }
            ]}
            viewerTeamId={HOME}
            open
            onOpenChange={() => undefined}
            invalidateKeys={[]}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  const submit = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === REPORT.submit
  );
  await act(async () => submit!.click());
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

describe("a refused map report", () => {
  it("explains that the map's sides are chosen in the room first", async () => {
    await submitRefusedWith("side_pick_required");

    expect(reportGame).toHaveBeenCalledWith(4242, 901, expect.objectContaining({ basis_version: 1 }));
    expect(notify.error).toHaveBeenCalledWith(REPORT.failed, {
      description: REPORT.errors.side_pick_required
    });
    expect(notify.apiError).not.toHaveBeenCalled();
  });

  it("leaves a side refusal it has no sentence for to the server's own message", async () => {
    await submitRefusedWith("side_locked");

    expect(notify.apiError).toHaveBeenCalledWith(expect.any(ApiError), { title: REPORT.failed });
    expect(notify.error).not.toHaveBeenCalled();
  });
});
