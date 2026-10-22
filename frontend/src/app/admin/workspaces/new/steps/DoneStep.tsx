"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";

import { SetupChecklist } from "@/components/admin/workspace-settings/SetupChecklist";
import { WorkspaceIcon } from "@/components/admin/workspaces/WorkspaceCells";
import { eyebrowClass } from "@/components/ui/eyebrow";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle
} from "@/components/ui/item";
import { PLATFORM_ZONE } from "@/lib/site/host";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { Workspace } from "@/types/workspace.types";

const NEXT_LINKS = [
  { key: "tournament", href: "/admin/tournaments?create=1" },
  { key: "members", href: "/admin/members" },
  { key: "access", href: "/admin/access" }
] as const;

/**
 * Step 5: the workspace as it now stands, what is left to set up, and where
 * to go next. Arriving here makes it the admin's current workspace, so every
 * link below (settings, members, access) lands in it.
 */
export function DoneStep({ workspace }: Readonly<{ workspace: Workspace }>) {
  const t = useTranslations("adminWorkspace.newWorkspace.done");
  const setCurrentWorkspace = useWorkspaceStore((state) => state.setCurrentWorkspace);

  useEffect(() => {
    setCurrentWorkspace(workspace.id);
  }, [setCurrentWorkspace, workspace.id]);

  return (
    <div className="flex flex-col gap-6">
      <Item variant="outline" size="sm">
        <ItemMedia>
          <WorkspaceIcon workspace={workspace} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{workspace.name}</ItemTitle>
          <ItemDescription className="font-mono">
            {PLATFORM_ZONE}/workspace/{workspace.slug}
          </ItemDescription>
        </ItemContent>
      </Item>

      <section className="flex flex-col gap-2">
        <h3 className={eyebrowClass("muted")}>{t("setupTitle")}</h3>
        <div className="rounded-lg border border-border px-4 py-3">
          <SetupChecklist workspace={workspace} basePath="/admin/settings" />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className={eyebrowClass("muted")}>{t("nextTitle")}</h3>
        <ItemGroup className="rounded-lg border border-border">
          {NEXT_LINKS.map(({ key, href }, index) => (
            <div key={key} role="listitem">
              {index > 0 ? <ItemSeparator /> : null}
              <Item asChild size="sm">
                <Link href={href}>
                  <ItemContent>
                    <ItemTitle>{t(`next.${key}.title`)}</ItemTitle>
                    <ItemDescription>{t(`next.${key}.description`)}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </ItemActions>
                </Link>
              </Item>
            </div>
          ))}
        </ItemGroup>
      </section>
    </div>
  );
}
