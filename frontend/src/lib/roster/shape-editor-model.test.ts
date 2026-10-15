import { describe, expect, it } from "vitest";

import {
  MAX_ROSTER_TOTAL,
  MAX_SLOT_COUNT,
  MIN_ROSTER_TOTAL,
  ROSTER_SHAPE_MODES,
  initialSelection,
  modeForOverride,
  normalizeSlots,
  payloadTotalError,
  previewSlotRows,
  selectMode,
  setSlotCount,
  slotsPayload
} from "@/lib/roster/shape-editor-model";

const OW5V5 = { tank: 1, damage: 2, support: 2 } as const;

describe("modeForOverride", () => {
  it("offers only owned presets and custom shapes", () => {
    expect(ROSTER_SHAPE_MODES).toEqual(["ow5v5", "flex6", "custom"]);
  });

  it("names a copy matching the default preset", () => {
    expect(modeForOverride({ ...OW5V5 })).toBe("ow5v5");
  });

  it("names the role-free preset", () => {
    expect(modeForOverride({ flex: 6 })).toBe("flex6");
  });

  it("falls back to custom for a hybrid shape", () => {
    expect(modeForOverride({ tank: 1, flex: 5 })).toBe("custom");
  });
});

describe("initialSelection", () => {
  it("seeds a concrete preset from the effective shape when no draft exists", () => {
    expect(initialSelection(null, { flex: 6 })).toEqual({
      mode: "flex6",
      slots: { flex: 6 }
    });
  });

  it("seeds from the override when there is one", () => {
    expect(initialSelection({ tank: 2, flex: 4 }, { ...OW5V5 })).toEqual({
      mode: "custom",
      slots: { tank: 2, flex: 4 }
    });
  });

  it("normalizes a stored map into canonical order without zeros", () => {
    const selection = initialSelection({ flex: 5, damage: 0, tank: 1 }, {});
    expect(Object.keys(selection.slots)).toEqual(["tank", "flex"]);
  });
});

describe("selectMode", () => {
  it("replaces the counts when a preset is picked", () => {
    const next = selectMode({ mode: "custom", slots: { tank: 3 } }, "flex6");
    expect(next).toEqual({ mode: "flex6", slots: { flex: 6 } });
  });

  it("keeps the counts when switching to custom", () => {
    const next = selectMode({ mode: "ow5v5", slots: { ...OW5V5 } }, "custom");
    expect(next).toEqual({ mode: "custom", slots: { ...OW5V5 } });
  });

});

describe("setSlotCount", () => {
  it("re-derives the mode, so hand-typing a preset stops claiming custom", () => {
    const next = setSlotCount({ mode: "custom", slots: { tank: 1, damage: 2, support: 1 } }, "support", 2);
    expect(next.mode).toBe("ow5v5");
  });

  it("switches away from a preset as soon as a count diverges", () => {
    const next = setSlotCount({ mode: "ow5v5", slots: { ...OW5V5 } }, "flex", 1);
    expect(next.mode).toBe("custom");
    expect(next.slots).toEqual({ tank: 1, damage: 2, support: 2, flex: 1 });
  });

  it("drops a code zeroed back out instead of storing a zero", () => {
    const next = setSlotCount({ mode: "custom", slots: { tank: 1, flex: 5 } }, "tank", 0);
    expect(next.slots).toEqual({ flex: 5 });
  });

  it("clamps to the stepper range and rounds fractions", () => {
    expect(setSlotCount({ mode: "custom", slots: {} }, "flex", 99).slots).toEqual({
      flex: MAX_SLOT_COUNT
    });
    expect(setSlotCount({ mode: "custom", slots: { flex: 4 } }, "flex", -3).slots).toEqual({});
    expect(setSlotCount({ mode: "custom", slots: {} }, "damage", 2.6).slots).toEqual({ damage: 3 });
  });
});

describe("payloadTotalError", () => {
  it("accepts a total inside the savable range", () => {
    expect(payloadTotalError({ ...OW5V5 })).toBeNull();
    expect(payloadTotalError({ damage: MIN_ROSTER_TOTAL })).toBeNull();
    expect(payloadTotalError({ damage: MAX_ROSTER_TOTAL })).toBeNull();
  });

  it("rejects a total below the minimum instead of waiting for a 422", () => {
    expect(payloadTotalError({})).toBe("too_few");
  });

  it("rejects a total above the maximum", () => {
    expect(payloadTotalError({ tank: 6, damage: 7 })).toBe("too_many");
  });

  it("agrees with what the editor would send, whatever the mode", () => {
    // The tab gates on the payload and the editor shows the message; both must
    // read the same verdict off the same function.
    const selection = { mode: "custom", slots: {} } as const;
    expect(payloadTotalError(slotsPayload(selection))).toBe("too_few");
  });
});

describe("previewSlotRows", () => {
  it("expands counts into one row per slot, in canonical order", () => {
    expect(previewSlotRows({ tank: 1, flex: 5 })).toEqual([
      "tank",
      "flex",
      "flex",
      "flex",
      "flex",
      "flex"
    ]);
  });

  it("orders role slots canonically regardless of key order", () => {
    expect(previewSlotRows({ support: 1, tank: 1, damage: 1 })).toEqual(["tank", "damage", "support"]);
  });

  it("is empty for an empty map", () => {
    expect(previewSlotRows({})).toEqual([]);
  });
});

describe("slotsPayload", () => {
  it("sends a concrete copy even when initialized from the effective shape", () => {
    expect(slotsPayload(initialSelection(null, { ...OW5V5 }))).toEqual(OW5V5);
  });

  it("sends the counts for a preset", () => {
    expect(slotsPayload({ mode: "ow5v5", slots: { ...OW5V5 } })).toEqual(OW5V5);
  });

  it("normalizes so the tab's JSON dirty check stays stable", () => {
    const payload = slotsPayload({ mode: "custom", slots: { flex: 5, damage: 0, tank: 1 } });
    expect(JSON.stringify(payload)).toBe(JSON.stringify({ tank: 1, flex: 5 }));
  });
});

describe("normalizeSlots", () => {
  it("drops zeros and re-keys canonically", () => {
    expect(JSON.stringify(normalizeSlots({ support: 2, tank: 1, flex: 0 }))).toBe(
      JSON.stringify({ tank: 1, support: 2 })
    );
  });
});
