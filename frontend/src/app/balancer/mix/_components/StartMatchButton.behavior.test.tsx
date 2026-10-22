// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StartMatchButton } from "./StartMatchButton";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () =>
    Object.assign((key: string, values?: Record<string, unknown>) => (values ? `${key}:${Object.values(values).join(",")}` : key), {
      has: () => false,
    }),
}));

async function mount(props: Partial<Parameters<typeof StartMatchButton>[0]> & { onStart: (flip: boolean) => void }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(<StartMatchButton awayNames={[]} opener={null} starting={false} {...props} />);
  });
  return container;
}

const click = (element: Element | null) => act(async () => (element as HTMLElement).click());
const button = (label: string) => [...document.querySelectorAll("button")].find((node) => node.textContent?.includes(label)) ?? null;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("StartMatchButton", () => {
  it("starts at once when there are no bans and nobody is away", async () => {
    const onStart = vi.fn();
    await mount({ onStart });
    await click(button("startMatch"));
    expect(onStart).toHaveBeenCalledWith(false);
  });

  it("names who bans first and lets the host swap it", async () => {
    const onStart = vi.fn();
    await mount({ onStart, opener: { names: ["Wolves", "Ravens"], index: 1 } });
    await click(button("startMatch"));
    expect(document.body.textContent).toContain("opener:Ravens");

    await click(document.querySelector('[role="switch"]'));
    expect(document.body.textContent).toContain("opener:Wolves");
    await click(button("startConfirm"));
    expect(onStart).toHaveBeenCalledWith(true);
  });
});
