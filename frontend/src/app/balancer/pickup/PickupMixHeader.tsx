"use client";

import { UserPlus } from "lucide-react";

import { EYEBROW_CLASS } from "@/app/balancer/pickup/pickup-chrome";
import { Button } from "@/components/ui/button";
import type { CustomGame } from "@/services/custom-game.service";

type PickupMixHeaderProps = {
  canEdit: boolean;
  game: CustomGame | undefined;
  gameLoading: boolean;
  onOpenPool: () => void;
};

/**
 * The mix this screen is open on: its name, its id, and the one write a host
 * does before touching a lineup -- pull more players in.
 *
 * Which mix this is comes from the route now, not from state this header
 * owns -- switching to another one, or starting a new one, happens on the
 * list at `/balancer/pickup`. This is the only place the mix's name and
 * number sit together.
 */
export function PickupMixHeader({
  canEdit,
  game,
  gameLoading,
  onOpenPool,
}: Readonly<PickupMixHeaderProps>) {
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-[color:var(--aqt-border)] pb-4">
      <div className="min-w-0">
        <div className={EYEBROW_CLASS}>Mix</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
          <h1 className="truncate font-display text-[30px]/[1.1] font-bold tracking-[-0.01em] text-[color:var(--aqt-fg)]">
            {game?.name ?? (gameLoading ? "\u2026" : "No mix yet")}
          </h1>
          {game ? (
            <span className="font-mono text-[15px] font-semibold text-[color:var(--aqt-fg-dim)]">
              {`#${game.id}`}
            </span>
          ) : null}
        </div>
      </div>

      {canEdit ? (
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={game == null}
            onClick={onOpenPool}
          >
            <UserPlus className="mr-1.5 size-3.5" aria-hidden="true" />
            Add players
          </Button>
        </div>
      ) : null}
    </div>
  );
}
