import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import { Api } from "./api";
import { ADMIN_FILE } from "./env";
import { signIn, createUser, type TestUser } from "./users";

type StoredUser = Omit<TestUser, "api">;

// Console noise that is not a product failure: the dev overlay's HMR socket,
// React DevTools hints, resources the isolated stack cannot serve (S3 images
// point at an unreachable bucket on purpose), and the signed-out session
// probe: AuthBootstrap asks `/auth/me`, then tries `/auth/refresh`, and a
// visitor without a session gets 401 from both by design. Matched against
// "<message> @ <resource url>".
const IGNORED_CONSOLE = [
  /Download the React DevTools/,
  /\[HMR\]/,
  /\[Fast Refresh\]/,
  /webpack-hmr|turbopack-hmr|_next\/webpack-hmr/,
  /Failed to load resource: .*(s3\.invalid|favicon)/,
  /Failed to load resource: .*401.* @ \S*\/(api\/v1\/auth\/me|auth\/refresh)(\?|$)/,
  // AchievementArt tries `/achievements/<slug>.webp` and falls back to a monogram by design.
  /Failed to load resource: .*400.* @ \S*\/_next\/image\?url=%2Fachievements%2F/,
];

type Fixtures = {
  /** Platform superuser bearer client. */
  adminApi: Api;
  /** Anonymous gateway client. */
  anonApi: Api;
  /** Fresh non-admin user per call; disposed after the test. */
  makeUser: (prefix?: string) => Promise<TestUser>;
  /** A page signed in as `user` in its own browser context, on a session of its own. */
  pageAs: (user: Pick<TestUser, "email">) => Promise<Page>;
  /** Uncaught page errors and console errors collected during the test. */
  pageErrors: string[];
};

type WorkerFixtures = { admin: StoredUser };

export const test = base.extend<Fixtures, WorkerFixtures>({
  admin: [
    async ({}, use) => {
      await use(JSON.parse(fs.readFileSync(ADMIN_FILE, "utf8")) as StoredUser);
    },
    { scope: "worker" },
  ],
  adminApi: async ({ admin }, use) => {
    const api = await Api.create(admin.accessToken);
    await use(api);
    await api.dispose();
  },
  anonApi: async ({}, use) => {
    const api = await Api.create();
    await use(api);
    await api.dispose();
  },
  makeUser: async ({}, use) => {
    const made: TestUser[] = [];
    await use(async (prefix) => {
      const user = await createUser({ prefix });
      made.push(user);
      return user;
    });
    await Promise.all(made.map((u) => u.api.dispose()));
  },
  pageAs: async ({ browser, pageErrors }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (user) => {
      const context = await browser.newContext();
      contexts.push(context);
      await signIn(context, user);
      const page = await context.newPage();
      watchErrors(page, pageErrors);
      return page;
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
  // Fails a passing test that left uncaught page errors or console errors.
  // A test that provokes one on purpose clears it: `pageErrors.length = 0`.
  pageErrors: async ({}, use, testInfo) => {
    const errors: string[] = [];
    await use(errors);
    if (testInfo.status === "passed") {
      expect(errors, "page errors / console errors during the test").toEqual([]);
    }
  },
  // In the browser projects the default page is the platform admin, on a
  // session of its own; an `api` spec's page stays anonymous.
  context: async ({ context, admin }, use, testInfo) => {
    if (testInfo.project.name !== "api") await signIn(context, admin);
    await use(context);
  },
  page: async ({ page, pageErrors }, use) => {
    watchErrors(page, pageErrors);
    await use(page);
  },
});

function watchErrors(page: Page, sink: string[]) {
  page.on("pageerror", (err) => sink.push(`pageerror ${page.url()}: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    const where = `${text} @ ${msg.location().url ?? ""}`;
    if (IGNORED_CONSOLE.some((re) => re.test(where))) return;
    sink.push(`console ${page.url()}: ${text.slice(0, 500)}`);
  });
}

/** Opens `url` and fails on a 5xx document, the Next error overlay or an error boundary. */
export async function openPage(page: Page, url: string) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded" });
  expect(res, `no response for ${url}`).not.toBeNull();
  expect(res!.status(), `${url} document status`).toBeLessThan(500);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await expectNoCrash(page, url);
  return res!;
}

export async function expectNoCrash(page: Page, where = page.url()) {
  await expect(page.locator("nextjs-portal [data-nextjs-dialog], [data-nextjs-error-overlay]"), `${where}: Next error overlay`).toHaveCount(0);
  await expect(page.getByText(/Application error|Unhandled Runtime Error|Something went wrong/i), `${where}: error boundary`).toHaveCount(0);
}

export { expect };
