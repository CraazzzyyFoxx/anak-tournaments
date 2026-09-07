"use client";

import { useMutation } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { TONE_CLASS, type Tone } from "@/components/admin/tone";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import workspaceService from "@/services/workspace.service";
import type { Workspace, WorkspaceVerificationStatus } from "@/types/workspace.types";

const TIERS: Record<WorkspaceVerificationStatus, { label: string; tone: Tone }> = {
  unverified: { label: "Unverified", tone: "warning" },
  verified: { label: "Verified", tone: "info" },
  trusted: { label: "Trusted", tone: "success" }
};

const ORDER: WorkspaceVerificationStatus[] = ["unverified", "verified", "trusted"];

/** The trust tier of a workspace, next to its name. */
export function WorkspaceVerificationBadge({
  status
}: Readonly<{ status: WorkspaceVerificationStatus }>) {
  const tier = TIERS[status] ?? TIERS.unverified;
  return (
    <Badge variant="outline" className={cn(TONE_CLASS[tier.tone])}>
      {tier.label}
    </Badge>
  );
}

/**
 * Why a self-service workspace is invisible, said on the screen its owner
 * already opened.
 *
 * The public directory lists `trusted` workspaces only, so an organiser who
 * just created one finds it nowhere on the home page and has no other way to
 * learn that this is by design rather than a bug. Shown for `unverified` and
 * `verified` alike — `verified` is a step, not the finish line.
 */
export function WorkspaceNotListedNotice({
  status
}: Readonly<{ status: WorkspaceVerificationStatus }>) {
  if (status === "trusted") return null;

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        TONE_CLASS[TIERS[status]?.tone ?? "warning"]
      )}
    >
      <p className="font-medium">Not listed on the home page yet</p>
      <p className="mt-1 max-w-prose opacity-90">
        Your workspace is live — you can run tournaments, invite members and share its link right
        now. It stays off the public workspace directory until the platform team reviews it.
        Linking the Discord server you run helps that review along.
      </p>
    </div>
  );
}

/** Superuser-only trust tier control. Renders nothing for anyone else. */
export function WorkspaceVerificationControl({
  workspace,
  isSuperuser,
  onChanged
}: Readonly<{ workspace: Workspace; isSuperuser: boolean; onChanged: () => void }>) {
  const mutation = useMutation({
    mutationFn: (status: WorkspaceVerificationStatus) =>
      workspaceService.setVerificationStatus(workspace.id, status),
    onSuccess: (updated) => {
      onChanged();
      notify.success(`Verification set to ${TIERS[updated.verification_status]?.label ?? updated.verification_status}`);
    },
    onError: (error) => notify.apiError(error, { title: "Could not change the verification tier" })
  });

  if (!isSuperuser) return null;

  return (
    <div>
      <label htmlFor="workspace-verification" className="text-sm font-medium leading-none">
        Verification tier
      </label>
      <Select
        value={workspace.verification_status}
        disabled={mutation.isPending}
        onValueChange={(next) => mutation.mutate(next as WorkspaceVerificationStatus)}
      >
        <SelectTrigger id="workspace-verification" className="mt-1.5 w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ORDER.map((status) => (
            <SelectItem key={status} value={status}>
              {TIERS[status].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1 max-w-prose text-xs text-muted-foreground">
        Only “Trusted” workspaces appear in the public directory on the home page.
      </p>
    </div>
  );
}
