"use client";

// Moved here from /admin/rank's Settings tab: the subscription collector's config
// belongs beside its own health and history, not under the rank collector.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import adminService from "@/services/admin.service";
import type { SubscriptionCollectionConfig } from "@/types/admin.types";

const SUBSCRIPTION_COLLECTION_KEY = "parser.subscription_collection";

const DEFAULTS: SubscriptionCollectionConfig = {
  enabled: true,
  interval_seconds: 1800,
  batch_size: 50
};

export function SubscriptionSettingsPanel() {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => adminService.getSettings()
  });

  const setting = settingsQuery.data?.find((s) => s.key === SUBSCRIPTION_COLLECTION_KEY);

  const initial = useMemo<SubscriptionCollectionConfig>(
    () => ({ ...DEFAULTS, ...((setting?.value as Partial<SubscriptionCollectionConfig>) ?? {}) }),
    [setting]
  );
  const [form, setForm] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);

  // Re-sync the form when a refetch delivers a different saved config, without an
  // effect: the render that sees a new `initial` also resets the draft.
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setForm(initial);
  }

  const mutation = useMutation({
    mutationFn: () =>
      adminService.updateSetting(SUBSCRIPTION_COLLECTION_KEY, {
        value: form as unknown as Record<string, unknown>
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "subscriptions", "stats"] });
    }
  });

  if (settingsQuery.isLoading) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  if (settingsQuery.isError) {
    return (
      <p className="text-danger">
        Couldn&apos;t load settings. Check your connection and reload the page.
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2>Subscription collection</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch
            id="sub-enabled"
            checked={form.enabled}
            onCheckedChange={(enabled) => setForm({ ...form, enabled })}
          />
          <Label htmlFor="sub-enabled">Enable background subscription auto-check</Label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="sub-interval">Check interval (seconds)</Label>
            <NumberInput
              id="sub-interval"
              integer
              min={60}
              max={86400}
              value={form.interval_seconds}
              onValueChange={(next) => setForm({ ...form, interval_seconds: next ?? 1800 })}
            />
            <p className="text-xs text-muted-foreground">
              How long the collector waits after its last scheduled sweep before starting the next
              one. Registration, check-in and manual checks are unaffected.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sub-batch">Batch size</Label>
            <NumberInput
              id="sub-batch"
              integer
              min={1}
              max={500}
              value={form.batch_size}
              onValueChange={(next) => setForm({ ...form, batch_size: next ?? 50 })}
            />
            <p className="text-xs text-muted-foreground">
              Participants resolved (and committed) per provider round trip. Lower it if a provider
              starts rate-limiting.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
          {mutation.isSuccess && <span className="text-sm text-success">Saved</span>}
          {mutation.isError && (
            <span className="text-sm text-danger">Save failed — check the values and try again.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
