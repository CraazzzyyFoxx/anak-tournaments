"use client";

import { useState } from "react";
import { UserCog, X } from "lucide-react";

import { ServerSearchCombobox } from "@/components/kit/ServerSearchCombobox";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { CustomGame } from "@/services/custom-game.service";
import { workspacePlayerService, type RosterMember } from "@/services/workspace-player.service";

type MemberOption = { authUserId: number; label: string };
/** A roster member who has signed in at least once, so has an account to grant. */
type LinkedMember = RosterMember & { auth_user_id: number };

const memberLabel = (member: LinkedMember) =>
  member.display_name || member.identity?.handle || `#${member.auth_user_id}`;

interface PickupAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  game: CustomGame | null | undefined;
  addingCoHost: boolean;
  removingCoHostId: number | null;
  transferring: boolean;
  onAddCoHost: (userId: number) => void;
  onRemoveCoHost: (userId: number) => void;
  onTransfer: (userId: number) => void;
}

/** One workspace-roster search box, on the server-search picker every other user search uses. */
function MemberSearchCombobox({
  workspaceId,
  excludeIds,
  placeholder,
  disabled,
  onPick
}: Readonly<{
  workspaceId: number;
  excludeIds: number[];
  placeholder: string;
  disabled: boolean;
  onPick: (option: MemberOption) => void;
}>) {
  return (
    <ServerSearchCombobox<LinkedMember>
      queryKey={["workspace-players-search", workspaceId]}
      fetch={({ query }) =>
        workspacePlayerService
          .list(workspaceId, { query, perPage: 20 })
          .then((page) =>
            // Host and co-host are both addressed by `auth.user.id`, so a member
            // with no linked account (never signed in) cannot be picked here at
            // all -- there is nobody who could ever log in and pass the write
            // check. Filtering them out here, not just disabling them, keeps
            // this the same "type a name, get a name" search every other picker
            // in the app is.
            page.results.filter(
              (member): member is LinkedMember =>
                member.auth_user_id != null && !excludeIds.includes(member.auth_user_id),
            ),
          )
      }
      itemId={(member) => member.auth_user_id}
      label={memberLabel}
      renderItem={(member) => (
        <span className="flex flex-col">
          <span className="truncate">{memberLabel(member)}</span>
          {member.identity?.handle ? (
            <span className="truncate text-xs text-muted-foreground">{member.identity.handle}</span>
          ) : null}
        </span>
      )}
      onSelect={(member) => member && onPick({ authUserId: member.auth_user_id, label: memberLabel(member) })}
      messages={{
        loading: "Loading members…",
        error: "Could not load members. Try again.",
        minChars: "Type at least 2 characters to search.",
        empty: "No workspace member matches that name."
      }}
      placeholder={placeholder}
      searchPlaceholder="Search by name or handle…"
      disabled={disabled}
    />
  );
}

/**
 * Every write here checks the host OR a co-host (`CustomGameService._writable`)
 * -- this is the one place both grants are managed.
 *
 * Co-hosts get exactly the host's write access (roster, balance, outcomes,
 * settings, even transferring the primary host on) the moment they are
 * picked -- no separate confirm, mirroring how quickly a member is added to
 * the lineup itself. Transferring primary ownership stays two-step (pick,
 * then confirm): it is the one action here that can cost the *caller* their
 * own access, unlike granting a co-host, which only ever adds.
 */
export function PickupAccessDialog({
  open,
  onOpenChange,
  workspaceId,
  game,
  addingCoHost,
  removingCoHostId,
  transferring,
  onAddCoHost,
  onRemoveCoHost,
  onTransfer
}: Readonly<PickupAccessDialogProps>) {
  const [transferTarget, setTransferTarget] = useState<MemberOption | null>(null);

  const coHosts = game?.co_hosts ?? [];
  const excludeFromCoHostSearch = [game?.host_user_id, ...coHosts.map((c) => c.user_id)].filter(
    (id): id is number => id != null
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTransferTarget(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-4 w-4" />
            Manage access
          </DialogTitle>
          <DialogDescription>Who else can edit this mix, and who owns it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Co-hosts</Label>
          {coHosts.length > 0 ? (
            <ul className="space-y-1">
              {coHosts.map((coHost) => (
                <li
                  key={coHost.user_id}
                  className="flex items-center justify-between gap-2 rounded-md border border-[color:var(--aqt-border)] px-2.5 py-1.5 text-sm"
                >
                  <span className="truncate">{coHost.display_name || `#${coHost.user_id}`}</span>
                  <IconTooltip control label="Remove co-host" className="shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={removingCoHostId === coHost.user_id}
                      onClick={() => onRemoveCoHost(coHost.user_id)}
                      aria-label={`Remove ${coHost.display_name || `#${coHost.user_id}`} as co-host`}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </IconTooltip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No co-hosts yet.</p>
          )}
          <MemberSearchCombobox
            workspaceId={workspaceId}
            excludeIds={excludeFromCoHostSearch}
            placeholder="Add a co-host…"
            disabled={addingCoHost}
            onPick={(option) => onAddCoHost(option.authUserId)}
          />
          <p className="text-xs text-muted-foreground">
            A co-host writes the roster, balance, outcomes and settings exactly like the host.
          </p>
        </div>

        <div className="space-y-1.5 border-t border-[color:var(--aqt-border)] pt-4">
          <Label>Transfer host</Label>
          <MemberSearchCombobox
            workspaceId={workspaceId}
            excludeIds={game?.host_user_id != null ? [game.host_user_id] : []}
            placeholder={transferTarget?.label ?? "Select a member…"}
            disabled={transferring}
            onPick={setTransferTarget}
          />
          <p className="text-xs text-muted-foreground">
            Hands primary ownership to the pick below. You keep write access only if you stay a co-host.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={transferTarget == null || transferring}
            onClick={() => {
              if (!transferTarget) return;
              onTransfer(transferTarget.authUserId);
              setTransferTarget(null);
            }}
          >
            {transferring ? "Transferring…" : "Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
