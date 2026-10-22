"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { SocialIcon } from "@/components/social/SocialIcon";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { notify } from "@/lib/notify";
import { displaySocialHandle, getSocialProviderConfig } from "@/lib/social/providers";
import { cn } from "@/lib/utils";
import { workspacePlayerKeys, workspacePlayerService } from "@/services/workspace-player.service";

/**
 * Adding somebody the workspace roster has never seen, from inside the picker.
 *
 * The new member drops straight into this mix on success: a host types a tag
 * *because* that person is in the lobby right now, so making them find the new
 * row afterwards was busywork.
 */
export function AddPlayerIdentityPopover({
  workspaceId,
  discipline,
  canWrite,
  onTogglePlayer
}: Readonly<{
  workspaceId: number;
  discipline: string;
  /** Mix right: a closed mix still accepts a roster addition, it just cannot seat them. */
  canWrite: boolean;
  onTogglePlayer: (memberId: number) => void;
}>) {
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const metadata = useDisciplineMetadata(workspaceId, discipline);
  const provider = metadata.data?.discipline.identity_provider;
  const config = provider ? getSocialProviderConfig(provider) : null;

  const addIdentity = useMutation({
    mutationFn: (input: {
      workspaceId: number; discipline: string; identity: { provider: string; handle: string };
      onAdded?: (memberId: number) => void;
    }) => workspacePlayerService.upsert(input.workspaceId, { discipline: input.discipline, identity: input.identity }),
    onSuccess: async (member, input) => {
      setHandle("");
      setIsAddOpen(false);
      notify.success(`${input.identity.handle} joined the workspace roster`);
      await queryClient.invalidateQueries({ queryKey: workspacePlayerKeys.all(input.workspaceId) });
      input.onAdded?.(member.member_id);
    },
    onError: (error) => notify.apiError(error)
  });

  const submitIdentity = () => {
    if (!provider) return;
    const shown = displaySocialHandle(provider, handle);
    if (!shown) {
      setAddError(`Enter a ${config?.label ?? "game"} handle, for example ${config?.placeholder ?? "Name#TAG"}.`);
      return;
    }
    setAddError(null);
    addIdentity.mutate({ workspaceId, discipline, identity: { provider, handle: shown }, onAdded: canWrite ? onTogglePlayer : undefined });
  };

  return (
    <Popover
      open={isAddOpen}
      onOpenChange={(next) => {
        setIsAddOpen(next);
        if (!next) setAddError(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!provider || !metadata.data?.discipline.enabled}
          className={cn(
            "ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed px-3",
            "border-[color:var(--aqt-border-2)] text-label text-[color:var(--aqt-fg-dim)]",
            "transition-colors hover:border-[color:var(--aqt-border-3)] hover:text-[color:var(--aqt-fg)]"
          )}
        >
          <UserPlus className="size-3.5" aria-hidden="true" />
          {provider ? <SocialIcon provider={provider} size={14} decorative className="size-3.5" /> : null}
          New {config?.label ?? "game"} identity
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitIdentity();
          }}
        >
          <Eyebrow as="p">Add someone new</Eyebrow>
          <div className="flex gap-1.5">
            <Input
              value={handle}
              onChange={(event) => {
                setHandle(event.target.value);
                if (addError) setAddError(null);
              }}
              placeholder={config?.placeholder ?? ""}
              aria-label={`New ${config?.label ?? "game"} identity`}
              autoComplete="off"
              aria-invalid={addError ? true : undefined}
              // `min-w-0`: an `<input>` carries an intrinsic ~170px
              // width that `min-width: auto` turns into a floor.
              className="min-w-0 rounded-lg border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-bg-2)]"
            />
            {/* Enabled while empty on purpose: submit validates and says why. */}
            <Button type="submit" className="shrink-0 px-3" disabled={addIdentity.isPending || !provider}>
              {addIdentity.isPending ? <Spinner className="size-3.5" /> : null}
              Add
            </Button>
          </div>
          <p
            className={cn(
              "text-label",
              addError ? "text-rose-200" : "text-[color:var(--aqt-fg-dim)]"
            )}
          >
            {addError ?? (metadata.isError ? "Unable to load the identity provider." : "Self-declared identity; this does not verify ownership.")}
          </p>
        </form>
      </PopoverContent>
    </Popover>
  );
}
