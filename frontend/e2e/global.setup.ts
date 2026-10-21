import { test as setup } from "@playwright/test";
import fs from "node:fs";
import { ADMIN_FILE, ADMIN_STATE, AUTH_DIR } from "./support/env";
import { createUser, signIn } from "./support/users";

// One platform superuser per run; every spec reads it from .auth/.
setup("create platform admin", async ({ browser }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const admin = await createUser({ superuser: true, prefix: "admin" });
  const { api, ...stored } = admin;
  await api.dispose();
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(stored, null, 2));

  const context = await browser.newContext();
  await signIn(context, admin);
  await context.storageState({ path: ADMIN_STATE });
  await context.close();
});
