"use client";

// Moved here from /admin/rank's Settings tab: the subscription collector's config
// belongs beside its own health and history, not under the rank collector.

import { CollectionSettingsPanel, useCollectionSettings } from "@/components/admin/CollectionSettingsPanel";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import type { SubscriptionCollectionConfig } from "@/types/admin.types";

const SUBSCRIPTION_COLLECTION_KEY = "parser.subscription_collection";

const DEFAULTS: SubscriptionCollectionConfig = {
  enabled: true,
  interval_seconds: 1800,
  batch_size: 50
};

export function SubscriptionSettingsPanel() {
  const { form, setForm, settingsQuery, mutation } = useCollectionSettings<SubscriptionCollectionConfig>({
    settingKey: SUBSCRIPTION_COLLECTION_KEY,
    defaults: DEFAULTS,
    invalidateKeys: [["admin", "subscriptions", "stats"]]
  });

  return (
    <CollectionSettingsPanel
      title="Subscription collection"
      isLoading={settingsQuery.isLoading}
      loadError={settingsQuery.isError}
      isSaving={mutation.isPending}
      saveSuccess={mutation.isSuccess}
      saveError={mutation.isError}
      onSave={() => mutation.mutate()}
    >
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
    </CollectionSettingsPanel>
  );
}
