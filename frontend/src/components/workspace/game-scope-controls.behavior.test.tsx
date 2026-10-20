// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { DisciplineDescriptor } from "@/types/discipline.types";

import { DisciplineUnavailable } from "./DisciplineUnavailable";
import { GameField } from "./GameField";
import { GameMark } from "./GameMark";
import { GameTabs } from "./GameTabs";
import { useGameBoundParams, useScopePillOpen } from "./scope-pill-store";

vi.mock("next/image", () => ({
  default: ({ unoptimized: _unoptimized, ...props }: ComponentProps<"img"> & { unoptimized?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element -- this IS the next/image stand-in
    <img {...props} alt={props.alt ?? ""} />
  )
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const game = (code: string, name: string, short_name: string, enabled = true) =>
  ({ code, name, short_name, icon: null, enabled }) as DisciplineDescriptor;
const OW = game("overwatch", "Overwatch", "OW");
const LOL = game("lol", "League of Legends", "LoL");
const OFF = game("chess", "Chess", "CH", false);

let root: Root;
let container: HTMLElement;

async function render(node: ReactNode) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        {node}
      </NextIntlClientProvider>
    )
  );
}

const tick = () => new Promise<void>((done) => setTimeout(done, 0));

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("GameMark", () => {
  it("draws the game's monogram when it has no icon, and names the game unless decorative", async () => {
    await render(
      <>
        <GameMark discipline={OW} />
        <GameMark discipline={LOL} decorative />
      </>
    );
    const [named, decorative] = [...container.querySelectorAll("span")];
    expect(named?.getAttribute("role")).toBe("img");
    expect(named?.getAttribute("aria-label")).toBe("Overwatch");
    expect(named?.textContent).toBe("OW");
    expect(decorative?.getAttribute("aria-hidden")).toBe("true");
    expect(decorative?.getAttribute("role")).toBeNull();
    expect(decorative?.textContent).toBe("LoL");
  });

  it("draws the icon, and falls back to the monogram when the icon fails to load", async () => {
    await render(<GameMark discipline={{ ...OW, icon: "/disciplines/overwatch/icon.svg" }} />);
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/disciplines/overwatch/icon.svg");

    await act(async () => {
      image?.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("OW");
  });
});

describe("GameTabs", () => {
  const tabs = () => [...container.querySelectorAll<HTMLElement>('[role="tab"]')];

  it("offers the enabled games as tabs, marks the selected one and reports a press", async () => {
    const onSelect = vi.fn();
    await render(<GameTabs games={[OW, LOL, OFF]} value="overwatch" onSelect={onSelect} label="Game" />);

    expect(container.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Game");
    expect(tabs().map((tab) => tab.textContent)).toEqual(["OWOverwatch", "LoLLeague of Legends"]);
    expect(tabs()[0]?.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      tabs()[1]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    expect(onSelect).toHaveBeenCalledWith("lol");
  });

  it("is keyboard operable: arrows move between games without picking, and Enter picks one", async () => {
    const onSelect = vi.fn();
    await render(<GameTabs games={[OW, LOL]} value="overwatch" onSelect={onSelect} label="Game" />);

    await act(async () => tabs()[0]?.focus());
    await act(async () => {
      tabs()[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await tick();
    });
    expect(document.activeElement).toBe(tabs()[1]);
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      tabs()[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("lol");
  });
});

describe("GameField", () => {
  const radios = () => [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];

  it("lists the enabled games under its label, checks the value and reports a pick", async () => {
    const onChange = vi.fn();
    await render(<GameField games={[OW, LOL, OFF]} value="lol" onChange={onChange} id="game" />);

    const group = container.querySelector('[role="radiogroup"]');
    expect(document.getElementById(group?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Game");
    expect(container.querySelector("#game [role='radiogroup']")).toBe(group);
    expect(radios().map((radio) => radio.textContent)).toEqual(["OWOverwatch", "LoLLeague of Legends"]);
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true"]);

    await act(async () => radios()[0]?.click());
    expect(onChange).toHaveBeenCalledWith("overwatch");
  });

  it("takes no pick when the checked game is pressed again, a reselect or a deselect attempt alike", async () => {
    const onChange = vi.fn();
    await render(<GameField games={[OW, LOL]} value="lol" onChange={onChange} />);

    await act(async () => radios()[1]?.click());
    await act(async () => radios()[1]?.click());

    expect(onChange).not.toHaveBeenCalled();
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  });

  it("checks nothing without a value and takes no pick once locked", async () => {
    const onChange = vi.fn();
    await render(<GameField games={[OW, LOL]} value={null} onChange={onChange} disabled />);

    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false"]);
    expect(radios().every((radio) => radio.disabled)).toBe(true);
    await act(async () => radios()[1]?.click());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("DisciplineUnavailable", () => {
  it("names an invalid request with the page's way out, and says when no game is enabled", async () => {
    await render(
      <DisciplineUnavailable
        game={{ kind: "invalid", requested: "starcraft", reason: "unknown" }}
        action={<button type="button">Show all games</button>}
      />
    );
    expect(container.textContent).toContain("Unknown game selection");
    expect(container.textContent).toContain('"starcraft" is not an installed game.');
    expect(container.querySelector("button")?.textContent).toBe("Show all games");
    await act(async () => root.unmount());

    await render(<DisciplineUnavailable game={{ kind: "empty" }} />);
    expect(container.textContent).toContain("No games available");
  });
});

describe("useGameBoundParams", () => {
  function Page({ params }: Readonly<{ params: readonly string[] }>) {
    useGameBoundParams(params);
    return null;
  }

  const rerender = (node: ReactNode) =>
    act(async () =>
      root.render(
        <NextIntlClientProvider locale="en" messages={en}>
          {node}
        </NextIntlClientProvider>
      )
    );

  it("registers the page's game-bound params while it is mounted, keeps them for an equal list and clears them after", async () => {
    useScopePillOpen.setState({ gameBoundParams: [] });
    await render(<Page params={["role", "division"]} />);
    const registered = useScopePillOpen.getState().gameBoundParams;
    expect(registered).toEqual(["role", "division"]);

    // A new array with the same params (a re-render's literal) is not a new registration.
    await rerender(<Page params={["role", "division"]} />);
    expect(useScopePillOpen.getState().gameBoundParams).toBe(registered);

    await rerender(<Page params={["map"]} />);
    expect(useScopePillOpen.getState().gameBoundParams).toEqual(["map"]);

    await rerender(<span />);
    expect(useScopePillOpen.getState().gameBoundParams).toEqual([]);
  });
});
