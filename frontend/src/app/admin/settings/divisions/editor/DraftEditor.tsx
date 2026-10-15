"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Star, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { LinkTabs, type LinkTabItem } from "@/components/kit/LinkTabs";
import { ConfirmDialog, type ConfirmIntent } from "@/components/kit/ConfirmDialog";
import { EntityHubHeader } from "@/components/kit/EntityHubHeader";
import { SaveBar } from "@/components/kit/SaveBar";
import { Button } from "@/components/ui/button";
import { useQueryParams } from "@/hooks/useQueryParams";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import workspaceService from "@/services/workspace.service";
import type {
  DivisionGridActivationReadiness,
  DivisionGridVersion
} from "@/types/workspace.types";

import { VERSION_STATE_TONE, versionState } from "../versionStatus";
import { autoMap, mappingRules, unresolvedRows, type MappingChoice, type MappingChoices } from "./autoMap";
import { ChangesView } from "./ChangesView";
import { DivisionsTable } from "./DivisionsTable";
import { ImpactColumn } from "./ImpactColumn";
import { LadderColumn } from "./LadderColumn";
import { MappingsView, type MappingSource } from "./MappingsView";
import { publishChecks, readyToPublish } from "./publishChecks";
import {
  bandsCoverLadder,
  bandsDifferingFromBase,
  bandsFromTiers,
  describeEdits,
  diffBands,
  draftReducer,
  initDraftState,
  scaleOf,
  tiersFromBands,
  type Band,
  type Scale
} from "./draftReducer";
import { divisionGridQueryKeys } from "@/lib/divisions/query-keys";

/** The right rail becomes a sub-tab below this width (F12 ·8). */
const RAIL_MEDIA_QUERY = "(min-width: 1280px)";

const TAB_KEYS = ["divisions", "changes", "mappings", "impact"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export interface DraftEditorProps {
  workspaceId: number;
  version: DivisionGridVersion;
  /** The parent version's bands; empty when this version has no parent. */
  base: Band[];
  baseLabel: string;
  readiness: DivisionGridActivationReadiness | null;
  activeVersionId: number | null;
  editable: boolean;
  canPublish: boolean;
  canDelete: boolean;
  /**
   * Mapping picks made before a save that could not store them — carried into
   * the next mount so an incomplete mapping does not lose its decisions.
   */
  initialChoices?: MappingChoices;
  /**
   * Re-mounts this editor from the cache. Both "saved" and "discard my edits"
   * are the same thing to a reducer holding a snapshot stack: throw it away and
   * read the version again. `carry` seeds the next mount's mapping picks.
   */
  onReload: (carry?: MappingChoices) => void;
}

/**
 * The draft division-grid editor (F12): ladder on the left, three views in the
 * middle, impact on the right, one save bar underneath.
 *
 * Everything structural goes through `draftReducer`, so this component owns no
 * band arithmetic — only which view is open, what has been chosen in Mappings,
 * and the four requests (save, publish, activate, delete).
 *
 * A published or active version opens here read-only: a version another
 * tournament may already have been played on is immutable by design, and the
 * way forward is a new draft cloned from it.
 */
export function DraftEditor({
  workspaceId,
  version,
  base,
  baseLabel,
  readiness,
  activeVersionId,
  editable,
  canPublish,
  canDelete,
  initialChoices,
  onReload
}: Readonly<DraftEditorProps>) {
  const t = useTranslations("adminSettings.divisions");
  const failureDescription = (error: unknown) =>
    t("failureDescription", {
      reason: error instanceof Error ? error.message : t("operationFailed")
    });
  const router = useRouter();
  const queryClient = useQueryClient();
  const { searchParams, setParams } = useQueryParams();
  const [state, dispatch] = useReducer(
    draftReducer,
    { tiers: version.tiers, base },
    (seed) => initDraftState(bandsFromTiers(seed.tiers), scaleOf(seed.tiers), seed.base)
  );
  const [manualChoice, setManualChoice] = useState<MappingChoices>(() => initialChoices ?? {});
  const [confirming, setConfirming] = useState<"publish" | "delete" | "scale" | null>(null);
  const [iconTarget, setIconTarget] = useState<number | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  // What the ladder draws for a version that stores no OW link is the backend's
  // rank-range fallback, not a decision anyone made — the column says so.
  const implicitLinks = !version.tiers.some(
    (tier) => tier.native_rank_min != null && tier.native_rank_max != null
  );

  const [isWide, setIsWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia(RAIL_MEDIA_QUERY);
    const sync = () => setIsWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const sources = readiness?.sources ?? [];
  const tiersDirty = state.history.length > 0;
  // A mapping pick is an edit too: without it counting, a draft whose tiers are
  // saved could never store the decisions its Mappings tab asks for.
  const pickedCount = Object.keys(manualChoice).length;
  const dirty = tiersDirty || pickedCount > 0;
  // Mapping rules key on target tier ids, so an unsaved band cannot be a target.
  const mappable = state.bands.every((band) => band.id !== undefined);

  const sourceQueries = useQueries({
    queries: sources.map((source) => ({
      queryKey: divisionGridQueryKeys.version(source.version_id),
      queryFn: () => workspaceService.getDivisionGridVersion(source.version_id)
    }))
  });
  const mappingQueries = useQueries({
    queries: sources.map((source) => ({
      queryKey: divisionGridQueryKeys.mapping(source.version_id, version.id),
      queryFn: () => workspaceService.getDivisionGridMapping(source.version_id, version.id),
      // A version pair with no mapping yet is the normal starting state, not a
      // failure to retry.
      retry: false
    }))
  });

  const mappingSources = useMemo<MappingSource[]>(
    () =>
      sources.flatMap((source, index) => {
        const tiers = sourceQueries[index]?.data?.tiers;
        return tiers ? [{ readiness: source, tiers }] : [];
      }),
    [sources, sourceQueries]
  );

  /**
   * The mapping already stored server-side — each source tier's targets and
   * primary — overlaid with this session's choices. Derived rather than copied
   * into state on load, so a refetch can never silently drop a decision the
   * user just made.
   */
  const chosen = useMemo(() => {
    const stored: Record<number, MappingChoice> = {};
    for (const query of mappingQueries) {
      for (const rule of query.data?.rules ?? []) {
        const entry = (stored[rule.source_tier_id] ??= {
          targets: [],
          primary: rule.target_tier_id
        });
        entry.targets.push(rule.target_tier_id);
        if (rule.is_primary) entry.primary = rule.target_tier_id;
      }
    }
    return { ...stored, ...manualChoice };
  }, [mappingQueries, manualChoice]);

  const unresolvedMappings = useMemo(
    () =>
      mappingSources.reduce(
        (total, source) =>
          total +
          unresolvedRows(autoMap(source.tiers, state.bands), chosen, state.bands).length,
        0
      ),
    [chosen, mappingSources, state.bands]
  );

  const checks = publishChecks({
    bands: state.bands,
    scale: state.scale,
    readiness,
    unresolvedMappings,
    mappable,
    dirty
  });
  const publishable = readyToPublish(checks);
  const edits = useMemo(() => describeEdits(state), [state]);
  const changeCount = useMemo(() => {
    const diff = diffBands(state.base, state.bands);
    return diff.added.length + diff.removed.length + diff.moved.length + diff.renamed.length;
  }, [state.base, state.bands]);

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: divisionGridQueryKeys.readinessAll() }),
      queryClient.invalidateQueries({ queryKey: divisionGridQueryKeys.versionsAll() }),
      queryClient.invalidateQueries({ queryKey: divisionGridQueryKeys.gridsAll() }),
      queryClient.invalidateQueries({ queryKey: divisionGridQueryKeys.mappingAll() })
    ]);
  }, [queryClient]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updated = tiersDirty
        ? await workspaceService.updateDivisionGridVersion(version.id, {
            tiers: tiersFromBands(state.bands)
          })
        : version;
      // Mappings are written against the SAVED tiers: the rules point at tier
      // ids, and a band created in this session only gets one here.
      const savedBands = tiersDirty ? bandsFromTiers(updated.tiers) : state.bands;
      // The backend stores a mapping only when it covers every source tier, so
      // a source with an open row keeps its server state and its picks carry over.
      const pending: MappingSource[] = [];
      for (const source of mappingSources) {
        const rows = autoMap(source.tiers, savedBands);
        if (unresolvedRows(rows, chosen, savedBands).length > 0) {
          pending.push(source);
          continue;
        }
        const rules = mappingRules(rows, chosen, savedBands);
        if (rules.length === 0) continue;
        await workspaceService.putDivisionGridMapping(source.readiness.version_id, version.id, {
          name: `${source.readiness.version_label} \u2192 ${updated.label}`,
          rules
        });
      }
      return { updated, pending };
    },
    onSuccess: async ({ updated, pending }) => {
      // Seed the cache before remounting, so the fresh editor reads the tiers
      // that were just saved rather than the ones it sent.
      queryClient.setQueryData(divisionGridQueryKeys.version(version.id), updated);
      await invalidate();
      if (pending.length === 0) {
        notify.success(t("toast.draftSaved", { version: updated.version }));
      } else {
        notify.warning(t("toast.draftSavedMappingsOpen", { version: updated.version }), {
          description: t("toast.mappingPending", {
            sources: pending.map((source) => source.readiness.version_label).join(", ")
          })
        });
      }
      const pendingTierIds = new Set(
        pending.flatMap((source) => source.tiers.map((tier) => tier.id))
      );
      const carry: MappingChoices = {};
      for (const [sourceTierId, choice] of Object.entries(manualChoice)) {
        if (choice !== undefined && pendingTierIds.has(Number(sourceTierId))) {
          carry[Number(sourceTierId)] = choice;
        }
      }
      onReload(carry);
    },
    onError: reportFailure(t("errors.draftSave"), failureDescription)
  });

  const publishMutation = useMutation({
    mutationFn: () => workspaceService.publishDivisionGridVersion(version.id),
    onSuccess: async (published) => {
      queryClient.setQueryData(divisionGridQueryKeys.version(version.id), published);
      await invalidate();
      notify.success(t("toast.published", { version: published.version }));
      onReload();
    },
    onError: reportFailure(t("errors.publish"), failureDescription)
  });

  const activateMutation = useMutation({
    mutationFn: () => workspaceService.activateDivisionGridVersion(workspaceId, version.id),
    onSuccess: async () => {
      await invalidate();
      notify.success(t("toast.activated", { version: version.version }));
      onReload();
    },
    onError: reportFailure(t("errors.activate"), failureDescription)
  });

  const deleteMutation = useMutation({
    mutationFn: () => workspaceService.deleteDivisionGridVersion(version.id),
    onSuccess: async () => {
      await invalidate();
      notify.success(t("toast.draftDiscarded"));
      router.push("/admin/settings/divisions");
    },
    onError: reportFailure(t("errors.discard"), failureDescription)
  });

  const iconMutation = useMutation({
    mutationFn: async ({ bandIndex, file }: { bandIndex: number; file: File }) => {
      const band = state.bands[bandIndex];
      const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      const upload = await workspaceService.uploadDivisionIcon(
        `${band.slug}-${suffix}`,
        file,
        workspaceId
      );
      return { bandIndex, url: upload.public_url };
    },
    onSuccess: ({ bandIndex, url }) => dispatch({ type: "setIcon", bandIndex, iconUrl: url }),
    onError: reportFailure(t("errors.crestUpload"), failureDescription)
  });

  const onPickIcon = useCallback((bandIndex: number) => {
    setIconTarget(bandIndex);
    iconInputRef.current?.click();
  }, []);

  const selectedSlug = searchParams?.get("band") ?? null;
  const requestedTab = (searchParams?.get("tab") ?? "divisions") as TabKey;
  const tab: TabKey = TAB_KEYS.includes(requestedTab) ? requestedTab : "divisions";
  // On `xl` the impact rail is always on screen, so its tab has nowhere to go.
  const activeTab: TabKey = isWide && tab === "impact" ? "divisions" : tab;

  /**
   * Absolute, and carrying the rest of the query: `?band=` has to survive a
   * view switch, and a query-only href would resolve against whatever path the
   * router last rendered.
   */
  const tabHref = (next: TabKey) => {
    const query = new URLSearchParams(searchParams?.toString() ?? "");
    query.set("tab", next);
    return `/admin/settings/divisions/v/${version.id}?${query.toString()}`;
  };

  const tabs: LinkTabItem[] = [
    { key: "divisions", label: t("tabs.divisions"), href: tabHref("divisions") },
    {
      key: "changes",
      label: t("tabs.changes"),
      href: tabHref("changes"),
      badge: changeCount || undefined
    },
    {
      key: "mappings",
      label: t("tabs.mappings"),
      href: tabHref("mappings"),
      badge: unresolvedMappings || undefined
    },
    {
      key: "impact",
      label: t("tabs.impact"),
      href: tabHref("impact"),
      hidden: isWide
    }
  ];

  const lifecycle = versionState(version, activeVersionId);
  const intent: ConfirmIntent =
    confirming === "delete"
      ? {
          title: t("editorDetails.discardTitle", { version: version.version }),
          description: t("editorDetails.discardDescription"),
          confirmLabel: t("editor.discardDraft"),
          tone: "danger"
        }
      : confirming === "scale"
        ? {
            title: t("editor.followLadderTitle"),
            description: t("editorDetails.followDescription"),
            confirmLabel: t("editor.followLadder"),
            tone: "warning"
          }
        : {
            title: t("editorDetails.publishTitle", { version: version.version }),
            description: t("editorDetails.publishDescription"),
            confirmLabel: t("editor.publishVersion", { version: version.version }),
            tone: "warning"
          };

  const changeScale = (next: Scale) => {
    // Leaving the ladder keeps every number; following it rewrites them.
    if (next === "ladder") setConfirming("scale");
    else dispatch({ type: "setScale", scale: next });
  };

  return (
    <div className="flex flex-col gap-4">
      <EntityHubHeader
        backHref="/admin/settings/divisions"
        title={version.label}
        status={{
          label: `v${version.version} · ${lifecycle}`,
          tone: VERSION_STATE_TONE[lifecycle]
        }}
        meta={[
          base.length > 0 ? t("editorDetails.createdFrom", { base: baseLabel }) : t("editorDetails.noParent"),
          t("divisionCount", { count: state.bands.length }),
          state.scale === "ladder" ? t("editorDetails.followRanges") : t("editorDetails.customScale")
        ]}
        actions={
          <>
            {editable ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!tiersDirty}
                onClick={() => dispatch({ type: "undo" })}
              >
                <RotateCcw aria-hidden className="size-4" />
                {t("editor.undo")}
              </Button>
            ) : null}
            {editable && canDelete ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirming("delete")}>
                <Trash2 aria-hidden className="size-4" />
                {t("editor.discardDraft")}
              </Button>
            ) : null}
            {canPublish && version.status === "draft" ? (
              <Button
                size="sm"
                disabled={!publishable || publishMutation.isPending}
                title={
                  publishable
                    ? undefined
                    : t("editorDetails.publishBlocked")
                }
                onClick={() => setConfirming("publish")}
              >
                {t("editor.publishVersion", { version: version.version })}
              </Button>
            ) : null}
            {canPublish && version.status !== "draft" && version.id !== activeVersionId ? (
              <Button
                size="sm"
                disabled={readiness?.is_ready !== true || activateMutation.isPending}
                title={
                  readiness?.is_ready === true
                    ? undefined
                    : t("editorDetails.mappingBlocked")
                }
                onClick={() => activateMutation.mutate()}
              >
                <Star aria-hidden className="size-4" />
                {t("activateVersion", { version: version.version })}
              </Button>
            ) : null}
          </>
        }
      />

      {!editable ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
          <p className="text-sm text-muted-foreground">
            {version.status === "draft"
              ? t("editorDetails.readOnlyDraft")
              : t("editorDetails.readOnlyPublished")}
          </p>
          {version.status !== "draft" && canPublish ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void workspaceService
                  .cloneDivisionGridVersion(version.id)
                  .then(async (draft) => {
                    await invalidate();
                    router.push(`/admin/settings/divisions/v/${draft.id}`);
                  })
                  .catch(reportFailure(t("errors.draftCreate"), failureDescription));
              }}
            >
              {t("editor.createDraft")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <input
        ref={iconInputRef}
        type="file"
        accept="image/png,image/webp,image/svg+xml"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && iconTarget !== null) iconMutation.mutate({ bandIndex: iconTarget, file });
          event.target.value = "";
        }}
      />

      <div
        className={cn(
          "grid items-start gap-4",
          "xl:grid-cols-[272px_minmax(0,1fr)_250px]"
        )}
      >
        <LadderColumn
          bands={state.bands}
          scale={state.scale}
          selectedSlug={selectedSlug}
          editable={editable}
          implicitLinks={implicitLinks && !tiersDirty}
          onSelect={(slug) => setParams({ band: slug })}
          dispatch={dispatch}
        />

        <div className="flex min-w-0 flex-col gap-3">
          <LinkTabs
            items={tabs}
            activeKey={activeTab}
            level={2}
            ariaLabel={t("editor.views")}
          />

          {activeTab === "divisions" ? (
            <DivisionsTable
              bands={state.bands}
              base={state.base}
              scale={state.scale}
              editable={editable}
              selectedSlug={selectedSlug}
              onSelect={(slug) => setParams({ band: slug })}
              dispatch={dispatch}
              onPickIcon={onPickIcon}
              onScaleChange={changeScale}
              canFollowLadder={bandsCoverLadder(state.bands)}
            />
          ) : null}

          {activeTab === "changes" ? (
            <ChangesView base={state.base} bands={state.bands} baseLabel={baseLabel} />
          ) : null}

          {activeTab === "mappings" ? (
            <MappingsView
              targetLabel={`v${version.version}`}
              bands={state.bands}
              sources={mappingSources}
              chosen={chosen}
              onChoose={(sourceTierId, choice) =>
                setManualChoice((current) => ({ ...current, [sourceTierId]: choice }))
              }
              editable={editable}
              mappable={mappable}
              loading={sourceQueries.some((query) => query.isLoading)}
            />
          ) : null}

          {activeTab === "impact" ? (
            <ImpactColumn checks={checks} sources={sources} edits={edits} />
          ) : null}
        </div>

        {isWide ? <ImpactColumn checks={checks} sources={sources} edits={edits} /> : null}
      </div>

      {editable ? (
        <SaveBar
          dirty={dirty}
          saving={saveMutation.isPending}
          primaryLabel={t("editor.saveDraft")}
          summary={
            <>
              {t.rich("editor.saveBarSummary", {
                version: version.version,
                status: t(`editor.status.${version.status as "draft" | "published" | "archived"}`),
                divisions: state.bands.length,
                edits: state.history.length,
                strong: (chunks) => <strong>{chunks}</strong>
              })}
              {pickedCount > 0 ? ` · ${t("editor.mappingSummary", { count: pickedCount })}` : null}{" "}
              · {t("editor.differenceSummary", { count: bandsDifferingFromBase(state.base, state.bands), base: baseLabel })}
            </>
          }
          onDiscard={() => onReload()}
          onSave={() => saveMutation.mutate()}
          // Divisions · Changes · Mappings · Impact are `?tab=` links of THIS
          // editor, and "resolve the open mapping decisions" is exactly what
          // the publish pre-flight sends a dirty draft off to do. Prompting
          // for a discard on the way there would make that unreachable.
          guardNavigation={false}
        />
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? undefined : setConfirming(null))}
        intent={intent}
        pending={publishMutation.isPending || deleteMutation.isPending}
        onConfirm={async () => {
          const action = confirming;
          setConfirming(null);
          if (action === "scale") dispatch({ type: "setScale", scale: "ladder" });
          if (action === "delete") await deleteMutation.mutateAsync();
          if (action === "publish") await publishMutation.mutateAsync();
        }}
      />
    </div>
  );
}

function reportFailure(title: string, description: (error: unknown) => string) {
  return (error: unknown) =>
    notify.error(title, { description: description(error) });
}
