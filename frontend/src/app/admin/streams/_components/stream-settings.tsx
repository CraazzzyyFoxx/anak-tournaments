"use client";

// Same shape as the subscription collector's settings card: this is the second
// runtime-editable collector config, and it is edited the same way.

import { CollectionSettingsPanel, useCollectionSettings } from "@/components/admin/CollectionSettingsPanel";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import type { StreamCollectionConfig } from "@/types/admin.types";

const STREAM_COLLECTION_KEY = "stream.collection";

// Mirrors the backend's shipped defaults (`stream.env.example`): polling is OFF
// on a fresh deploy, so filling in the Twitch credentials does not by itself
// start touching Twitch.
const DEFAULTS: StreamCollectionConfig = {
  enabled: false,
  interval_seconds: 60,
  batch_size: 100
};

export function StreamSettingsPanel() {
  const { form, setForm, settingsQuery, mutation } = useCollectionSettings<StreamCollectionConfig>({
    settingKey: STREAM_COLLECTION_KEY,
    defaults: DEFAULTS,
    invalidateKeys: [["admin", "streams"]]
  });

  return (
    <CollectionSettingsPanel
      title="Stream collection"
      isLoading={settingsQuery.isLoading}
      loadError={settingsQuery.isError}
      isSaving={mutation.isPending}
      saveSuccess={mutation.isSuccess}
      saveError={mutation.isError}
      onSave={() => mutation.mutate()}
    >
      <div className="flex items-center gap-2">
        <Switch
          id="stream-enabled"
          checked={form.enabled}
          onCheckedChange={(enabled) => setForm({ ...form, enabled })}
        />
        <Label htmlFor="stream-enabled">Enable background Twitch live-status polling</Label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          {/* min/max are the backend's own bounds. Without them the server
              answers 422 with nothing this form can show the operator. */}
          <Label htmlFor="stream-interval">Poll interval (seconds)</Label>
          <NumberInput
            id="stream-interval"
            integer
            min={30}
            max={3600}
            value={form.interval_seconds}
            onValueChange={(next) => setForm({ ...form, interval_seconds: next ?? 60 })}
          />
          <p className="text-xs text-muted-foreground">
            How long the poller waits after its last tick before asking Twitch again. 30s to 1h.
            Raise it if the shared Helix rate-limit bucket runs low.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="stream-batch">Batch size</Label>
          <NumberInput
            id="stream-batch"
            integer
            min={1}
            max={100}
            value={form.batch_size}
            onValueChange={(next) => setForm({ ...form, batch_size: next ?? 100 })}
          />
          <p className="text-xs text-muted-foreground">
            Channels resolved per Helix call. 100 is Twitch&apos;s hard ceiling on{" "}
            <code>GET /streams</code>, not our own limit — a larger value cannot be honoured.
          </p>
        </div>
      </div>
    </CollectionSettingsPanel>
  );
}
