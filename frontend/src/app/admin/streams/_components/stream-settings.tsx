"use client";

// Same shape as the subscription collector's settings card: this is the second
// runtime-editable collector config, and it is edited the same way.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import adminService from "@/services/admin.service";
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
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => adminService.getSettings()
  });

  const setting = settingsQuery.data?.find((s) => s.key === STREAM_COLLECTION_KEY);

  const initial = useMemo<StreamCollectionConfig>(
    () => ({ ...DEFAULTS, ...((setting?.value as Partial<StreamCollectionConfig>) ?? {}) }),
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
      adminService.updateSetting(STREAM_COLLECTION_KEY, {
        value: form as unknown as Record<string, unknown>
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "streams"] });
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
          <h2>Stream collection</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
