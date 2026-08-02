"use client";

import { Plus } from "lucide-react";

import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BalancerApplication, BalancerRoleCode } from "@/types/balancer-admin.types";
import { ROLE_LABELS, buildApplicationSearchIndex } from "@/app/balancer/components/workspace-helpers";

type PoolAvailableListProps = {
  applications: BalancerApplication[];
  /** Already trimmed and lower-cased by the sidebar so one input drives every view. */
  searchQuery: string;
  onAddFromApplication: (application: BalancerApplication) => void;
  disabled?: boolean;
};

/** Applications carry free-form role strings; players carry `BalancerRoleCode`. */
function normalizeApplicationRole(role: string | null | undefined): BalancerRoleCode | null {
  switch (role?.trim().toLowerCase()) {
    case "tank":
      return "tank";
    case "dps":
    case "damage":
      return "dps";
    case "support":
      return "support";
    default:
      return null;
  }
}

/**
 * The Available view of the Balancing Pool: approved registrations that are not in the pool yet.
 */
export function PoolAvailableList({
  applications,
  searchQuery,
  onAddFromApplication,
  disabled = false,
}: PoolAvailableListProps) {
  const matches = searchQuery
    ? applications.filter((application) => buildApplicationSearchIndex(application).includes(searchQuery))
    : applications;

  if (matches.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[color:var(--aqt-border-2)] px-4 py-8 text-center">
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-[color:var(--aqt-fg)]">
            {searchQuery ? "No available registrations match this search" : "No available registrations"}
          </p>
          <p className="text-xs text-[color:var(--aqt-fg-dim)]">
            {searchQuery
              ? "Try another BattleTag or role."
              : "Every approved registration is already in the Balancing Pool."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="space-y-1.5 pr-2">
        {matches.map((application) => {
          const roleCodes = [application.primary_role, ...application.additional_roles_json]
            .map(normalizeApplicationRole)
            .filter((roleCode, index, all): roleCode is BalancerRoleCode =>
              roleCode !== null && all.indexOf(roleCode) === index,
            );

          return (
            <button
              key={application.id}
              type="button"
              disabled={disabled}
              onClick={() => onAddFromApplication(application)}
              className="flex w-full items-center gap-2 rounded-xl border border-[color:var(--aqt-border)] bg-white/[0.02] px-2.5 py-2 text-left transition-colors hover:border-[color:var(--aqt-border-2)] hover:bg-white/[0.04] disabled:opacity-50"
            >
              {roleCodes.length > 0 ? (
                <span className="flex items-center gap-1">
                  {roleCodes.map((roleCode) => (
                    <span key={roleCode} title={ROLE_LABELS[roleCode]} className="opacity-95">
                      <PlayerRoleIcon role={ROLE_LABELS[roleCode]} size={15} />
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-[11px] text-[color:var(--aqt-fg-dim)]">No roles</span>
              )}
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[color:var(--aqt-fg)]">
                {application.battle_tag}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-[color:var(--aqt-fg-dim)]">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Include
              </span>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
