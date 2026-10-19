import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { act, type ReactNode } from "react";

import type { FormField, FormSchema } from "@/types/forms.types";
import type { Registration, RegistrationForm } from "@/types/registration.types";

vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);

const testWindow = new Window({ url: "http://localhost:3000/", width: 900, height: 900 });
const previousGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => Object.assign((key: string) => key, { has: () => true }),
}));
// Radix portals and pointer measurement do not work under happy-dom; these two
// primitives are stood in by the contracts the form actually uses.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...rest }: { children: ReactNode }) => (
    <button type="button" {...rest}>
      {children}
    </button>
  ),
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: () => <button type="button" role="switch" aria-checked="false" />,
}));
vi.mock("@/services/hero.service", () => ({ default: { getAll: async () => ({ results: [] }) } }));
vi.mock("@/services/registration.service", () => ({
  default: { getMySubscriptionStatus: async () => ({ required: false, verdicts: {} }) },
}));
vi.mock("@/services/rbac.service", () => ({
  rbacService: { listOAuthConnections: async () => ({ results: [] }) },
}));
vi.mock("@/stores/account-settings-modal.store", () => ({
  useAccountSettingsModalStore: (select: (state: { open: () => void }) => unknown) =>
    select({ open: () => {} }),
}));
vi.mock("@/lib/notify", () => ({ notify: { error: () => {} } }));

for (const [key, value] of Object.entries({
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  HTMLElement: testWindow.HTMLElement,
  Event: testWindow.Event,
  Node: testWindow.Node,
  MutationObserver: testWindow.MutationObserver,
  getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
  requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
  cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
}

// `mock.module` must be registered before the module graph under test loads.
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const RegistrationSchemaForm = (await import("./RegistrationSchemaForm")).default;

function field(overrides: Partial<FormField> & Pick<FormField, "key" | "kind">): FormField {
  return {
    label: overrides.key,
    required: false,
    visibility: "public",
    params: {},
    ...overrides,
  };
}

/** One step, the two notes builtins — the `public_notes`/`organizer_notes` pair. */
const SCHEMA: FormSchema = {
  schema_version: 1,
  sections: [
    {
      key: "details",
      title: "Details",
      fields: [
        field({ key: "public_notes", kind: "builtin" }),
        field({ key: "organizer_notes", kind: "builtin", visibility: "organizers" }),
      ],
    },
  ],
};

const FORM = {
  id: 1,
  tournament_id: 7,
  workspace_id: 3,
  is_open: true,
  form_schema: SCHEMA,
  discipline: "overwatch",
  version_id: 42,
  version_number: 2,
  subrole_catalog: {},
} as unknown as RegistrationForm;

let container = testWindow.document.createElement("div");
let root = createRoot(container as unknown as Element);

function type(element: Element, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    testWindow.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new testWindow.Event("input", { bubbles: true }) as unknown as Event);
  });
}

describe("RegistrationSchemaForm", () => {
  it("asks the registrant organizers-only questions and submits their answers", async () => {
    // `visibility` decides who READS an answer, not who is asked for it:
    // `organizer_notes` is the player-writes/organizer-reads half of the pair,
    // so hiding it from the registrant would make it unanswerable by anyone.
    let submitted: { answers: Record<string, unknown> } | null = null;

    await mountForm({
      onSubmit: async (input: { answers: Record<string, unknown> }) => {
        submitted = input;
      }
    });

    const boxes = container.querySelectorAll("textarea");
    expect(boxes.length).toBe(2);
    // …and the registrant is told the answer is not published.
    expect(container.textContent).toContain("organizersOnly");

    type(boxes[1], "for the organizers only");

    const submit = container.querySelectorAll("button")[
      container.querySelectorAll("button").length - 1
    ];
    await act(async () => {
      submit.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });

    expect(submitted).not.toBeNull();
    expect(submitted?.answers.organizer_notes).toBe("for the organizers only");
    expect(submitted?.answers.public_notes).toBe(null);
  });

  it("requires the LoL identity rather than accepting a Battle.net answer", async () => {
    testWindow.localStorage.clear();
    testWindow.localStorage.setItem(
      "aqt:registration-draft:7",
      JSON.stringify({ identity_battlenet: ["Player#1234"] })
    );
    let submitted: { answers: Record<string, unknown> } | null = null;
    await mountForm({
      form: {
        ...FORM,
        discipline: "lol",
        form_schema: {
          schema_version: 1,
          sections: [
            {
              key: "accounts",
              fields: [field({ key: "identity_riot", kind: "builtin", required: true })]
            }
          ]
        }
      },
      onSubmit: async (input: { answers: Record<string, unknown> }) => {
        submitted = input;
      }
    });
    const submit = () =>
      act(async () => {
        const buttons = container.querySelectorAll("button");
        buttons[buttons.length - 1].dispatchEvent(
          new testWindow.MouseEvent("click", { bubbles: true }) as unknown as Event
        );
      });
    await submit();
    expect(submitted).toBeNull();
    expect(container.querySelector('[aria-invalid="true"]')).not.toBeNull();

    const input = container.querySelector("input")!;
    const setter = Object.getOwnPropertyDescriptor(
      testWindow.HTMLInputElement.prototype,
      "value"
    )!.set!;
    act(() => {
      setter.call(input, "  Hide On Bush # KR1 ");
      input.dispatchEvent(new testWindow.Event("input", { bubbles: true }) as unknown as Event);
      input.dispatchEvent(
        new testWindow.FocusEvent("focusout", { bubbles: true }) as unknown as Event
      );
    });
    await submit();
    expect(submitted?.answers).toEqual({ identity_riot: ["Hide On Bush#KR1"] });
  });

  it("keeps the answers a registrant typed when the form is closed, until it submits", async () => {
    // Closing the dialog unmounts the form, and an accidental Esc looks exactly
    // like Cancel from in here — so the answer document has to outlive the mount.
    testWindow.localStorage.clear();
    let submitted = false;

    const mount = () =>
      mountForm({
        onSubmit: async () => {
          submitted = true;
        }
      });

    await mount();
    type(container.querySelectorAll("textarea")[0], "half an answer");
    act(() => root.unmount());

    await mount();
    expect(container.querySelectorAll("textarea")[0].value).toBe("half an answer");

    const buttons = container.querySelectorAll("button");
    await act(async () => {
      buttons[buttons.length - 1].dispatchEvent(
        new testWindow.MouseEvent("click", { bubbles: true }) as unknown as Event,
      );
    });
    expect(submitted).toBe(true);
    expect(testWindow.localStorage.getItem("aqt:registration-draft:7")).toBeNull();

    // …and a fresh registration after that one opens empty.
    act(() => root.unmount());
    await mount();
    expect(container.querySelectorAll("textarea")[0].value).toBe("");
  });
});

/** A stored registration, only as much of one as the form reads. */
const STORED = {
  id: 55,
  primary_handle: "Anak#2100",
  roles: [],
  answers: { public_notes: "mine", organizer_notes: "theirs" },
  can_edit: true,
  edit_locked_reason: null,
  edit_writable_keys: ["public_notes"],
} as unknown as Registration;

/**
 * The form asks its owner game's metadata before anything renders (a role matrix is seeded from it), so
 * every mount waits for that read to settle.
 */
async function mountForm(props: Record<string, unknown>) {
  container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  root = createRoot(container as unknown as Element);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RegistrationSchemaForm
          mode="public"
          form={FORM}
          tournamentId={7}
          onSubmit={async () => {}}
          onCancel={() => {}}
          {...props}
        />
      </QueryClientProvider>,
    );
  });
  for (let attempt = 0; attempt < 20 && container.querySelectorAll("button").length === 0; attempt += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 5);
      await promise;
    });
  }
}

afterEach(() => act(() => root.unmount()));

describe("RegistrationSchemaForm editing an existing registration", () => {
  it("renders every key outside the server's allowlist read-only", async () => {
    // The allowlist is the SERVER's answer — schema flag plus the system floors
    // plus the never-answered exception — so the form forwards it rather than
    // re-deriving anything from `field.editable`.
    testWindow.localStorage.clear();
    await mountForm({ initial: STORED, writableKeys: ["public_notes"] });

    const boxes = container.querySelectorAll("textarea");
    expect(boxes.length).toBe(2);
    // The lock is ENFORCED by a disabled fieldset around the control, not by a
    // prop each of the eight builtin renderers has to remember to honour.
    expect(boxes[0].closest("fieldset")?.disabled).toBe(false);
    expect(boxes[1].closest("fieldset")?.disabled).toBe(true);
    // …and says why, rather than leaving a dead control unexplained.
    expect(container.textContent).toContain("registration.edit.fieldLocked");
  });

  it("sends only the allowlisted answers, not the ones it merely displayed", async () => {
    // Re-sending an unchanged answer for a frozen key is still a write of that
    // key, and the server refuses the whole request with `code: "locked"`.
    testWindow.localStorage.clear();
    let submitted: { answers: Record<string, unknown> } | null = null;
    await mountForm({
      initial: STORED,
      writableKeys: ["public_notes"],
      onSubmit: async (input: { answers: Record<string, unknown> }) => {
        submitted = input;
      }
    });

    const buttons = container.querySelectorAll("button");
    await act(async () => {
      buttons[buttons.length - 1].dispatchEvent(
        new testWindow.MouseEvent("click", { bubbles: true }) as unknown as Event,
      );
    });

    expect(submitted).not.toBeNull();
    expect(Object.keys(submitted?.answers ?? {})).toEqual(["public_notes"]);
  });

  it("drops a step with nothing writable on it", async () => {
    // A page of greyed-out controls to click Next through is not a step.
    testWindow.localStorage.clear();
    await mountForm({
      form: {
        ...FORM,
        form_schema: {
          schema_version: 1,
          sections: [
            { key: "details", title: "Details", fields: [field({ key: "public_notes", kind: "builtin" })] },
            { key: "extra", title: "Extra", fields: [field({ key: "note2", kind: "textarea" })] },
          ],
        },
      } as unknown as RegistrationForm,
      initial: STORED,
      writableKeys: ["public_notes"],
    });

    // One step, so no indicator and no sign of the second section at all.
    expect(container.querySelectorAll("textarea").length).toBe(1);
    expect(container.textContent).not.toContain("Extra");
  });
});

describe("RegistrationSchemaForm on a late sign-up", () => {
  /** The window's `ends_at` is behind us; `allow_late_registration` is the only
   *  reason this form is open, so the entry is marked as a late one. */
  const LATE_FORM = {
    ...FORM,
    registration_late: true,
    form_schema: {
      schema_version: 1,
      sections: [
        {
          key: "details",
          title: "Details",
          fields: [
            field({ key: "public_notes", kind: "builtin" }),
            field({ key: "reserve", kind: "builtin" }),
          ],
        },
      ],
    },
  } as unknown as RegistrationForm;

  it("warns before the submit and answers nothing on the player's behalf", async () => {
    // A player who learns the mark only after submitting reads it as a bug --
    // and the `reserve` question stays theirs, untouched and unticked.
    testWindow.localStorage.clear();
    let submitted: { answers: Record<string, unknown> } | null = null;
    await mountForm({
      form: LATE_FORM,
      onSubmit: async (input: { answers: Record<string, unknown> }) => {
        submitted = input;
      }
    });

    expect(container.textContent).toContain("registration.reserve.lateNotice");

    const buttons = container.querySelectorAll("button");
    await act(async () => {
      buttons[buttons.length - 1].dispatchEvent(
        new testWindow.MouseEvent("click", { bubbles: true }) as unknown as Event,
      );
    });
    expect(submitted?.answers.reserve).not.toBe(true);
  });

  it("says nothing while the window is still open", async () => {
    testWindow.localStorage.clear();
    await mountForm({ form: { ...LATE_FORM, registration_late: false } as unknown as RegistrationForm });

    expect(container.textContent).not.toContain("registration.reserve.lateNotice");
  });
});

afterAll(() => {
  act(() => root.unmount());
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
