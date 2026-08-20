"use client";

import { startTransition, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/lib/notify";
import { MUTED_BUTTON_CLASS } from "@/app/balancer/components/balancer-page-helpers";
import { useRequirementDescription } from "@/components/admin/subscriptions/useRequirementDescription";
import { ROLES, canonicalToRegistrationRole } from "@/lib/roles";
import adminService from "@/services/admin.service";
import balancerAdminService from "@/services/balancer-admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type {
  AdminCustomFieldDef,
  AdminRegistrationFormUpsert,
  BuiltInFieldConfig
} from "@/types/balancer-admin.types";

import { BuiltInFieldsCard } from "./_components/BuiltInFieldsCard";
import { CustomFieldsCard } from "./_components/CustomFieldsCard";
import { RegistrationStatusCard } from "./_components/RegistrationStatusCard";
import { type CatalogEntry, SubrolesTab } from "./_components/SubrolesTab";
import {
  ROLE_FIELD_KEYS,
  getBuiltInConfig,
  getCustomFieldDefaultValidation,
  hydrateCustomField,
  makeUniqueCustomFieldKey,
  normalizeValidation,
  supportsCustomFieldValidation
} from "./_components/formConfig";

// D25: rendered by both the hub sub-route (tournament from the path) and the
// legacy balancer route (tournament from the ?tournament query) until T14.
export default function RegistrationFormBuilder({
  tournamentId,
  basePath
}: Readonly<{
  tournamentId: number | null;
  basePath: string;
}>) {
  const t = useTranslations("registrationFormAdmin.page");
  const scopeSelectId = useId();
  const stageSelectId = useId();

  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);

  const [isOpen, setIsOpen] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [requireOpenProfile, setRequireOpenProfile] = useState(false);
  const [openProfileScope, setOpenProfileScope] = useState<"main" | "all">("main");
  const [showRanks, setShowRanks] = useState(false);
  const [requireSubscription, setRequireSubscription] = useState(false);
  const [subscriptionStage, setSubscriptionStage] = useState<"registration" | "check_in">(
    "check_in"
  );
  const [builtInFields, setBuiltInFields] = useState<Record<string, BuiltInFieldConfig>>(() =>
    getBuiltInConfig({})
  );
  const [customFields, setCustomFields] = useState<AdminCustomFieldDef[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const formQuery = useQuery({
    queryKey: ["balancer-admin", "registration-form", tournamentId],
    queryFn: () => balancerAdminService.getRegistrationForm(tournamentId as number),
    enabled: tournamentId !== null,
    // This page is a long-lived editor; a background refetch must not clobber
    // the admin's unsaved edits.
    refetchOnWindowFocus: false
  });

  // Read-only: the rule lives on the workspace now, and the server resolves it
  // onto the read model so this page can show what the toggle above enforces
  // without offering to edit it here.
  const resolvedRequirement = useRequirementDescription(
    formQuery.data?.subscription_requirement_json
  );

  const loadedFormKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const data = formQuery.data;
    if (!data) {
      return;
    }
    const formKey = String(data.id);
    // Always hydrate on initial load / when switching to a different form.
    // For background refetches of the same form, never clobber unsaved edits.
    if (loadedFormKeyRef.current === formKey && hasChanges) {
      return;
    }
    loadedFormKeyRef.current = formKey;
    startTransition(() => {
      setIsOpen(data.is_open);
      setAutoApprove(data.auto_approve ?? false);
      setRequireOpenProfile(data.require_open_profile ?? false);
      setRequireSubscription(data.require_subscription ?? false);
      // Default to the looser stage on a form saved before the field existed, so
      // loading an old form never silently arms a sign-up wall.
      setSubscriptionStage(
        data.subscription_stage === "registration" ? "registration" : "check_in"
      );
      setOpenProfileScope((data.open_profile_scope as "main" | "all") ?? "main");
      setShowRanks(data.show_ranks ?? false);
      setBuiltInFields(getBuiltInConfig(data.built_in_fields ?? {}));
      setCustomFields((data.custom_fields ?? []).map(hydrateCustomField));
      setHasChanges(false);
    });
  }, [formQuery.data, hasChanges]);

  // The workspace `PlayerSubRole` catalog is fetched with row ids so the tab can
  // key its chips; managing it lives on `/admin/sub-roles`. The form's embedded
  // `subrole_catalog` only carries {slug,label} for the public wizard.
  const workspaceId = formQuery.data?.workspace_id ?? currentWorkspaceId ?? null;

  const catalogQuery = useQuery({
    queryKey: ["admin", "player-sub-roles", workspaceId],
    queryFn: () => adminService.getPlayerSubRoles({ workspace_id: workspaceId as number }),
    enabled: workspaceId !== null
  });

  const subroleCatalog = useMemo<Record<string, CatalogEntry[]>>(() => {
    const grouped: Record<string, CatalogEntry[]> = Object.fromEntries(
      ROLES.map((role) => [role.code, [] as CatalogEntry[]])
    );
    for (const row of catalogQuery.data ?? []) {
      const code = canonicalToRegistrationRole(row.role);
      if (code && grouped[code]) {
        grouped[code].push({ id: row.id, slug: row.slug, label: row.label });
      }
    }
    return grouped;
  }, [catalogQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!tournamentId) throw new Error(t("noTournamentError"));
      const payload: AdminRegistrationFormUpsert = {
        is_open: isOpen,
        auto_approve: autoApprove,
        require_open_profile: requireOpenProfile,
        open_profile_scope: openProfileScope,
        show_ranks: showRanks,
        require_subscription: requireSubscription,
        subscription_stage: subscriptionStage,
        built_in_fields: Object.fromEntries(
          Object.entries(builtInFields).map(([key, value]) => [
            key,
            { ...value, validation: normalizeValidation(value.validation) }
          ])
        ),
        custom_fields: customFields.map((field) => ({
          ...field,
          validation: normalizeValidation(field.validation)
        }))
      };
      return balancerAdminService.upsertRegistrationForm(tournamentId, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["balancer-admin", "registration-form", tournamentId]
      });
      setHasChanges(false);
      notify.success(t("savedToast"));
    }
  });

  const updateBuiltIn = (key: string, updates: Partial<BuiltInFieldConfig>) => {
    setBuiltInFields((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...updates,
        ...(Object.prototype.hasOwnProperty.call(updates, "validation")
          ? { validation: normalizeValidation(updates.validation) }
          : {})
      }
    }));
    setHasChanges(true);
  };

  // A single sub-role selection drives both the primary and additional role pickers.
  const subroleSelection =
    builtInFields.primary_role?.subroles ?? builtInFields.additional_roles?.subroles ?? {};

  const handleToggleSubrole = (role: string, _slug: string, nextSlugs: string[]) => {
    setBuiltInFields((prev) => {
      const next = { ...prev };
      for (const fieldKey of ROLE_FIELD_KEYS) {
        const cfg = prev[fieldKey] ?? { enabled: true, required: false };
        next[fieldKey] = {
          ...cfg,
          subroles: { ...(cfg.subroles ?? {}), [role]: nextSlugs }
        };
      }
      return next;
    });
    setHasChanges(true);
  };

  const addCustomField = () => {
    setCustomFields((prev) => [
      ...prev,
      {
        key: "",
        label: "",
        type: "text",
        required: false,
        placeholder: null,
        options: null,
        validation: getCustomFieldDefaultValidation("text")
      }
    ]);
    setHasChanges(true);
  };

  const updateCustomField = (index: number, updates: Partial<AdminCustomFieldDef>) => {
    setCustomFields((prev) =>
      prev.map((field, i) => {
        if (i !== index) return field;
        const updated: AdminCustomFieldDef = { ...field, ...updates };

        if ("type" in updates && updates.type && !supportsCustomFieldValidation(updates.type)) {
          updated.validation = null;
        } else if ("type" in updates && updates.type) {
          updated.validation =
            normalizeValidation(updated.validation) ??
            getCustomFieldDefaultValidation(updates.type);
        }

        // Assign a stable, unique key once when the field is first named; never
        // regenerate it from the label afterwards (keeps custom_fields_json safe).
        if ("label" in updates && updates.label !== undefined && !field.key) {
          const otherKeys = prev.filter((_, j) => j !== index).map((other) => other.key);
          updated.key = makeUniqueCustomFieldKey(updates.label, otherKeys);
        }

        if ("validation" in updates) {
          updated.validation = normalizeValidation(updates.validation);
        }
        return updated;
      })
    );
    setHasChanges(true);
  };

  const removeCustomField = (index: number) => {
    setCustomFields((prev) => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  if (!tournamentId) {
    return (
      <Alert>
        <AlertTitle>{t("noTournament.title")}</AlertTitle>
        <AlertDescription>{t("noTournament.description")}</AlertDescription>
      </Alert>
    );
  }

  if (formQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("loadError.title")}</AlertTitle>
        <AlertDescription>
          {(formQuery.error as Error)?.message ?? t("loadError.fallback")}
        </AlertDescription>
      </Alert>
    );
  }

  // Avoid flashing default toggles while the saved form is still loading.
  if (formQuery.isLoading) {
    return (
      <output className="flex flex-1 items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        {t("loading")}
      </output>
    );
  }

  const registrationsHref = searchParams.toString()
    ? `${basePath}?${searchParams.toString()}`
    : basePath;

  const formExists = formQuery.data != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="max-w-prose text-sm text-muted-foreground">{t("description")}</p>
          </div>
          <Button variant="outline" asChild className={MUTED_BUTTON_CLASS}>
            <Link href={registrationsHref}>
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              {t("backToRegistrations")}
            </Link>
          </Button>
        </div>

        <Tabs defaultValue="status" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="self-start">
            <TabsTrigger value="status">{t("tabs.status")}</TabsTrigger>
            <TabsTrigger value="fields">{t("tabs.fields")}</TabsTrigger>
            <TabsTrigger value="subroles">{t("tabs.subroles")}</TabsTrigger>
            <TabsTrigger value="custom">{t("tabs.custom")}</TabsTrigger>
          </TabsList>

          <TabsContent value="status">
            <div className="space-y-4">
              <RegistrationStatusCard
                isOpen={isOpen}
                autoApprove={autoApprove}
                onChangeOpen={(value) => {
                  setIsOpen(value);
                  setHasChanges(true);
                }}
                onChangeAutoApprove={(value) => {
                  setAutoApprove(value);
                  setHasChanges(true);
                }}
              />

              {/* Every section on this tab is a Card with the rule stated in its
                  description, so the explanation precedes the control it governs
                  instead of trailing it. */}
              <Card>
                <CardHeader>
                  <CardTitle asChild><h2>{t("admission.title")}</h2></CardTitle>
                  <CardDescription className="max-w-prose">{t("admission.hint")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={requireOpenProfile}
                      onCheckedChange={(checked) => {
                        setRequireOpenProfile(checked === true);
                        setHasChanges(true);
                      }}
                    />
                    {t("admission.requireOpenProfile")}
                  </label>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Label htmlFor={scopeSelectId} className="text-muted-foreground">
                      {t("admission.scope")}
                    </Label>
                    <Select
                      value={openProfileScope}
                      disabled={!requireOpenProfile}
                      onValueChange={(value) => {
                        setOpenProfileScope(value as "main" | "all");
                        setHasChanges(true);
                      }}
                    >
                      <SelectTrigger
                        id={scopeSelectId}
                        // Sized from content, not a pixel width: the Russian option
                        // labels are longer and a fixed 230px clipped them.
                        className="h-8 w-fit min-w-[230px] max-w-full text-sm"
                        aria-label={t("admission.scopeAria")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="main">{t("admission.scopeMain")}</SelectItem>
                        <SelectItem value="all">{t("admission.scopeAll")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle asChild><h2>{t("subscription.title")}</h2></CardTitle>
                  <CardDescription className="max-w-prose">
                    {t("subscription.hint")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={requireSubscription}
                      onCheckedChange={(checked) => {
                        setRequireSubscription(checked === true);
                        setHasChanges(true);
                      }}
                    />
                    {t("subscription.require")}
                  </label>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Label htmlFor={stageSelectId} className="text-muted-foreground">
                      {t("subscription.stage")}
                    </Label>
                    <Select
                      value={subscriptionStage}
                      disabled={!requireSubscription}
                      onValueChange={(value) => {
                        setSubscriptionStage(value as "registration" | "check_in");
                        setHasChanges(true);
                      }}
                    >
                      <SelectTrigger
                        id={stageSelectId}
                        className="h-8 w-fit min-w-[230px] max-w-full text-sm"
                        aria-label={t("subscription.stageAria")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="check_in">{t("subscription.stageCheckIn")}</SelectItem>
                        <SelectItem value="registration">
                          {t("subscription.stageRegistration")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 text-sm">
                    {/* The workspace rule reaches this card as a projection ON the
                        form, so `resolvedRequirement === ""` means two different
                        things: the workspace has no rule, or there is no form to read
                        one from (`reg_form_get` returns null until the first save --
                        rows are created lazily). Only the first licenses the "enforces
                        nothing" claim; asserting it for a brand-new tournament states a
                        truth nobody has looked up, right beside the toggle it describes.
                        `!formExists` also covers `formQuery.isPending`, which implies
                        `data === undefined`. */}
                    <p className="max-w-prose text-muted-foreground">
                      {!formExists
                        ? t("subscription.resolvedUnknown")
                        : resolvedRequirement
                          ? t("subscription.resolved", { rule: resolvedRequirement })
                          : t("subscription.resolvedEmpty")}
                    </p>
                    {/* `?tab=providers`: /admin/subscriptions opens on the collector
                        dashboard otherwise, which is not where the rule is edited. */}
                    <Link
                      href="/admin/subscriptions?tab=providers"
                      className="text-xs font-medium underline underline-offset-4"
                    >
                      {t("subscription.manage")}
                    </Link>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle asChild><h2>{t("display.title")}</h2></CardTitle>
                  <CardDescription className="max-w-prose">{t("display.hint")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={showRanks}
                      onCheckedChange={(checked) => {
                        setShowRanks(checked === true);
                        setHasChanges(true);
                      }}
                    />
                    {t("display.showRanks")}
                  </label>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="fields">
            <BuiltInFieldsCard builtInFields={builtInFields} onUpdate={updateBuiltIn} />
          </TabsContent>

          <TabsContent value="subroles">
            <SubrolesTab
              catalog={subroleCatalog}
              selection={subroleSelection}
              onToggleOffered={handleToggleSubrole}
              isLoading={catalogQuery.isLoading}
            />
          </TabsContent>

          <TabsContent value="custom">
            <CustomFieldsCard
              customFields={customFields}
              onAdd={addCustomField}
              onUpdate={updateCustomField}
              onRemove={removeCustomField}
            />
          </TabsContent>
        </Tabs>
      </div>

      <div className="flex items-center justify-end gap-3 border-t py-3">
        {/* Stable region, not a conditionally mounted node: a polite live region
            only announces reliably when it is already in the tree. */}
        <output className="text-xs text-muted-foreground">
          {hasChanges ? t("unsavedChanges") : ""}
        </output>
        <Button
          size="lg"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || (!hasChanges && formExists)}
        >
          {saveMutation.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Save className="mr-2 size-4" aria-hidden />
          )}
          {formExists ? t("saveChanges") : t("createForm")}
        </Button>
      </div>
    </div>
  );
}
