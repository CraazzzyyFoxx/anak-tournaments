// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en.json";
import { ScrimCreateDialog } from "./ScrimCreateDialog";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn().mockResolvedValue([]) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/services/tournament.service", () => ({ default: { lookup } }));

// Community 3 plays League only, community 4 Overwatch only; each game has its own map catalogue.
const GAMES: Record<number, { code: string; name: string }> = {
  3: { code: "lol", name: "League of Legends" },
  4: { code: "overwatch", name: "Overwatch" }
};
const MAPS: Record<string, { id: number; name: string; attrs: Record<string, unknown> }[]> = {
  lol: [{ id: 101, name: "Summoner's Rift", attrs: {} }],
  overwatch: [{ id: 7, name: "Ilios", attrs: {} }]
};
vi.mock("@/services/discipline.service", () => ({
  default: {
    list: async (axis: number) => [
      { ...GAMES[axis], enabled: true, kinds: {}, character_classes: [], identity_provider: null, capabilities: {} }
    ]
  }
}));
vi.mock("@/hooks/useCatalogEntities", () => ({
  useCatalogEntities: (discipline: string | null, kind: string) => ({
    data: kind === "map" && discipline ? MAPS[discipline] : [],
    isPending: false
  })
}));

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Radix's Select reaches for pointer-capture and scroll APIs happy-dom does not
// implement. Without these the trigger throws before the listbox ever opens.
for (const [name, value] of Object.entries({
  hasPointerCapture: () => false,
  setPointerCapture: () => undefined,
  releasePointerCapture: () => undefined,
  scrollIntoView: () => undefined
})) {
  if (!(name in Element.prototype)) {
    Object.defineProperty(Element.prototype, name, { value, writable: true });
  }
}

async function press(element: Element | null | undefined) {
  await act(async () => {
    element?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    (element as HTMLElement | null | undefined)?.click();
  });
}

/** The required community picker is a Radix Select: open its trigger, then pick the option. */
const COMMUNITY_PICKER = 'button[role="combobox"][aria-required="true"]';

async function chooseCommunity(name: string) {
  await press(document.body.querySelector(COMMUNITY_PICKER));
  await press(
    [...document.body.querySelectorAll('[role="option"]')].find((option) => option.textContent?.trim() === name)
  );
}

it("starts all-mode creation without a local fallback and scopes lookup only after explicit choice", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <QueryClientProvider client={client}>
            <ScrimCreateDialog workspaceId={null} workspaces={[
              { id: 3, name: "Community A" }, { id: 4, name: "Community B" }
            ]} />
          </QueryClientProvider>
        </NextIntlClientProvider>
      );
    });
    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const chooser = document.body.querySelector(COMMUNITY_PICKER);
    expect(chooser).not.toBeNull();
    expect(chooser?.hasAttribute("data-placeholder")).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
    const submit = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === messages.scrims.create.submit
    );
    expect(submit?.disabled).toBe(true);
    await chooseCommunity("Community B");
    expect(lookup).toHaveBeenCalledWith(4);
    expect(lookup).not.toHaveBeenCalledWith(3);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});

it("drops a custom pool chosen for one game when the community change switches the game", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const mapButton = (name: string) =>
    [...document.body.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((button) => button.textContent === name);
  try {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <QueryClientProvider client={client}>
            <ScrimCreateDialog workspaceId={null} workspaces={[
              { id: 3, name: "League club" }, { id: 4, name: "Overwatch club" }
            ]} />
          </QueryClientProvider>
        </NextIntlClientProvider>
      );
    });
    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const choose = async (name: string) => {
      await chooseCommunity(name);
      await settle();
      await settle();
    };
    await choose("League club");
    const custom = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === messages.scrims.create.sourceCustom
    );
    await act(async () => {
      custom?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      mapButton("Summoner's Rift")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mapButton("Summoner's Rift")?.getAttribute("aria-pressed")).toBe("true");

    // The workspace change is what moves the game from League to Overwatch: the League pick must not follow.
    await choose("Overwatch club");
    expect(mapButton("Summoner's Rift")).toBeUndefined();
    expect(mapButton("Ilios")?.getAttribute("aria-pressed")).toBe("false");
    expect(document.body.textContent).not.toContain(messages.scrims.pool.selectedCount.replace("{count}", "1"));

    // ...and back: the League pool is not remembered either.
    await choose("League club");
    expect(mapButton("Summoner's Rift")?.getAttribute("aria-pressed")).toBe("false");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});
