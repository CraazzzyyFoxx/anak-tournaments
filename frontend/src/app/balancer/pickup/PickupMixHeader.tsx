"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Plus, UserPlus } from "lucide-react";

import {
  CAPTION_CLASS,
  EYEBROW_CLASS,
  MIX_STATUS_CLASS,
} from "@/app/balancer/pickup/pickup-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { CustomGame, CustomGameStatus } from "@/services/custom-game.service";

import { PICKUP_STATUS_LABELS } from "./pickup-lineup";

type PickupMixHeaderProps = {
  canEdit: boolean;
  games: CustomGame[];
  gamesLoading: boolean;
  game: CustomGame | undefined;
  selectedGameId: number | null;
  onSelectGame: (gameId: number) => void;
  creating: boolean;
  onCreateGame: (name: string) => void;
  onOpenPool: () => void;
};

/**
 * Which mix is open, and the two things a host does before touching a lineup:
 * switch to another mix, or start a new one.
 *
 * These used to live inside the teams column, above the balance result, where
 * they competed with it for the reader's first glance. Identity belongs to the
 * page, not to one of its panels — and it is the only place the mix's name,
 * number and status can sit together without repeating any of them.
 */
export function PickupMixHeader({
  canEdit,
  games,
  gamesLoading,
  game,
  selectedGameId,
  onSelectGame,
  creating,
  onCreateGame,
  onOpenPool,
}: Readonly<PickupMixHeaderProps>) {
  const [newName, setNewName] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const status = (game?.status ?? "draft") as CustomGameStatus;

  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-[color:var(--aqt-border)] pb-4">
      <div className="min-w-0">
        <div className={EYEBROW_CLASS}>Mix</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
          <h1 className="truncate font-display text-[30px]/[1.1] font-bold tracking-[-0.01em] text-[color:var(--aqt-fg)]">
            {game?.name ?? (gamesLoading ? "\u2026" : "No mix yet")}
          </h1>
          {game ? (
            <span className="font-mono text-[15px] font-semibold text-[color:var(--aqt-fg-dim)]">
              {`#${game.id}`}
            </span>
          ) : null}

          {/* A picker, not a list: the mix a host is running is the page, and the
              others are somewhere to go — so it collapses to one line of chrome. */}
          <Select
            value={selectedGameId == null ? undefined : String(selectedGameId)}
            disabled={gamesLoading || games.length < 2}
            onValueChange={(value) => onSelectGame(Number(value))}
          >
            <SelectTrigger
              aria-label="Switch mix"
              className={cn(
                "h-7 w-auto gap-1.5 rounded-lg border-[color:var(--aqt-border)] bg-transparent px-2.5",
                "text-[13px] text-[color:var(--aqt-fg-dim)]",
                "hover:border-[color:var(--aqt-border-3)] hover:text-[color:var(--aqt-fg-muted)]",
                "[&>svg]:hidden",
              )}
            >
              <SelectValue placeholder="Switch mix">Switch mix</SelectValue>
              <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
            </SelectTrigger>
            <SelectContent>
              {games.map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {game ? (
            <span
              className={cn(
                "flex h-5.5 items-center rounded-md border px-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]",
                MIX_STATUS_CLASS[status] ?? MIX_STATUS_CLASS.draft,
              )}
            >
              {PICKUP_STATUS_LABELS[game.status] ?? game.status}
            </span>
          ) : null}
        </div>
        <p className={cn(CAPTION_CLASS, "mt-2")}>
          {game
            ? `${games.length} ${games.length === 1 ? "mix" : "mixes"} in this workspace \u00B7 ranks carry across every tournament in it`
            : "Ranks carry across every tournament in this workspace"}
        </p>
      </div>

      {canEdit ? (
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={selectedGameId == null}
            onClick={onOpenPool}
          >
            <UserPlus className="mr-1.5 size-3.5" aria-hidden="true" />
            Add players
          </Button>
          <Popover
            open={isCreateOpen}
            onOpenChange={(open) => {
              setIsCreateOpen(open);
              if (!open) setNewName("");
            }}
          >
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" className="h-9">
                <Plus className="mr-1.5 size-3.5" aria-hidden="true" />
                New mix
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <form
                className="space-y-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newName.trim();
                  if (!name) return;
                  onCreateGame(name);
                  setNewName("");
                  setIsCreateOpen(false);
                }}
              >
                <label htmlFor="pickup-new-mix" className={cn(EYEBROW_CLASS, "block")}>
                  New mix
                </label>
                <div className="flex gap-1.5">
                  <Input
                    id="pickup-new-mix"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="Thursday scrim"
                    autoComplete="off"
                    className="h-9 min-w-0 rounded-lg border-[color:var(--aqt-border-2)] bg-black/15 text-sm"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="h-9 shrink-0 px-3"
                    disabled={creating || !newName.trim()}
                  >
                    {creating ? (
                      <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden="true" />
                    ) : null}
                    Create
                  </Button>
                </div>
                <p className="text-[11px] text-[color:var(--aqt-fg-dim)]">
                  Starts empty — fill it from the workspace player pool.
                </p>
              </form>
            </PopoverContent>
          </Popover>
        </div>
      ) : null}
    </div>
  );
}
