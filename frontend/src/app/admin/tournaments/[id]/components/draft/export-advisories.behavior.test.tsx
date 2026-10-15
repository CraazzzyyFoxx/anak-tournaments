// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notify } from "@/lib/notify";
import draftService from "@/services/draft.service";
import type { DraftBoard, DraftSession } from "@/types/draft.types";
import { DraftHistoryPanel } from "./DraftHistoryPanel";
import { LifecycleControls } from "./LifecycleControls";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/datetime/client", () => ({ useFormatter: () => ({ dateTime: () => "Today" }) }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), warning: vi.fn(), apiError: vi.fn() } }));
vi.mock("@/services/draft.service", () => ({ default: { listSessions: vi.fn(), lifecycle: vi.fn() } }));
vi.mock("@/components/kit/ConfirmDialog", () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <button onClick={onConfirm}>Confirm export</button> : null
}));

const session = { id: 7, status: "completed", format: "snake", rounds: 4, created_at: null } as DraftSession;
const advisories = [
  "Alpha: skipped Missing#1234 (not found)",
  "Alpha: team_format_violation: starters_out_of_range"
];
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

async function settle() {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

async function mount(node: ReactNode) {
  await act(async () => { root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); });
  await settle();
}

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
  await settle();
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.mocked(draftService.listSessions).mockResolvedValue([session]);
  vi.mocked(draftService.lifecycle).mockResolvedValue({ ...session, advisories } as DraftSession);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

describe("draft export advisories", () => {
  it.each(["history", "controls"])("shows skipped names and format warnings from %s", async (surface) => {
    await mount(surface === "history"
      ? <DraftHistoryPanel tournamentId={5} onSessionDeleted={() => {}} />
      : <LifecycleControls tournamentId={5} board={{ session, current_pick: null, picks: [] } as unknown as DraftBoard} />);
    await click("actions.export");
    if (surface === "controls") await click("Confirm export");
    await vi.waitFor(() => expect(notify.warning).toHaveBeenCalled());
    expect(notify.warning).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      description: advisories.join("\n"), duration: Infinity
    }));
    expect(notify.success).not.toHaveBeenCalled();
  });

  it("keeps a clean export as a success", async () => {
    vi.mocked(draftService.lifecycle).mockResolvedValue({ ...session, advisories: [] } as DraftSession);
    await mount(<DraftHistoryPanel tournamentId={5} onSessionDeleted={() => {}} />);
    await click("actions.export");
    await vi.waitFor(() => expect(notify.success).toHaveBeenCalled());
    expect(notify.warning).not.toHaveBeenCalled();
  });
});
