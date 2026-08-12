// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import en from "@/i18n/messages/en.json";
import { DiscordRoleSelect } from "./DiscordRoleSelect";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const useDiscordRoles = vi.fn();
const refetch = vi.fn();

vi.mock("@/hooks/useDiscordEntities", () => ({
  useDiscordRoles: (...args: unknown[]) => useDiscordRoles(...args),
  useDiscordChannels: vi.fn(),
  useDiscordGuildInfo: vi.fn()
}));

const ROLES = [
  { id: "111", name: "Boosty Sub: Tier 2", color: "#ff5c5c", position: 3, managed: false },
  { id: "222", name: "Twitch Subscriber", color: null, position: 2, managed: true },
  { id: "333", name: "Activity manager", color: "#00ffcc", position: 1, managed: false }
];

interface Handles {
  onChange: Mock;
  onRoleNameSelected: Mock;
}

/** Mounted roots, unmounted between tests. Wiping `document.body` instead leaves
 *  the previous root live over a detached container, and its next flush tries to
 *  remove portal nodes that no longer have a parent. */
const roots: Root[] = [];

async function mount(value = "", roles: unknown[] = ROLES) {
  useDiscordRoles.mockReturnValue({ data: { guild_id: "9", roles }, isLoading: false, refetch });
  const handles: Handles = { onChange: vi.fn(), onRoleNameSelected: vi.fn() };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DiscordRoleSelect
          workspaceId={7}
          value={value}
          onChange={handles.onChange}
          onRoleNameSelected={handles.onRoleNameSelected}
        />
      </NextIntlClientProvider>
    );
  });
  return { container, handles };
}

function trigger(container: HTMLElement): HTMLButtonElement {
  const node = container.querySelector<HTMLButtonElement>('button[role="combobox"]');
  if (!node) throw new Error("no combobox trigger rendered");
  return node;
}

/** Radix Popover opens on click; the content is portalled onto the body. */
async function open(container: HTMLElement) {
  const node = trigger(container);
  await act(async () => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function searchField(): HTMLInputElement {
  const node = document.body.querySelector<HTMLInputElement>("[cmdk-input]");
  if (!node) throw new Error("no search field rendered");
  return node;
}

async function type(value: string) {
  const input = searchField();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Only the rows cmdk currently keeps visible. */
function options(): string[] {
  return [...document.body.querySelectorAll("[cmdk-item]")]
    .filter((node) => node.getAttribute("aria-disabled") !== "true" && !node.hasAttribute("hidden"))
    .map((node) => (node.textContent ?? "").trim());
}

beforeEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  useDiscordRoles.mockReset();
  refetch.mockReset();
});

describe("DiscordRoleSelect", () => {
  it("names itself from the chosen role, not from a generic label", async () => {
    // An `aria-label` on the trigger would override its content and hide which
    // role is selected, which is the one thing the control has to announce.
    const { container } = await mount("111");
    expect(trigger(container).textContent).toContain("Boosty Sub: Tier 2");
    expect(trigger(container).getAttribute("aria-label")).toBeNull();
  });

  it("states its purpose while nothing is selected", async () => {
    const { container } = await mount("");
    expect(trigger(container).textContent).toContain(en.discord.role.placeholder);
  });

  it("shows the bare id for a role the guild no longer returns", async () => {
    // Falling back to the placeholder would read as "nothing selected" for a
    // tier that is still gating admission on that role.
    const { container } = await mount("999");
    expect(trigger(container).textContent).toContain("999");
  });

  it("filters the list by name as the admin types", async () => {
    const { container } = await mount();
    await open(container);

    expect(options()).toHaveLength(3);

    await type("twitch");
    expect(options()).toEqual(["Twitch Subscribermanaged"]);
  });

  it("finds a role by a pasted snowflake", async () => {
    // Searching by id is why the option's search value carries it: an admin
    // copying an id out of Discord must not have to translate it to a name.
    const { container } = await mount();
    await open(container);

    await type("333");
    expect(options()).toEqual(["Activity manager"]);
  });

  it("says so when the search matches nothing", async () => {
    const { container } = await mount();
    await open(container);

    await type("no-such-role");
    expect(options()).toHaveLength(0);
    expect(document.body.textContent).toContain(en.discord.role.empty);
  });

  it("reports the picked role by id and offers its name as the tier label", async () => {
    const { container, handles } = await mount();
    await open(container);
    await type("tier 2");

    const option = document.body.querySelector<HTMLElement>("[cmdk-item]");
    await act(async () => {
      option?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(handles.onChange).toHaveBeenCalledWith("111");
    expect(handles.onRoleNameSelected).toHaveBeenCalledWith("Boosty Sub: Tier 2");
  });

  it("never offers @everyone as a tier label — it is the absence of a role", async () => {
    const { container, handles } = await mount("", [
      { id: "444", name: "@everyone", color: null, position: 0, managed: false }
    ]);
    await open(container);

    const option = document.body.querySelector<HTMLElement>("[cmdk-item]");
    await act(async () => {
      option?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(handles.onChange).toHaveBeenCalledWith("444");
    expect(handles.onRoleNameSelected).not.toHaveBeenCalled();
  });

  it("falls back to manual id entry when the bot cannot read the guild", async () => {
    const { container } = await mount("", []);

    expect(container.querySelector('button[role="combobox"]')).toBeNull();
    const input = container.querySelector("input");
    expect(input?.getAttribute("aria-label")).toBe(en.discord.role.idAria);
  });
});
