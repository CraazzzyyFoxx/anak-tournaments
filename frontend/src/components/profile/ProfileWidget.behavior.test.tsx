// @vitest-environment happy-dom
//
// On a tenant (white-label) host the profile's axis is the tenant's workspace (§2.2): the stat-vocabulary reads of
// the profile widgets and their generic table go there and are cached under it — never `workspace_id=all`.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import { disciplineQueryKeys } from "@/lib/site/discipline-query-keys";
import { LOL_METADATA } from "@/test/discipline-metadata";

import CharacterStatsTable from "./CharacterStatsTable";
import ProfileWidget from "./ProfileWidget";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const reads = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/services/discipline.service", () => ({
  default: {
    metadata: async (axis: unknown, code: string) => {
      reads.push([axis, code]);
      return { ...LOL_METADATA, workspace_id: axis };
    }
  }
}));

const TENANT = 42;

it("reads the game's metadata on the tenant's axis and keys it there, never on all", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={client}>
          <ProfileWidget
            axis={TENANT}
            discipline="lol"
            slot="topCharacters"
            props={{ characters: [], games: null, userSlug: "p" }}
            fallback={<CharacterStatsTable axis={TENANT} discipline="lol" characters={[]} title="generic table" />}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }

  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(([axis]) => axis === TENANT)).toBe(true);
  expect(client.getQueryData(disciplineQueryKeys.metadata(TENANT, "lol"))).toBeDefined();
  expect(client.getQueryData(disciplineQueryKeys.metadata("all", "lol"))).toBeUndefined();
  // League has no profile module: the generic table stands in, once the loader has said so.
  expect(container.textContent).toContain("generic table");

  await act(async () => root.unmount());
  container.remove();
});
