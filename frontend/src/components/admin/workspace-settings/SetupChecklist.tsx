"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CircleCheck, CircleDashed } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { TONE_TEXT } from "@/components/kit/tone";
import { PLATFORM_ZONE } from "@/lib/site/host";
import { cn } from "@/lib/utils";
import { workspaceSetupChecklist } from "@/lib/workspace/setup-checklist";
import type { Workspace } from "@/types/workspace.types";

/**
 * The setup checklist of one workspace, as rows: a glyph for done/not yet,
 * the item, and for what is not done yet one sentence on what it gives and a
 * link into the section that sets it.
 *
 * Rendered by the wizard's last step and by the settings overview from the
 * same `workspaceSetupChecklist`, so the two never disagree on what counts
 * as set up. `basePath` is the shell's prefix (`/admin/settings` or
 * `/admin/workspaces/8`), because the same workspace is reached through both.
 *
 * Unframed, rows flush with the edge: the overview puts it inside a settings
 * group card, and a frame of its own there would be a frame in a frame
 * (DESIGN §5). A host without a surface frames it.
 */
export function SetupChecklist({
  workspace,
  basePath
}: Readonly<{ workspace: Workspace; basePath: string }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.setup");
  const items = workspaceSetupChecklist(workspace);

  return (
    <ItemGroup aria-label={t("title")}>
      {items.map((item, index) => {
        const Glyph = item.done ? CircleCheck : CircleDashed;
        return (
          <div key={item.key} role="listitem">
            {index > 0 ? <ItemSeparator /> : null}
            <Item
              size="sm"
              className={cn("px-0", index === 0 && "pt-0", index === items.length - 1 && "pb-0")}
            >
              <ItemMedia>
                <Glyph aria-hidden className={item.done ? TONE_TEXT.success : TONE_TEXT.neutral} />
                <span className="sr-only">{item.done ? t("done") : t("todo")}</span>
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{t(`items.${item.key}`)}</ItemTitle>
                {item.done ? null : (
                  <ItemDescription>{t(`hints.${item.key}`, { zone: PLATFORM_ZONE })}</ItemDescription>
                )}
              </ItemContent>
              {!item.done && item.section ? (
                <ItemActions>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`${basePath}/${item.section}`}>{t("setUp")}</Link>
                  </Button>
                </ItemActions>
              ) : null}
            </Item>
          </div>
        );
      })}
    </ItemGroup>
  );
}
