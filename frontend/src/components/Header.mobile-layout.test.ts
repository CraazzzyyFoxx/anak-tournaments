import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `import.meta.dirname`, not Bun's `import.meta.dir`: this file imports `vitest`
// and runs on Node, where the Bun-only property is undefined. It matched no
// vitest `include` pattern until frontend CI landed, so the TypeError it threw
// on the very first line had never actually run anywhere.
const headerSource = readFileSync(join(import.meta.dirname, "Header.tsx"), "utf8");

describe("Header mobile layout", () => {
  it("keeps the trailing controls inside the available header width", () => {
    expect(headerSource).toContain(
      'className="flex min-w-0 flex-1 items-center gap-1 md:ml-auto md:gap-4"'
    );
    expect(headerSource).not.toContain(
      'className="flex w-full items-center md:ml-auto gap-4 lg:gap-4"'
    );
    expect(headerSource).toContain('className="hidden min-[360px]:block"');
    expect(headerSource).toContain(
      'className="hidden min-w-0 md:ml-auto md:block md:flex-initial"'
    );
    expect(headerSource).toContain(
      'className="ml-auto flex min-w-0 items-center gap-1 sm:gap-3 md:ml-0"'
    );
  });
});
