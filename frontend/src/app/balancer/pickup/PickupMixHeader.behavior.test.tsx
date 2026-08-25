// @vitest-environment happy-dom
//
// Mix identity moved out of the teams column into the page header, so the
// contracts that used to be pinned there are pinned here:
//
//  1. the open mix is named with its id and status, so two mixes called
//     "Thursday scrim" are still tellable apart;
//  2. creating a mix trims the name and refuses an all-whitespace one, because
//     the server would accept it and leave an unnameable row in the picker;
//  3. the switcher is inert while there is nothing to switch to;
//  4. a viewer who cannot host gets no create form and no Add players.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomGame } from "@/services/custom-game.service";

import { PickupMixHeader } from "./PickupMixHeader";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const onSelectGame = vi.fn();
const onCreateGame = vi.fn();
const onOpenPool = vi.fn();

function game(overrides: Partial<CustomGame> = {}): CustomGame {
  return {
    id: 12,
    workspace_id: 7,
    host_user_id: 9,
    name: "Thursday scrim",
    status: "balanced",
    config_json: null,
    result_json: null,
    outcome_json: null,
    ...overrides,
  };
}

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

// Roots are unmounted rather than the body cleared: the create form lives in a
// portal, so a stale root and a wiped body raced into `removeChild` failures.
const roots: { unmount: () => void }[] = [];

async function mount(games: CustomGame[], props: { canEdit?: boolean } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    const root = createRoot(container);
    roots.push(root);
    root.render(
      <PickupMixHeader
        canEdit={props.canEdit ?? true}
        games={games}
        gamesLoading={false}
        game={games[0]}
        selectedGameId={games[0]?.id ?? null}
        onSelectGame={onSelectGame}
        creating={false}
        onCreateGame={onCreateGame}
        onOpenPool={onOpenPool}
      />,
    );
  });
  await act(async () => {
    await tick();
  });
  return container;
}

function click(node: Element | null | undefined) {
  if (!node) throw new Error("Expected a clickable node");
  return act(async () => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  });
}

function byName(scope: ParentNode, name: string) {
  return [...scope.querySelectorAll("button")].find((node) => node.textContent?.trim() === name) ?? null;
}

async function type(input: HTMLInputElement, value: string) {
  // Native setter, not `input.value =`: React's value tracker would otherwise
  // see no change and swallow the event.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
  });
}

/** happy-dom does not submit a form from a submit-button click. */
async function submit(form: Element | null) {
  if (!form) throw new Error("Expected a form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
  });
}

beforeEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    act(() => root?.unmount());
  }
  document.body.innerHTML = "";
  onSelectGame.mockReset();
  onCreateGame.mockReset();
  onOpenPool.mockReset();
});

describe("PickupMixHeader", () => {
  it("names the open mix with its id and status", async () => {
    const scope = await mount([game()]);

    expect(scope.textContent).toContain("Thursday scrim");
    expect(scope.textContent).toContain("#12");
    expect(scope.textContent).toContain("Balanced");
  });

  it("leaves the switcher inert while there is nothing to switch to", async () => {
    const single = await mount([game()]);
    expect(single.querySelector('[aria-label="Switch mix"]')?.hasAttribute("disabled")).toBe(true);

    const pair = await mount([game(), game({ id: 13, name: "Sunday scrim" })]);
    expect(pair.querySelector('[aria-label="Switch mix"]')?.hasAttribute("disabled")).toBe(false);
  });

  it("creates a mix under its trimmed name", async () => {
    const scope = await mount([game()]);

    await click(byName(scope, "New mix"));
    const input = document.querySelector<HTMLInputElement>("#pickup-new-mix");
    expect(input).not.toBeNull();

    await type(input as HTMLInputElement, "  Sunday scrim  ");
    await submit(input?.closest("form") ?? null);

    expect(onCreateGame).toHaveBeenCalledWith("Sunday scrim");
  });

  it("refuses a whitespace-only mix name", async () => {
    const scope = await mount([game()]);

    await click(byName(scope, "New mix"));
    await type(document.querySelector<HTMLInputElement>("#pickup-new-mix") as HTMLInputElement, "   ");

    expect(byName(document, "Create")?.hasAttribute("disabled")).toBe(true);
    expect(onCreateGame).not.toHaveBeenCalled();
  });

  it("gives a viewer who cannot host no way to write", async () => {
    const scope = await mount([game()], { canEdit: false });

    expect(byName(scope, "New mix")).toBeNull();
    expect(byName(scope, "Add players")).toBeNull();
    // Reading which mix is open is not a write.
    expect(scope.textContent).toContain("Thursday scrim");
  });

  it("opens the workspace pool on request", async () => {
    const scope = await mount([game()]);

    await click(byName(scope, "Add players"));

    expect(onOpenPool).toHaveBeenCalledTimes(1);
  });
});
