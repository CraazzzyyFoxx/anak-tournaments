import { expect, test as base, type Page } from "@playwright/test";
import { TOURNAMENT_TABS } from "../support/routes";

// Anonymous GETs only, no assumptions about the data: safe against any
// deployment (E2E_BASE_URL). Imports nothing that writes or shells out —
// which is why the page checks below restate the few lines of
// support/fixtures.ts they need instead of importing it.

// Same list as support/fixtures.ts, matched against "<message> @ <resource url>".
const IGNORED_CONSOLE = [
  /Download the React DevTools/,
  /\[HMR\]/,
  /\[Fast Refresh\]/,
  /webpack-hmr|turbopack-hmr|_next\/webpack-hmr/,
  /Failed to load resource: .*(s3\.invalid|favicon)/,
  /Failed to load resource: .*401.* @ \S*\/(api\/v1\/auth\/me|auth\/refresh)(\?|$)/,
];
const NOT_FOUND_TITLE = "That route is off the board.";

type Paged<T> = { results: T[]; total: number; page: number; per_page: number };
type TournamentRow = { id: number; slug: string; name: string; status: string; discipline: string };
type Discipline = { code: string; name: string; enabled: boolean; kinds: Record<string, string> };

const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(`pageerror ${page.url()}: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const where = `${msg.text()} @ ${msg.location().url ?? ""}`;
        if (!IGNORED_CONSOLE.some((re) => re.test(where))) errors.push(`console ${page.url()}: ${msg.text().slice(0, 500)}`);
      });
      await use(errors);
      if (testInfo.status === "passed") expect(errors, "page errors / console errors").toEqual([]);
    },
    { auto: true },
  ],
});

/** A public page answers, renders its own content and no error state. */
async function expectPublicPage(page: Page, url: string, opts: { landmark?: boolean } = {}) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded" });
  expect(res?.status(), `${url} document status`).toBeLessThan(400);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await expect(page.locator("nextjs-portal [data-nextjs-dialog], [data-nextjs-error-overlay]"), `${url}: Next error overlay`).toHaveCount(0);
  await expect(page.getByText(/Application error|Unhandled Runtime Error|Something went wrong/i), `${url}: error boundary`).toHaveCount(0);
  await expect(page.getByText(NOT_FOUND_TITLE), `${url}: not-found page`).toHaveCount(0);
  const scope = opts.landmark === false ? page.locator("body") : page.getByRole("main").first();
  await expect(scope, `${url}: main landmark`).toBeVisible();
  // An empty/locked section shows a page-state card (role=status, its title a heading) instead of the section's own.
  const stateCard = scope.getByRole("status").filter({ visible: true, hasText: /\S/, hasNotText: /Loading/i });
  await expect(scope.getByRole("heading").or(stateCard).first(), `${url}: page heading`).toBeVisible();
  // PageStateCard `error` (<section role=alert>); the route announcer also uses role=alert.
  await expect(page.locator("section[role=alert]").filter({ visible: true }), `${url}: error state rendered`).toHaveCount(0);
}

test.describe("public API", () => {
  test("tournament list, facets and lookup", async ({ request }) => {
    const list = await request.get("/api/v1/tournaments");
    expect(list.status()).toBe(200);
    const page = (await list.json()) as Paged<TournamentRow>;
    expect(page).toMatchObject({ page: 1, total: expect.any(Number), per_page: expect.any(Number) });
    expect(page.results.length).toBeLessThanOrEqual(page.per_page);
    for (const t of page.results) {
      expect(t).toMatchObject({ id: expect.any(Number), slug: expect.any(String), name: expect.any(String), status: expect.any(String) });
    }

    const facets = await request.get("/api/v1/tournaments/facets");
    expect(facets.status()).toBe(200);
    const counts = (await facets.json()) as { total: number; live: number; by_status: Record<string, number> };
    expect(counts.total, "facets total").toEqual(expect.any(Number));
    const byStatus = Object.values(counts.by_status).reduce((sum, n) => sum + n, 0);
    expect(byStatus, "facets by_status adds up to the total").toBe(counts.total);

    const lookup = await request.get("/api/v1/tournaments/lookup");
    expect(lookup.status()).toBe(200);
    const items = (await lookup.json()) as { id: number; name: string }[];
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) expect(item).toEqual({ id: expect.any(Number), name: expect.any(String) });
  });

  test("disciplines and every declared catalog kind", async ({ request }) => {
    const res = await request.get("/api/v1/disciplines");
    expect(res.status()).toBe(200);
    const disciplines = (await res.json()) as Discipline[];
    expect(disciplines.map((d) => d.code), "the three games of the multi-game release").toEqual(
      expect.arrayContaining(["overwatch", "lol", "deadlock"])
    );
    for (const d of disciplines) {
      expect(d).toMatchObject({ code: expect.any(String), name: expect.any(String), kinds: expect.any(Object) });
      for (const kind of Object.keys(d.kinds)) {
        const catalog = await request.get(`/api/v1/catalog/${d.code}/${kind}`);
        expect(catalog.status(), `GET /api/v1/catalog/${d.code}/${kind}`).toBe(200);
        expect(await catalog.json()).toMatchObject({ results: expect.any(Array), total: expect.any(Number) });
      }
    }
  });

  test("workspace directory", async ({ request }) => {
    const res = await request.get("/api/v1/workspaces");
    expect(res.status()).toBe(200);
    const workspaces = (await res.json()) as { id: number; slug: string; name: string; is_hidden: boolean }[];
    expect(Array.isArray(workspaces)).toBe(true);
    for (const ws of workspaces) {
      expect(ws).toMatchObject({ id: expect.any(Number), slug: expect.any(String), name: expect.any(String) });
      expect(ws.is_hidden, `${ws.slug}: hidden workspace in the anonymous directory`).toBe(false);
    }
  });
});

test.describe("public pages", () => {
  for (const url of ["/", "/tournaments", "/statistics", "/users", "/achievements", "/encounters", "/scrims", "/docs"]) {
    test(url, async ({ page }) => {
      await expectPublicPage(page, url);
    });
  }

  // The balancer tool without `?tournament=` is a pointer screen outside the site shell, in its own <main>.
  test("/balancer", async ({ page }) => {
    await expectPublicPage(page, "/balancer");
  });

  test("first listed tournament and its tabs", async ({ page, request }) => {
    const list = (await (await request.get("/api/v1/tournaments")).json()) as Paged<TournamentRow>;
    test.skip(list.results.length === 0, "deployment has no public tournament");
    const { slug } = list.results[0];
    for (const tab of TOURNAMENT_TABS) {
      const url = `/tournaments/${slug}${tab ? `/${tab}` : ""}`;
      await expectPublicPage(page, url);
      await expect(page, `${url}: stays on the tournament`).toHaveURL(new RegExp(`/tournaments/${slug}`));
    }
  });
});
