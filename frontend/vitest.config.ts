import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: [
      "src/app/**/tournaments/**/draft/**/*.test.ts",
      "src/app/**/tournaments/**/veto/**/*.test.ts",
      "src/app/admin/tournaments/**/components/draft/**/*.test.ts",
      "src/app/admin/tournaments/**/overview/**/*.test.ts",
      "src/app/admin/tournaments/new/**/*.test.ts",
      "src/app/admin/divisions/**/*.test.tsx",
      "src/app/admin/tournaments/**/components/*.test.ts",
      "src/app/admin/tournaments/**/components/*.test.tsx",
      "src/app/admin/tournaments/[id]/tab-guards.test.ts",
      "src/app/admin/players/**/*.test.ts",
      "src/app/admin/sub-roles/**/*.test.tsx",
      "src/app/balancer/components/balance-import.test.ts",
      "src/app/balancer/components/balancer-page-selectors.test.ts",
      "src/app/balancer/tool-context.test.ts",
      "src/app/balancer/redirect-map.test.ts",
      "src/app/**/users/compare/**/*.test.ts",
      "src/components/tournaments/**/*.test.ts",
      "src/components/balancer/registrations/**/*.test.tsx",
      "src/components/admin/**/*.test.tsx",
      "src/components/admin/**/*.test.ts",
      "src/components/ui/data-pagination.test.tsx",
      "src/components/ui/infinite-scroll.test.tsx",
      "src/components/site/**/*.test.tsx",
      "src/components/ui/toggle-group.test.tsx"
    ]
  }
});
