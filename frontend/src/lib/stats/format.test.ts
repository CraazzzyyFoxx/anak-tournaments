import { describe, expect, it } from "vitest";

import { formatStat, type StatFormatter } from "./format";

const en: StatFormatter = { number: (v, o) => new Intl.NumberFormat("en-US", o).format(v) };
const ru: StatFormatter = { number: (v, o) => new Intl.NumberFormat("ru-RU", o).format(v) };
const def = (value_format: "integer" | "decimal" | "percent" | "duration") => ({ value_format });

describe("formatStat", () => {
  it("reads percent as a 0-1 fraction and duration as seconds", () => {
    expect(formatStat(def("percent"), 0.375, en)).toBe("37.5%");
    expect(formatStat(def("duration"), 125, en)).toBe("2m 5s");
    expect(formatStat(def("duration"), 59.9, en)).toBe("59s");
  });

  it("does not rescale a value that is not a fraction", () => {
    expect(formatStat(def("percent"), 37.5, en)).toBe("—");
    expect(formatStat(def("percent"), 1, en)).toBe("100.0%");
  });

  it("localises integers and decimals through the caller's formatter", () => {
    expect(formatStat(def("integer"), 1557.4, en)).toBe("1,557");
    expect(formatStat(def("integer"), 1557.4, ru)).toBe(
      new Intl.NumberFormat("ru-RU").format(1557)
    );
    expect(formatStat(def("decimal"), 3.14159, en)).toBe("3.14");
    expect(formatStat(def("decimal"), 2, en)).toBe("2");
  });

  it("separates missing from zero for every format", () => {
    for (const format of ["integer", "decimal", "percent", "duration"] as const) {
      expect(formatStat(def(format), null, en)).toBe("—");
      expect(formatStat(def(format), undefined, en)).toBe("—");
      expect(formatStat(def(format), Number.NaN, en)).toBe("—");
      expect(formatStat(def(format), Number.POSITIVE_INFINITY, en)).toBe("—");
      expect(formatStat(def(format), 0, en)).not.toBe("—");
    }
  });

  it("leaves ordering to the raw numbers, which the display string would get wrong", () => {
    const raw = [9, 10, 100];
    const byRaw = [...raw].sort((a, b) => a - b);
    const byText = [...raw].sort((a, b) =>
      formatStat(def("integer"), a, en).localeCompare(formatStat(def("integer"), b, en))
    );
    expect(byRaw).toEqual([9, 10, 100]);
    expect(byText).not.toEqual(byRaw);
  });
});
