"use client";

import React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface UserBattleTagsProps {
  tags: string[];
  maxVisible?: number;
  className?: string;
}

const chipClassName =
  "inline-flex items-center gap-2 rounded-full border bg-background/15 px-3 py-2 text-sm font-semibold text-muted-foreground";

const UserBattleTags = ({ tags, maxVisible = 6, className }: UserBattleTagsProps) => {
  const visible = tags.slice(0, maxVisible);
  const hiddenCount = Math.max(0, tags.length - visible.length);

  return (
    <div className={cn("mt-1 flex flex-wrap gap-2 max-w-full", className)}>
      {visible.map((battleTag, index) => (
        <span key={`${battleTag}-${index}`} className={chipClassName}>
          <span className="max-w-[260px] truncate" title={battleTag}>
            {battleTag}
          </span>
        </span>
      ))}

      {hiddenCount > 0 ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className={cn(chipClassName, "text-foreground hover:bg-background/25")}
              aria-label={`Show ${hiddenCount} more battle tags`}
            >
              +{hiddenCount}
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Battle tags</DialogTitle>
              <DialogDescription>All linked Battle.net tags for this user.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[360px] pr-2">
              <div className="grid gap-2">
                {tags.map((battleTag, index) => (
                  <div key={`${battleTag}-${index}`} className="rounded-lg border bg-background/10 px-3 py-2">
                    <div className="text-sm font-semibold tabular-nums">{battleTag}</div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
};

export default UserBattleTags;
