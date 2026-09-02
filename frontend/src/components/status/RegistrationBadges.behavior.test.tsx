// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AdmissionStatusBadge } from "@/components/status/RegistrationBadges";
import en from "@/i18n/messages/en.json";
import type { Admission, RequirementVerdict } from "@/types/registration.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * `AdmissionStatusBadge` no longer decides anything.
 *
 * It used to take five raw fields plus two requirement flags and re-derive the
 * verdict twice over — once in an exported `isAdmitted` and once inline — which
 * is why a player an organizer had checked in by hand read as "Not admitted"
 * forever: the badge kept re-deciding a question check-in had already closed.
 * These tests pin the projection, not a rule: the same `decision` in must always
 * produce the same badge out.
 */
const verdict = (overrides: Partial<RequirementVerdict> = {}): RequirementVerdict => ({
  key: "open_profile",
  state: "blocked",
  stage: "check_in",
  reasons: [{ code: "profile_private", actor: "player", subject: "Player#1" }],
  detail: {},
  ...overrides
});

const admission = (overrides: Partial<Admission> = {}): Admission => ({
  decision: "not_admitted",
  requirements: [],
  blockers: [],
  overridden: [],
  checked_in: false,
  ready: false,
  ...overrides
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The badge is icon-only, so its `aria-label` is the whole rendered message —
 *  and the only thing assistive tech has to go on. */
function render(value: Admission): string {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AdmissionStatusBadge admission={value} />
      </NextIntlClientProvider>
    );
  });
  return container.querySelector('[role="img"]')?.getAttribute("aria-label") ?? "";
}

describe("AdmissionStatusBadge — one branch per decision", () => {
  it("renders the three decisions and nothing else", () => {
    expect(render(admission({ decision: "admitted", checked_in: true, ready: true }))).toBe(
      en.common.admissionStatus.admitted
    );
    expect(render(admission({ decision: "pending_check_in", ready: true }))).toBe(
      en.common.admissionStatus.pendingCheckIn
    );
    expect(render(admission({ decision: "not_admitted" }))).toBe(
      en.common.admissionStatus.notAdmitted
    );
  });

  it("names the blocker instead of only saying no", () => {
    const label = render(
      admission({
        decision: "not_admitted",
        requirements: [verdict()],
        blockers: [verdict()]
      })
    );

    expect(label).toContain(en.common.admissionStatus.notAdmitted);
    expect(label).toContain(en.admission.reason.profile_private);
    // The subject disambiguates WHICH tag: under `scope: "all"` a registrant can
    // carry three, with exactly one closed.
    expect(label).toContain("Player#1");
  });
});

describe("AdmissionStatusBadge — a forced check-in (D4/D5)", () => {
  it("renders Admitted plus a neutral override marker for a blocked requirement", () => {
    const label = render(
      admission({
        decision: "admitted",
        requirements: [verdict()],
        overridden: [verdict()],
        checked_in: true,
        ready: true
      })
    );

    // Admitted stays first and stays literal: the row IS in.
    expect(label).toContain(en.common.admissionStatus.admitted);
    // The unmet requirement stays visible, with its reason.
    expect(label).toContain(en.common.admissionStatus.overridden);
    expect(label).toContain(en.admission.reason.profile_private);
  });

  it("keeps the override wording free of any claim about who granted it", () => {
    // The verdicts carry no as-of time, so an organizer's hand check-in and a
    // subscription that lapsed after a legitimate one are indistinguishable
    // here. Wording that blamed the organizer would be wrong half the time.
    const label = render(
      admission({
        decision: "admitted",
        requirements: [verdict()],
        overridden: [verdict()],
        checked_in: true,
        ready: true
      })
    ).toLowerCase();

    for (const forbidden of ["manual", "organizer", "admin", "override", "forced", "by hand"]) {
      expect(label).not.toContain(forbidden);
    }
  });

  it("marks nothing when an admitted row has no unmet requirement", () => {
    expect(
      render(
        admission({
          decision: "admitted",
          requirements: [verdict({ state: "satisfied", reasons: [] })],
          checked_in: true,
          ready: true
        })
      )
    ).toBe(en.common.admissionStatus.admitted);
  });

  it("does not treat an undetermined requirement as a failure", () => {
    // Fail-open, the invariant this whole layer is built around: a provider
    // outage or an unfinished rank collection must never un-admit a player. The
    // server already decided `admitted`; the badge must not add a marker on top
    // of a requirement that is not blocked.
    const label = render(
      admission({
        decision: "admitted",
        requirements: [
          verdict({
            state: "undetermined",
            reasons: [{ code: "provider_unavailable", actor: "system", subject: "discord" }]
          })
        ],
        checked_in: true,
        ready: true
      })
    );

    expect(label).toBe(en.common.admissionStatus.admitted);
    expect(label).not.toContain(en.admission.reason.provider_unavailable);
  });
});

describe("AdmissionStatusBadge — unknown reason codes", () => {
  it("shows the raw code rather than an empty string", () => {
    // A provider added server-side must stay explainable without a client
    // deploy, and a blank label reads as "nothing wrong here".
    const unknown = verdict({
      reasons: [{ code: "moon_phase_unfavourable", actor: "system", subject: null }]
    });

    expect(
      render(
        admission({ decision: "not_admitted", requirements: [unknown], blockers: [unknown] })
      )
    ).toContain("moon_phase_unfavourable");
  });
});
