import { test as setup } from "@playwright/test";
import fs from "node:fs";
import { ADMIN_FILE, AUTH_DIR } from "./support/env";
import { createUser } from "./support/users";

// One platform superuser per run; every spec reads it from .auth/.
setup("create platform admin", async () => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const { api, ...stored } = await createUser({ superuser: true, prefix: "admin" });
  await api.dispose();
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(stored, null, 2));
});
