// @vitest-environment happy-dom
//
// The one branch every settings section inherits from this hook: what happens
// when the saved entity changes under an open editor. What is pinned here:
//  1. a refetch that arrives while nothing is unsaved adopts the new values —
//     otherwise another admin's write stays invisible until a reload;
//  2. a refetch that arrives mid-edit keeps the typing. Re-baselining is not
//     allowed to throw away what the user has not saved yet;
//  3. no render in between ever reports a phantom changed field. The baseline
//     is derived during render, so re-baselining in an effect would commit one
//     render comparing the NEW baseline against the OLD form and flash a save
//     bar for an edit nobody made.
// And for a section that validates its own fields:
//  4. a changed field is not called wrong mid-typing, only once revealed
//     (left, or a save attempted); an attempted save sends nothing;
//  5. a value saved before a rule existed never blocks an unrelated edit;
//  6. a refused save's field reasons land on the field, not the bar, and
//     clear the moment that field is edited.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { ApiError } from "@/lib/api/error";
import { useScopedSettingsForm } from "./useScopedSettingsForm";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

interface Form {
  name: string;
}

let container: HTMLDivElement;
let root: Root;
/** Every render's summary, so a one-render flash is observable. */
let summaries: string[];

function Section({ baseline }: Readonly<{ baseline: Form }>) {
  const settings = useScopedSettingsForm<Form, Partial<Form>>({
    baseline,
    toPayload: (form, base) => (form.name === base.name ? {} : { name: form.name }),
    submit: async () => undefined
  });
  summaries.push(settings.summary);

  return (
    <div>
      <input
        id="name"
        value={settings.form?.name ?? ""}
        onChange={(event) => settings.patch({ name: event.target.value })}
      />
      <span id="dirty">{settings.dirty ? settings.summary : "clean"}</span>
    </div>
  );
}

async function render(baseline: Form) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Section baseline={baseline} />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
}

/** Type into a controlled input the way React's synthetic layer sees it. */
async function type(value: string) {
  const input = container.querySelector<HTMLInputElement>("#name")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  summaries = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("useScopedSettingsForm › re-baseline", () => {
  it("adopts a refetched entity while the form is clean, without flashing changes", async () => {
    await render({ name: "OWT 64" });
    await render({ name: "OWT 65" });

    expect(container.querySelector<HTMLInputElement>("#name")?.value).toBe("OWT 65");
    expect(container.querySelector("#dirty")?.textContent).toBe("clean");
    expect(summaries.every((summary) => summary === "0 changed fields")).toBe(true);
  });

  it("keeps unsaved typing when the entity changes under the editor", async () => {
    await render({ name: "OWT 64" });
    await type("OWT 64 Redux");
    await render({ name: "OWT 65" });

    expect(container.querySelector<HTMLInputElement>("#name")?.value).toBe("OWT 64 Redux");
    // Still dirty, and now against the refetched baseline: the save sends the
    // user's value, not a diff against values the server has already moved on
    // from.
    expect(container.querySelector("#dirty")?.textContent).toBe("1 changed field");
  });
});

interface Profile {
  name: string;
  link: string;
}

const submitProfile = vi.fn<(payload: Partial<Profile>) => Promise<unknown>>();

function ValidatedSection({ baseline }: Readonly<{ baseline: Profile }>) {
  const settings = useScopedSettingsForm<Profile, Partial<Profile>>({
    baseline,
    toPayload: (form, base) =>
      Object.fromEntries(
        (Object.keys(form) as (keyof Profile)[])
          .filter((key) => form[key] !== base[key])
          .map((key) => [key, form[key]])
      ),
    submit: (payload) => submitProfile(payload),
    validate: (form) => ({
      name: form.name.trim() ? undefined : "Name required",
      link: form.link.startsWith("https://") ? undefined : "Use https"
    })
  });

  return (
    <div>
      {(["name", "link"] as const).map((key) => (
        <input
          key={key}
          id={key}
          value={settings.form?.[key] ?? ""}
          onChange={(event) => settings.patch({ [key]: event.target.value })}
        />
      ))}
      <button id="reveal-name" type="button" onClick={() => settings.reveal("name")} />
      <button id="save" type="button" onClick={settings.save} />
      <span id="name-error">{settings.errors.name ?? ""}</span>
      <span id="link-error">{settings.errors.link ?? ""}</span>
      <span id="bar-error">{settings.error ?? ""}</span>
    </div>
  );
}

async function renderValidated(baseline: Profile) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={new QueryClient()}>
          <ValidatedSection baseline={baseline} />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
}

async function typeInto(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      input,
      value
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(id: string) {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(`#${id}`)!.click();
  });
}

const text = (id: string) => container.querySelector(`#${id}`)?.textContent;

describe("useScopedSettingsForm › field validation", () => {
  beforeEach(() => {
    submitProfile.mockReset().mockResolvedValue(undefined);
  });

  it("calls a changed field wrong only once revealed, and an attempted save sends nothing", async () => {
    await renderValidated({ name: "Anakq", link: "https://discord.gg/a" });
    await typeInto("name", "");

    expect(text("name-error")).toBe("");
    expect(text("bar-error")).toBe("");

    await press("reveal-name");
    expect(text("name-error")).toBe("Name required");
    expect(text("bar-error")).toBe("Fix 1 field to save");

    await press("save");
    expect(submitProfile).not.toHaveBeenCalled();

    await typeInto("name", "Anakq Cup");
    expect(text("name-error")).toBe("");
    await press("save");
    expect(submitProfile).toHaveBeenCalledWith({ name: "Anakq Cup" });
  });

  it("never blocks an edit over a value saved before the rule existed", async () => {
    await renderValidated({ name: "Anakq", link: "http://legacy.example" });
    await typeInto("name", "Anakq Cup");
    await press("save");

    expect(submitProfile).toHaveBeenCalledWith({ name: "Anakq Cup" });
    expect(text("link-error")).toBe("");
  });

  it("puts a refused save's reason on its field and drops it once that field changes", async () => {
    submitProfile.mockRejectedValueOnce(
      new ApiError(422, [{ msg: "Value error, must be an https link", code: "value_error", field: "link" }])
    );
    await renderValidated({ name: "Anakq", link: "https://discord.gg/a" });
    await typeInto("link", "https://discord.gg/b");
    await press("save");

    expect(text("link-error")).toBe("must be an https link");
    expect(text("bar-error")).toBe("Fix 1 field to save");

    await typeInto("link", "https://discord.gg/c");
    expect(text("link-error")).toBe("");
    expect(text("bar-error")).toBe("");
  });
});
