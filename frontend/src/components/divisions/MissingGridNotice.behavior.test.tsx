// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  )
}));

import { isDivisionGridRequired, MissingGridNotice } from "./MissingGridNotice";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLElement[] = [];

function render(ui: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  act(() => createRoot(container).render(ui));
  return container;
}

afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

describe("MissingGridNotice", () => {
  it("sends an organizer to this game's own grid settings", () => {
    const container = render(<MissingGridNotice discipline="lol" gameName="League of Legends" canManage />);

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/admin/settings/divisions?discipline=lol");
    expect(link?.textContent).toBe("Create or select a League of Legends division grid");
  });

  it("tells everyone else to ask an organizer and offers no link past the permission", () => {
    const container = render(
      <MissingGridNotice discipline="lol" gameName="League of Legends" canManage={false} />
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("Ask a workspace organizer");
  });

  it("says across communities that no workspace grid applies, with no organizer way out", () => {
    const container = render(
      <MissingGridNotice discipline="lol" gameName="League of Legends" canManage acrossCommunities />
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("League of Legends has no usable division grid across communities");
    expect(container.textContent).toContain("Choose a community");
    expect(container.textContent).not.toContain("in this workspace");
    expect(container.textContent).not.toContain("Ask a workspace organizer");
  });
});

describe("isDivisionGridRequired", () => {
  it("recognizes the server's 422 refusal and nothing else", () => {
    const refusal = new ApiError(422, [
      { msg: "division_grid_required: 'lol' needs a division grid of its own with tiers", code: "error" }
    ]);
    expect(isDivisionGridRequired(refusal)).toBe(true);
    expect(isDivisionGridRequired(new ApiError(422, [{ msg: "bad", code: "other" }]))).toBe(false);
    expect(
      isDivisionGridRequired(new ApiError(500, [{ msg: "division_grid_required", code: "error" }]))
    ).toBe(false);
    expect(isDivisionGridRequired(new Error("division_grid_required"))).toBe(false);
  });
});
