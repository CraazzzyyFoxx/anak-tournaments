"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify } from "@/lib/notify";
import balancerAdminService from "@/services/balancer-admin.service";
import type {
  SubscriptionCodeUpsert,
  SubscriptionProviderConfigRead,
  SubscriptionRoleTier,
  VerificationMethod
} from "@/types/registration.types";

const PROVIDER_LABELS: Record<string, string> = {
  boosty: "Boosty",
  twitch: "Twitch"
};

interface MethodOption {
  value: VerificationMethod;
  label: string;
  description: string;
}

/** `live` is stored provider-agnostically, so its label and blurb are resolved per
 *  provider — "Discord role" is meaningless for Twitch and vice versa. */
const LIVE_LABELS: Record<string, string> = {
  boosty: "Discord role",
  twitch: "Twitch subscription"
};

const LIVE_DESCRIPTIONS: Record<string, string> = {
  boosty:
    "Boosty's own bot assigns a role per level; we read the patron's roles in your server. Needs a linked Discord account.",
  twitch: "Read directly from Twitch. Affiliate/Partner channels only."
};

const CODE_AND_EITHER: readonly MethodOption[] = [
  {
    value: "code",
    label: "Challenge code",
    description:
      "You publish a secret in a subscriber-only post and the player pastes it. Works without Discord, but a code is shareable."
  },
  {
    value: "any",
    label: "Either",
    description: "Whichever the player can produce. The most permissive option."
  }
];

interface SubscriptionProvidersCardProps {
  workspaceId: number;
}

export default function SubscriptionProvidersCard({ workspaceId }: SubscriptionProvidersCardProps) {
  const queryClient = useQueryClient();
  const queryKey = ["subscription-providers", workspaceId] as const;

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => balancerAdminService.listSubscriptionProviders(workspaceId),
    // A refetch remounts the editors (see the key below), which would discard
    // half-typed role ids and codes. The only refetch we want is our own, after a
    // save, where discarding local state is precisely the point.
    refetchOnWindowFocus: false
  });

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <div className="font-medium">Subscription providers</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Raw ids for now — paste the Discord guild and role ids by hand (enable Developer Mode in
          Discord, then right-click → Copy ID). Boosty&apos;s own bot assigns those roles, so the
          mapping is what turns a role into a subscription tier.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          Loading…
        </div>
      )}

      {/* The key carries the server's state, so a successful save remounts the
          editor with fresh values instead of syncing props into state inside an
          effect. Safe only because this query never refetches behind the user's
          back — see `refetchOnWindowFocus` above. */}
      {data?.configs.map((config) => (
        <ProviderEditor
          key={`${config.provider}:${JSON.stringify(config)}`}
          workspaceId={workspaceId}
          config={config}
          onSaved={() => queryClient.invalidateQueries({ queryKey })}
        />
      ))}
    </div>
  );
}

function ProviderEditor({
  workspaceId,
  config,
  onSaved
}: {
  workspaceId: number;
  config: SubscriptionProviderConfigRead;
  onSaved: () => void;
}) {
  const label = PROVIDER_LABELS[config.provider] ?? config.provider;
  const isBoosty = config.provider === "boosty";

  const [enabled, setEnabled] = useState(config.enabled);
  const [guildId, setGuildId] = useState(config.guild_id ?? "");
  const [broadcasterId, setBroadcasterId] = useState(config.broadcaster_id ?? "");
  const [broadcasterLogin, setBroadcasterLogin] = useState(config.broadcaster_login ?? "");
  const [roleTiers, setRoleTiers] = useState<SubscriptionRoleTier[]>(config.role_tiers);
  // Codes are write-only: the server returns tier/expiry only, so `newCodes`
  // holds plaintext the admin just typed and `keepCodes` is how many are stored.
  const [newCodes, setNewCodes] = useState<SubscriptionCodeUpsert[]>([]);
  const [method, setMethod] = useState<VerificationMethod>(
    // Mirrors the server's widening rule. A missing or unrecognised value must not
    // render an editor with every mechanism switched off — reachable during a
    // deploy skew, which the type system cannot see.
    config.verification_method === "live" || config.verification_method === "code"
      ? config.verification_method
      : "any"
  );

  const acceptsLive = method === "live" || method === "any";
  const acceptsCode = method === "code" || method === "any";

  const methodOptions: readonly MethodOption[] = [
    {
      value: "live",
      label: LIVE_LABELS[config.provider] ?? "Provider signal",
      description: LIVE_DESCRIPTIONS[config.provider] ?? "Read from the provider directly."
    },
    ...CODE_AND_EITHER
  ];

  const save = useMutation({
    mutationFn: () =>
      balancerAdminService.upsertSubscriptionProvider(workspaceId, {
        provider: config.provider,
        enabled,
        verification_method: method,
        // The fields belonging to a mechanism this method rejects are left out
        // rather than blanked: the admin may well switch back, and silently
        // destroying a guild id or role mapping on a radio click would be theft.
        ...(acceptsLive && isBoosty ? { guild_id: guildId.trim(), role_tiers: roleTiers } : {}),
        ...(acceptsLive && !isBoosty
          ? { broadcaster_id: broadcasterId.trim(), broadcaster_login: broadcasterLogin.trim() }
          : {}),
        // Omitted entirely unless the admin typed new ones — sending `[]` would
        // wipe the codes they cannot see.
        ...(acceptsCode && newCodes.length > 0 ? { codes: newCodes } : {})
      }),
    onSuccess: () => {
      notify.success(`${label} configuration saved`);
      onSaved();
    },
    onError: (error: unknown) =>
      notify.error(error instanceof Error ? error.message : `Failed to save ${label}`)
  });

  const duplicateRole =
    new Set(roleTiers.map((tier) => tier.role_id.trim()).filter(Boolean)).size !==
    roleTiers.filter((tier) => tier.role_id.trim()).length;

  const rolesMissing =
    acceptsLive && isBoosty && enabled && guildId.trim() && roleTiers.length === 0;

  // Code-only with nothing to redeem is unsatisfiable, so the server fails it open
  // and the gate enforces nothing — the exact trap this picker exists to expose.
  const codesMissing =
    method === "code" && enabled && config.codes.length === 0 && newCodes.length === 0;

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={`enabled-${config.provider}`}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Checkbox
            id={`enabled-${config.provider}`}
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(checked === true)}
          />
          {label}
        </label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={save.isPending || duplicateRole}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Save className="mr-1.5 size-3.5" />
          )}
          Save
        </Button>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-muted-foreground">
          How a subscription is proven
        </legend>
        {methodOptions.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="radio"
              className="mt-0.5"
              name={`method-${config.provider}`}
              value={option.value}
              checked={method === option.value}
              onChange={() => setMethod(option.value)}
            />
            <span>
              <span className="font-medium">{option.label}</span>
              <span className="block text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {acceptsLive &&
        (isBoosty ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`guild-${config.provider}`}>Discord guild id</Label>
              <Input
                id={`guild-${config.provider}`}
                value={guildId}
                onChange={(event) => setGuildId(event.target.value)}
                placeholder="1234567890123456789"
                inputMode="numeric"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                The server where Boosty&apos;s bot assigns subscriber roles. Our bot must also be a
                member of it.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Role → tier</Label>
              {roleTiers.map((tier, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={tier.role_id}
                    onChange={(event) =>
                      setRoleTiers((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, role_id: event.target.value } : row
                        )
                      )
                    }
                    placeholder="role id"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                  <Input
                    type="number"
                    min={1}
                    value={tier.tier_rank}
                    onChange={(event) =>
                      setRoleTiers((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, tier_rank: Number(event.target.value) || 1 } : row
                        )
                      )
                    }
                    className="w-20"
                    aria-label="tier rank"
                  />
                  <Input
                    value={tier.tier_label ?? ""}
                    onChange={(event) =>
                      setRoleTiers((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, tier_label: event.target.value } : row
                        )
                      )
                    }
                    placeholder="Уровень 2"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove role ${tier.role_id || index + 1}`}
                    onClick={() => setRoleTiers((rows) => rows.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setRoleTiers((rows) => [
                    ...rows,
                    { role_id: "", tier_rank: rows.length + 1, tier_label: "" }
                  ])
                }
              >
                <Plus className="mr-1.5 size-3.5" />
                Add role
              </Button>
            </div>
          </>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`bid-${config.provider}`}>Broadcaster id</Label>
              <Input
                id={`bid-${config.provider}`}
                value={broadcasterId}
                onChange={(event) => setBroadcasterId(event.target.value)}
                placeholder="12345"
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`blogin-${config.provider}`}>Broadcaster login</Label>
              <Input
                id={`blogin-${config.provider}`}
                value={broadcasterLogin}
                onChange={(event) => setBroadcasterLogin(event.target.value)}
                placeholder="channel_name"
                autoComplete="off"
              />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Only works for Affiliate/Partner channels — Twitch has no subscriptions API for anyone
              else, and a non-eligible channel resolves to <em>undetermined</em>, which fails open.
            </p>
          </div>
        ))}

      {acceptsCode && (
        <>
          <div className="space-y-2">
            <Label>Challenge codes</Label>
            <p className="text-xs text-muted-foreground">
              Publish a secret in a subscriber-only post; the player pastes it back. Rotate them per
              tournament — a code is shareable, so it proves access to a level, not identity.
              {config.codes.length > 0 && (
                <>
                  {" "}
                  Currently stored:{" "}
                  {config.codes
                    .map((code) => code.tier_label || `tier ${code.tier_rank}`)
                    .join(", ")}
                  . Codes are stored hashed and cannot be shown again.
                </>
              )}
            </p>
            {newCodes.map((code, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={code.code ?? ""}
                  onChange={(event) =>
                    setNewCodes((rows) =>
                      rows.map((row, i) =>
                        i === index ? { ...row, code: event.target.value } : row
                      )
                    )
                  }
                  placeholder="code from the post"
                  autoComplete="off"
                />
                <Input
                  type="number"
                  min={1}
                  value={code.tier_rank}
                  onChange={(event) =>
                    setNewCodes((rows) =>
                      rows.map((row, i) =>
                        i === index ? { ...row, tier_rank: Number(event.target.value) || 1 } : row
                      )
                    )
                  }
                  className="w-20"
                  aria-label="tier rank"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove code ${index + 1}`}
                  onClick={() => setNewCodes((rows) => rows.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNewCodes((rows) => [...rows, { code: "", tier_rank: 1 }])}
            >
              <Plus className="mr-1.5 size-3.5" />
              Add code
            </Button>
            {newCodes.length > 0 && (
              <p className="text-xs text-warning">
                Saving replaces every stored code with the {newCodes.length} above.
              </p>
            )}
          </div>
        </>
      )}

      {duplicateRole && (
        <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-2.5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
          <p className="text-xs text-danger">
            Two tiers on the same role id. The server rejects this — the resulting verdict would
            depend on ordering.
          </p>
        </div>
      )}

      {rolesMissing && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2.5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          <p className="text-xs text-warning">
            A guild without a role mapping resolves to <em>undetermined</em>, which fails open — the
            gate will not enforce anything.
          </p>
        </div>
      )}

      {codesMissing && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2.5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          <p className="text-xs text-warning">
            Code-only with no code configured is unsatisfiable, so it resolves to{" "}
            <em>undetermined</em> and fails open — nobody is checked, and nobody is blocked.
          </p>
        </div>
      )}
    </div>
  );
}
