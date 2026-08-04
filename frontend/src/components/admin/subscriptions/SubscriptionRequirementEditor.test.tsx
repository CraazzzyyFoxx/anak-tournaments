// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import SubscriptionRequirementEditor from "./SubscriptionRequirementEditor";
import type { SubscriptionRequirement } from "@/types/registration.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ONE: SubscriptionRequirement = {
  mode: "all",
  requirements: [{ provider: "boosty", min_tier_rank: 2 }]
};
const TWO: SubscriptionRequirement = {
  mode: "any",
  requirements: [
    { provider: "boosty", min_tier_rank: 2 },
    { provider: "twitch", min_tier_rank: 1 }
  ]
};

async function mount(
  value: SubscriptionRequirement,
  availableProviders: string[] = ["boosty", "twitch"]
) {
  const onChange = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <SubscriptionRequirementEditor
          value={value}
          onChange={onChange}
          availableProviders={availableProviders}
        />
      </NextIntlClientProvider>
    );
  });
  const click = async (predicate: (button: HTMLButtonElement) => boolean) => {
    const button = [...container.querySelectorAll("button")].find((candidate) =>
      predicate(candidate as HTMLButtonElement)
    ) as HTMLButtonElement | undefined;
    if (!button) throw new Error("button not found");
    await act(async () => {
      button.click();
    });
  };
  return { onChange, container, text: () => container.textContent ?? "", click };
}

describe("mode selector visibility", () => {
  it("is hidden for a single requirement — any and all would agree", async () => {
    const { text } = await mount(ONE);
    expect(text()).not.toContain("Match");
  });

  it("appears once a second provider is present", async () => {
    const { text } = await mount(TWO);
    expect(text()).toContain("Match");
  });
});

describe("rule preview", () => {
  it("spells out the composed rule with the conjunction", async () => {
    const { text } = await mount(TWO);
    // `any` must read as "или" so an organizer sees it is not a conjunction.
    expect(text()).toContain("Boosty уровень 2 или Twitch");
  });

  it("uses no conjunction for a single provider", async () => {
    const { text } = await mount(ONE);
    expect(text()).toContain("Boosty уровень 2");
    expect(text()).not.toContain(" или ");
  });

  it("warns that an empty selection leaves the gate inactive", async () => {
    const { text } = await mount({ mode: "all", requirements: [] });
    expect(text()).toContain("gate is inactive");
  });
});

describe("thresholds use each provider's own vocabulary", () => {
  it("labels boosty tiers as Уровень, never a bare integer", async () => {
    const { text } = await mount(ONE);
    expect(text()).toContain("Уровень 2+");
  });

  it("labels twitch tiers as Tier", async () => {
    const { text } = await mount({
      mode: "all",
      requirements: [{ provider: "twitch", min_tier_rank: 2 }]
    });
    expect(text()).toContain("Tier 2+");
  });
});

describe("unconfigured providers", () => {
  it("warns that the gate silently stops enforcing", async () => {
    const { text } = await mount(TWO, ["boosty"]);
    expect(text()).toContain("not configured for this workspace");
    expect(text()).toContain("fails open");
  });

  it("stays quiet when every provider is available", async () => {
    const { text } = await mount(TWO, ["boosty", "twitch"]);
    expect(text()).not.toContain("not configured for this workspace");
  });

  it("keeps an unavailable provider selected so opening the form does not rewrite the rule", async () => {
    const { container } = await mount(TWO, ["boosty"]);
    const selected = [
      ...container.querySelectorAll('button[role="combobox"][aria-label="Provider"]')
    ].map((trigger) => trigger.textContent?.trim());
    expect(selected).toContain("Twitch");
  });
});

describe("editing", () => {
  it("adds only a provider that is not already present", async () => {
    const { onChange, click } = await mount(ONE, ["boosty", "twitch"]);
    await click((button) => (button.textContent ?? "").includes("Add provider"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        requirements: [
          { provider: "boosty", min_tier_rank: 2 },
          { provider: "twitch", min_tier_rank: 1 }
        ]
      })
    );
  });

  it("hides the add button when every provider is used", async () => {
    const { text } = await mount(TWO, ["boosty", "twitch"]);
    expect(text()).not.toContain("Add provider");
  });

  it("removes a row and preserves the mode", async () => {
    const { onChange, click } = await mount(TWO);
    await click((button) => button.getAttribute("aria-label") === "Remove Twitch");
    expect(onChange).toHaveBeenCalledWith({
      mode: "any",
      requirements: [{ provider: "boosty", min_tier_rank: 2 }]
    });
  });
});
