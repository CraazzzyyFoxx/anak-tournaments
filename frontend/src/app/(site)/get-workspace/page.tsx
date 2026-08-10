import { getTranslations } from "next-intl/server";

import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/**
 * Explains what a workspace is and how to get one. There is no self-service
 * signup (workspace creation is superuser-only, see /admin/workspaces), so
 * this page's only job is to point visitors at the platform administrator
 * instead of leaving "get your own community space" undiscoverable.
 */
export default async function GetWorkspacePage() {
  const t = await getTranslations();

  return (
    <div className="mx-auto max-w-lg space-y-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
              {t("getWorkspace.title")}
            </h1>
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            {t("getWorkspace.description")}
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
