import { resolveServerDisciplineScope } from "@/lib/site/tenant-host";
import type { BrowsingDisciplineInit } from "@/lib/site/discipline-scope";
import disciplineService from "@/services/discipline.service";

/**
 * The server render's browsing-discipline inputs: the saved cookie, the workspace
 * axis (tenant host first) and the installed games read for that same axis. A failed
 * read is `disciplines: null`, never an empty list — the client then fetches it
 * itself instead of rendering an "unavailable" state the server only guessed at.
 * Server-only.
 */
export async function loadBrowsingDisciplineInit(): Promise<BrowsingDisciplineInit> {
  const scope = await resolveServerDisciplineScope();
  const disciplines = await disciplineService.list(scope.axis).catch(() => null);
  return { ...scope, disciplines };
}
