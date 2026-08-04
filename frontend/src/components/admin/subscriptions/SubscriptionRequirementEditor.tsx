"use client";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { describeRequirement } from "@/lib/subscription-requirement";
import type {
  SubscriptionProviderRequirement,
  SubscriptionRequirement
} from "@/types/registration.types";

/** Tier options per provider, in that provider's OWN vocabulary.
 *
 *  A shared numeric spinner would imply Boosty "Уровень 2" and Twitch "Tier 2"
 *  are comparable. They are not: each provider's threshold is evaluated only
 *  against its own verdict.
 */
const TIER_OPTIONS: Record<string, Array<{ rank: number; label: string }>> = {
  boosty: [
    { rank: 1, label: "любой уровень" },
    { rank: 2, label: "Уровень 2+" },
    { rank: 3, label: "Уровень 3+" }
  ],
  twitch: [
    { rank: 1, label: "Tier 1+" },
    { rank: 2, label: "Tier 2+" },
    { rank: 3, label: "Tier 3+" }
  ]
};

const PROVIDER_LABELS: Record<string, string> = {
  boosty: "Boosty",
  twitch: "Twitch"
};

interface SubscriptionRequirementEditorProps {
  value: SubscriptionRequirement;
  onChange: (next: SubscriptionRequirement) => void;
  /** Providers configured AND enabled for this workspace. */
  availableProviders: string[];
  disabled?: boolean;
}

export default function SubscriptionRequirementEditor({
  value,
  onChange,
  availableProviders,
  disabled = false
}: SubscriptionRequirementEditorProps) {
  const rows = value.requirements ?? [];
  const mode = value.mode ?? "all";

  // A single requirement makes `any` and `all` the same answer, so offering the
  // choice invites a meaningless decision.
  const showModeSelector = rows.length > 1;

  const unavailable = rows
    .map((row) => row.provider)
    .filter((provider) => provider && !availableProviders.includes(provider));

  const update = (next: Partial<SubscriptionRequirement>) =>
    onChange({ mode, requirements: rows, ...next });

  const updateRow = (index: number, patch: Partial<SubscriptionProviderRequirement>) =>
    update({ requirements: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) });

  const remaining = availableProviders.filter(
    (provider) => !rows.some((row) => row.provider === provider)
  );

  return (
    <div className="space-y-3">
      {showModeSelector && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Match</span>
          <Select
            value={mode}
            disabled={disabled}
            onValueChange={(value) => update({ mode: value as "any" | "all" })}
          >
            <SelectTrigger className="h-8 w-[190px] text-sm" aria-label="Requirement match mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All of the below</SelectItem>
              <SelectItem value="any">Any one of the below</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No providers selected — the gate is inactive even while the toggle is on.
        </p>
      )}

      {rows.map((row, index) => {
        const tiers = TIER_OPTIONS[row.provider] ?? [{ rank: 1, label: "any tier" }];
        return (
          <div key={`${row.provider}-${index}`} className="flex items-center gap-2">
            <Select
              value={row.provider}
              disabled={disabled}
              onValueChange={(value) => updateRow(index, { provider: value })}
            >
              <SelectTrigger className="h-8 w-[140px] text-sm" aria-label="Provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Keep the current value selectable even when unavailable, so
                    opening the form does not silently rewrite a saved rule. */}
                {[...new Set([row.provider, ...availableProviders])]
                  .filter(Boolean)
                  .map((provider) => (
                    <SelectItem key={provider} value={provider}>
                      {PROVIDER_LABELS[provider] ?? provider}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select
              value={String(row.min_tier_rank ?? 1)}
              disabled={disabled}
              onValueChange={(value) => updateRow(index, { min_tier_rank: Number(value) })}
            >
              <SelectTrigger className="h-8 w-[170px] text-sm" aria-label="Minimum tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tiers.map((tier) => (
                  <SelectItem key={tier.rank} value={String(tier.rank)}>
                    {tier.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => update({ requirements: rows.filter((_, i) => i !== index) })}
              aria-label={`Remove ${PROVIDER_LABELS[row.provider] ?? row.provider}`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        );
      })}

      {remaining.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            update({ requirements: [...rows, { provider: remaining[0], min_tier_rank: 1 }] })
          }
        >
          <Plus className="mr-1.5 size-3.5" />
          Add provider
        </Button>
      )}

      {unavailable.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2.5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          <p className="text-xs text-warning">
            {unavailable.map((p) => PROVIDER_LABELS[p] ?? p).join(", ")} is not configured for this
            workspace. Its verdict resolves to <em>undetermined</em>, which fails open — the gate
            silently stops enforcing that provider.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Players must have: <span className="font-medium">{describeRequirement(value)}</span>
        </p>
      )}
    </div>
  );
}
