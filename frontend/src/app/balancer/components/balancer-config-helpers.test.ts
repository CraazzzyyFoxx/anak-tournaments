import {
  CUSTOM_PRESET,
  areBalancerConfigsEqual,
  findMatchingPreset,
  getRunConfig,
  resolveInitialBalancerConfig,
  sanitizeBalancerConfig,
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
    algorithm: "moo",
    population_size: 200,
  },
  limits: {},
  presets: {
    DEFAULT: {
      algorithm: "moo",
      population_size: 200,
    },
    QUICK: {
      algorithm: "moo",
      population_size: 50,
    },
  },
  fields: [],
};

describe("balancer config helpers", () => {
  it("resolves tournament config before runtime defaults", () => {
    expect(resolveInitialBalancerConfig(configData, { population_size: 150 })).toEqual({
      population_size: 150,
    });
  });

  it("matches presets regardless of object key order", () => {
    expect(
      findMatchingPreset(
        {
          population_size: 50,
          algorithm: "moo",
        },
        configData.presets
      )
    ).toBe("QUICK");
  });

  it("uses draft config as the run config for custom settings", () => {
    expect(getRunConfig({ max_result_variants: 6, algorithm: "mixtura_balancer" }, configData, CUSTOM_PRESET)).toEqual({
      algorithm: "mixtura_balancer",
      max_result_variants: 6,
    });
  });

  it("treats null and undefined values as unset when comparing configs", () => {
    expect(areBalancerConfigsEqual({ use_captains: undefined }, {})).toBe(true);
  });

  it("treats internal_role_spread_weight as a numeric config key", () => {
    expect(sanitizeBalancerConfig({ internal_role_spread_weight: "0.75" as unknown as number })).toEqual({
      internal_role_spread_weight: 0.75,
    });
  });
});
