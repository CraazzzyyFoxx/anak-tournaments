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
    // was inlined through Vite alongside the app code. `cmdk` calls `useRef` the
    // same way, so every combobox popover threw the moment it opened.
    server: { deps: { inline: ["@tanstack/react-table", "cmdk"] } },
    environment: "node",
    include: [
      "src/app/**/tournaments/**/draft/**/*.test.ts",
      "src/app/**/tournaments/**/veto/**/*.test.ts",
      // `.tsx` needs its own entry: the line above ends in `.test.ts`, so the
      // veto room's behaviour test would never run and the suite would still
      // report green.
      "src/app/**/tournaments/**/veto/**/*.test.tsx",
      "src/app/admin/tournaments/**/components/draft/**/*.test.ts",
      "src/app/admin/tournaments/**/overview/**/*.test.ts",
      "src/app/admin/tournaments/new/**/*.test.ts",
      "src/app/admin/divisions/**/*.test.tsx",
      "src/app/admin/tournaments/**/components/*.test.ts",
      "src/app/admin/tournaments/**/components/*.test.tsx",
      "src/app/admin/tournaments/[id]/tab-guards.test.ts",
      "src/app/admin/players/**/*.test.ts",
      "src/app/admin/__tests__/**/*.test.ts",
      // `include` is an allow-list: a test file outside it never runs and the
      // suite still reports green. Both data-browser dirs are listed up front
      // so the first test added under either one actually executes.
      "src/app/admin/match-reports/**/*.test.ts",
      "src/app/admin/match-reports/**/*.test.tsx",
      "src/app/admin/matches/**/*.test.ts",
      "src/app/admin/matches/**/*.test.tsx",
      "src/app/admin/sub-roles/**/*.test.tsx",
      "src/app/admin/subscriptions/**/*.test.tsx",
      "src/app/admin/workspaces/members/*.test.ts",
      "src/app/balancer/components/balance-import.test.ts",
      "src/app/balancer/components/balancer-page-selectors.test.ts",
      "src/app/balancer/components/forced-flex-parity.test.ts",
      "src/app/balancer/components/BalancingPoolSidebar.behavior.test.tsx",
      "src/app/balancer/tool-context.test.ts",
      "src/app/balancer/redirect-map.test.ts",
      "src/app/**/users/compare/**/*.test.ts",
      "src/app/(site)/tournaments/[id]/_views/_components/participantsColumns.test.tsx",
      // Same allow-list trap: this folder also holds `bun:test` files, so the
      // entry is file-level rather than a directory glob.
      "src/app/(site)/tournaments/[id]/_views/TournamentMapsPage.behavior.test.tsx",
      "src/components/tournaments/**/*.test.ts",
      // File-level, not `**/*.test.tsx`: this folder also holds `bun:test`
      // files, which fail on the import when vitest picks them up.
      "src/components/tournaments/MatchReportDialog.behavior.test.tsx",
      "src/components/tournaments/EncounterEditDialog.behavior.test.tsx",
      "src/components/balancer/registrations/**/*.test.tsx",
      "src/components/balancer/form/**/*.test.tsx",
      "src/components/admin/**/*.test.tsx",
      "src/components/admin/**/*.test.ts",
      // `include` is an allow-list, so a test under a directory absent from it
      // never runs and the suite still reports green.
      "src/components/discord/**/*.test.tsx",
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
      "src/components/registration/DetailsStep.behavior.test.tsx",
      // Same mixed-runner situation in `src/lib`, so file-level again. This one
      // mirrors the backend's best-of resolution and sequence generation, and
      // the veto room runs the SERVER's sequence — an unrun drift check is
      // worse than none, since it reports green either way.
      "src/lib/best-of.test.ts",
      "src/lib/roster-shape.test.ts"
    ]
  }
});
