import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    },
    dedupe: ["react", "react-dom"]
  },
  test: {
    // Externalized deps are loaded by Node and resolve their own CJS `react`,
    // whose hook dispatcher react-dom never sets. `@tanstack/react-table` calls
    // hooks, so every `useReactTable` render threw "Invalid hook call" until it
    // was inlined through Vite alongside the app code.
    server: { deps: { inline: ["@tanstack/react-table"] } },
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
      // `include` is an allow-list: a test file outside it never runs and the
      // suite still reports green. Both data-browser dirs are listed up front
      // so the first test added under either one actually executes.
      "src/app/admin/match-reports/**/*.test.ts",
      "src/app/admin/match-reports/**/*.test.tsx",
      "src/app/admin/matches/**/*.test.ts",
      "src/app/admin/matches/**/*.test.tsx",
      "src/app/admin/sub-roles/**/*.test.tsx",
      "src/app/admin/subscriptions/**/*.test.tsx",
      "src/app/balancer/components/balance-import.test.ts",
      "src/app/balancer/components/balancer-page-selectors.test.ts",
      "src/app/balancer/components/forced-flex-parity.test.ts",
      "src/app/balancer/components/BalancingPoolSidebar.behavior.test.tsx",
      "src/app/balancer/tool-context.test.ts",
      "src/app/balancer/redirect-map.test.ts",
      "src/app/**/users/compare/**/*.test.ts",
      "src/components/tournaments/**/*.test.ts",
      // File-level, not `**/*.test.tsx`: this folder also holds `bun:test`
      // files, which fail on the import when vitest picks them up.
      "src/components/tournaments/MatchReportDialog.behavior.test.tsx",
      "src/components/tournaments/EncounterEditDialog.behavior.test.tsx",
      "src/components/balancer/registrations/**/*.test.tsx",
      "src/components/balancer/form/**/*.test.tsx",
      "src/components/admin/**/*.test.tsx",
      "src/components/admin/**/*.test.ts",
      "src/components/ui/data-pagination.test.tsx",
      "src/components/ui/infinite-scroll.test.tsx",
      "src/components/site/**/*.test.tsx",
      "src/components/ui/toggle-group.test.tsx",
      "src/components/status/**/*.test.tsx",
      // File-level, not a directory glob: this folder holds BOTH runners'
      // tests. `RoleStep.behavior.test.tsx` is `.tsx` yet imports `bun:test`,
      // so a directory glob here drags it into vitest and it fails on the import.
      "src/components/registration/SubscriptionRow.behavior.test.tsx",
      "src/components/registration/CheckInSubscriptionProof.behavior.test.tsx",
      "src/components/registration/DetailsStep.behavior.test.tsx"
    ]
  }
});
