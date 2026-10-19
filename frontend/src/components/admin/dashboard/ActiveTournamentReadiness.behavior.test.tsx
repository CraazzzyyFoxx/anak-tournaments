// @vitest-environment happy-dom
//
// The dashboard's hero shows the first open checklist item; this card lists
// the rest. Pinned: the hero's item is never listed twice, and an open hero
// item never lets the card claim "every step is done".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import en from "@/i18n/messages/en.json";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActiveTournamentReadiness } from "@/components/admin/dashboard/ActiveTournamentReadiness";
import type { ChecklistItem } from "@/components/admin/tournament-checklist";
import type { TournamentReadiness } from "@/types/admin.types";
import type { Tournament } from "@/types/tournament.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/HoverPrefetchLink", () => ({
  HoverPrefetchLink: ({
    href,
    children,
    ...props
  }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}));

const TOURNAMENT = { id: 7, name: "Anak Cup" } as Tournament;
const READINESS = {
  registrations_approved: null,
  team_formation: "balancer"
} as unknown as TournamentReadiness;

function item(key: string, state: ChecklistItem["state"], label: string): ChecklistItem {
  return { key, phase: "setup", state, label, href: `/admin/tournaments/7/${key}` };
}

let container: HTMLElement;
let root: Root;

async function mount(items: ChecklistItem[], heroKey?: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ActiveTournamentReadiness
          canRead
          tournament={TOURNAMENT}
          readiness={READINESS}
          items={items}
          heroKey={heroKey}
          isLoading={false}
          failed={false}
        />
      </NextIntlClientProvider>
    );
  });
}

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ActiveTournamentReadiness", () => {
  it("lists the open items the hero does not show", async () => {
    await mount(
      [item("schedule", "done", "Phase schedule"), item("grid", "todo", "Division grid"), item("ranks", "warn", "Ranks covered")],
      "grid"
    );

    expect(container.textContent).not.toContain("Division grid");
    expect(container.textContent).toContain("Ranks covered");
    expect(container.textContent).toContain("1 of 3 steps done");
  });

  it("never calls the checklist done while the hero's item is open", async () => {
    await mount([item("schedule", "done", "Phase schedule"), item("grid", "todo", "Division grid")], "grid");

    expect(container.textContent).not.toContain("Division grid");
    expect(container.textContent).not.toContain(en.adminShell.dashboard.everyStepDone);
  });
});
