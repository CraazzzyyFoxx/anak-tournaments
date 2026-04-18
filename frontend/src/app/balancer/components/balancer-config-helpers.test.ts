import {
  CUSTOM_PRESET,
  areBalancerConfigsEqual,
  findMatchingPreset,
  getRunConfig,
  resolveInitialBalancerConfig,
} from "./balancer-config-helpers";
import type { BalancerConfigResponse } from "@/types/balancer.types";

type TestFunction = () => void | Promise<void>;
type Expectation<T> = {
  toBe: (expected: T) => void;
  toEqual: (expected: unknown) => void;
};

declare const describe: (name: string, fn: TestFunction) => void;
declare const it: (name: string, fn: TestFunction) => void;
declare const expect: <T>(actual: T) => Expectation<T>;

const configData: BalancerConfigResponse = {
  defaults: {
    ALGORITHM: "genetic",
    POPULATION_SIZE: 200,
  },
  limits: {},
  presets: {
    DEFAULT: {
      ALGORITHM: "genetic",
      POPULATION_SIZE: 200,
    },
    QUICK: {
      ALGORITHM: "genetic",
      POPULATION_SIZE: 50,
    },
  },
  fields: [],
};

describe("balancer config helpers", () => {
  it("resolves tournament config before runtime defaults", () => {
    expect(resolveInitialBalancerConfig(configData, { POPULATION_SIZE: 150 })).toEqual({
      POPULATION_SIZE: 150,
    });
  });

  it("matches presets regardless of object key order", () => {
    expect(
      findMatchingPreset(
        {
          POPULATION_SIZE: 50,
          ALGORITHM: "genetic",
        },
        configData.presets
      )
    ).toBe("QUICK");
  });

  it("uses draft config as the run config for custom settings", () => {
    expect(getRunConfig({ MAX_NSGA_SOLUTIONS: 6, ALGORITHM: "nsga" }, configData, CUSTOM_PRESET)).toEqual({
      ALGORITHM: "nsga",
      MAX_NSGA_SOLUTIONS: 6,
    });
  });

  it("treats null and undefined values as unset when comparing configs", () => {
    expect(areBalancerConfigsEqual({ USE_CAPTAINS: undefined }, {})).toBe(true);
  });
});
