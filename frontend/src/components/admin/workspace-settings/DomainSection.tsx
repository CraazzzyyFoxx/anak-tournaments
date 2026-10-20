"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { PhaseStrip, type PhaseState } from "@/components/kit/PhaseStrip";
import { SaveBar } from "@/components/kit/SaveBar";
import { SettingGroup, SettingRow } from "@/components/kit/SettingRow";
import { PLATFORM_ZONE } from "@/lib/site/host";
import { notify } from "@/lib/notify";
import workspaceService from "@/services/workspace.service";
import type { Workspace } from "@/types/workspace.types";
import { WorkspaceSettingsFrame } from "./WorkspaceSettingsFrame";
import { useWorkspaceSettingsForm } from "./useWorkspaceSettingsForm";
import { adminQueryKeys } from "@/lib/admin/query-keys";

/** DNS propagation is minutes, not seconds; re-checking faster only burns
 * requests on a resolver that has not refreshed yet. */
const VERIFY_POLL_MS = 15000;

type DomainState = { domain: string | null; verifiedAt: string | null; token: string | null };

const domainStateOf = (ws: Workspace): DomainState => ({
  domain: ws.custom_domain,
  verifiedAt: ws.custom_domain_verified_at,
  token: ws.custom_domain_verification_token
});

/**
 * Subdomain, custom domain and the text search engines show.
 *
 * The custom domain is a three-step stepper rather than a field with a Save
 * button, because it is not a value the form owns: adding it mints a DNS token
 * server-side, and the domain only starts serving once a resolver can see that
 * token. A `SaveBar` cannot express "now go edit your DNS", so the `PhaseStrip`
 * says which of the three states the domain is in, and nothing else repeats it.
 */
export function DomainSection({ workspaceId }: Readonly<{ workspaceId: number | null }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.domain");
  const settings = useWorkspaceSettingsForm(workspaceId, "domain");
  const { patch, invalidate, workspace } = settings;

  const [draftDomain, setDraftDomain] = useState("");
  const [removeOpen, setRemoveOpen] = useState(false);
  const [domain, setDomain] = useState<DomainState>({
    domain: null,
    verifiedAt: null,
    token: null
  });

  // The domain lives outside the form diff, so it re-seeds from the workspace
  // on every read rather than being guarded against refetches: there is no
  // in-progress edit to lose except the input, which is separate.
  useEffect(() => {
    if (!workspace) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDomain(domainStateOf(workspace));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftDomain(workspace.custom_domain ?? "");
  }, [workspace]);

  const applyDomain = (updated: Workspace) => {
    setDomain(domainStateOf(updated));
    setDraftDomain(updated.custom_domain ?? "");
    invalidate();
  };

  const setDomainMutation = useMutation({
    mutationFn: (value: string) => workspaceService.setCustomDomain(workspaceId as number, value),
    onSuccess: (updated) => {
      applyDomain(updated);
      notify.success(t("saved"));
    },
    onError: (error) => notify.apiError(error, { title: t("saveError") })
  });

  const verifyMutation = useMutation({
    mutationFn: () => workspaceService.verifyCustomDomain(workspaceId as number),
    onSuccess: (updated) => {
      applyDomain(updated);
      if (updated.custom_domain_verified_at) {
        notify.success(t("verified"));
      } else {
        notify.warning(t("pendingWarning"));
      }
    },
    onError: (error) =>
      notify.apiError(error, {
        title: t("pendingWarning")
      })
  });

  const clearMutation = useMutation({
    mutationFn: () => workspaceService.clearCustomDomain(workspaceId as number),
    onSuccess: (updated) => {
      applyDomain(updated);
      setRemoveOpen(false);
      notify.success(t("removed"));
    },
    onError: (error) => notify.apiError(error, { title: t("removeError") })
  });

  // While a domain is pending we re-check DNS quietly on an interval (no toast
  // spam) and stop the moment it verifies; "Verify now" stays for an immediate
  // check.
  const pending = !!domain.domain && !domain.verifiedAt;
  const poll = useQuery({
    queryKey: adminQueryKeys.workspaceDomainVerify(workspaceId, domain.domain),
    queryFn: () => workspaceService.verifyCustomDomain(workspaceId as number),
    enabled: pending,
    refetchInterval: pending ? VERIFY_POLL_MS : false,
    refetchOnWindowFocus: false,
    retry: false,
    gcTime: 0
  });

  const polledVerifiedAt = poll.data?.custom_domain_verified_at;
  useEffect(() => {
    if (!polledVerifiedAt || !poll.data) return;
    // Reacting to a poll result is the "subscribe to an external system" case:
    // the toast and the cache invalidation must fire once per verification, so
    // this cannot move into render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applyDomain(poll.data);
    notify.success(t("verified"));
  }, [polledVerifiedAt]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify.success(t("copied"));
    } catch {
      notify.error(t("copyError"));
    }
  };

  const step = domain.verifiedAt ? 2 : domain.domain ? 1 : 0;
  const phaseState = (index: number): PhaseState =>
    index < step ? "done" : index === step ? "current" : "todo";

  return (
    <WorkspaceSettingsFrame workspaceId={workspaceId} settings={settings}>
      {({ form: values, workspace: ws }) => (
        <>
          <SettingGroup
            title={t("groups.address.title")}
            description={t("groups.address.description")}
          >
            <SettingRow
              htmlFor="workspace-subdomain"
              label={t("subdomain")}
              hint={
                values.subdomain
                  ? `https://${values.subdomain}.${PLATFORM_ZONE}`
                  : t("platformUrlOnly")
              }
            >
              <InputGroup>
                <InputGroupInput
                  id="workspace-subdomain"
                  value={values.subdomain ?? ""}
                  onChange={(event) =>
                    patch({
                      subdomain: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
                    })
                  }
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>.{PLATFORM_ZONE}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </SettingRow>
          </SettingGroup>

          <SettingGroup
            title={t("customDomain")}
            description={t("groups.customDomain.description")}
            immediate
          >
            <div className="pb-4">
              <PhaseStrip
                phases={[
                  { key: "add", label: t("addDomain"), state: phaseState(0) },
                  { key: "dns", label: t("addDns"), state: phaseState(1) },
                  { key: "verified", label: t("verifyLabel"), state: phaseState(2) }
                ]}
              />
            </div>

            <SettingRow htmlFor="workspace-custom-domain" label={t("domainLabel")} stacked>
              <div className="flex w-full flex-wrap gap-2">
                <Input
                  id="workspace-custom-domain"
                  className="min-w-[16rem] flex-1"
                  value={draftDomain}
                  placeholder={t("domainPlaceholder")}
                  disabled={!!domain.verifiedAt}
                  onChange={(event) => setDraftDomain(event.target.value.toLowerCase().trim())}
                />
                {domain.verifiedAt ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-danger"
                    disabled={clearMutation.isPending}
                    onClick={() => setRemoveOpen(true)}
                  >
                    {t("removeDomain")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={setDomainMutation.isPending}
                    onClick={() => {
                      if (!draftDomain) {
                        notify.error(t("enterDomain"));
                        return;
                      }
                      setDomainMutation.mutate(draftDomain);
                    }}
                  >
                    {setDomainMutation.isPending ? t("saving") : t("saveDomain")}
                  </Button>
                )}
                {pending ? (
                  <Button
                    type="button"
                    disabled={verifyMutation.isPending}
                    onClick={() => verifyMutation.mutate()}
                  >
                    {verifyMutation.isPending ? t("saving") : t("verifyNow")}
                  </Button>
                ) : null}
              </div>
            </SettingRow>

            {pending ? (
              <SettingRow
                label={t("dnsRecords")}
                hint={t("addRecords", { seconds: VERIFY_POLL_MS / 1000 })}
                stacked
              >
                <dl className="w-full divide-y divide-border/60 font-mono text-xs">
                  <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_1.25rem] items-center gap-x-3 py-2">
                    <dt className="text-muted-foreground">TXT</dt>
                    <dd className="break-all">{`_owt-verify.${domain.domain}`}</dd>
                    <dd className="break-all">{domain.token}</dd>
                    <dd>
                      {domain.token ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-5"
                          aria-label={t("copyTxt")}
                          title={t("copyTxt")}
                          onClick={() => domain.token && copy(domain.token)}
                        >
                          <Copy aria-hidden className="size-3" />
                        </Button>
                      ) : null}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_1.25rem] items-center gap-x-3 py-2">
                    <dt className="text-muted-foreground">CNAME</dt>
                    <dd className="break-all">{domain.domain}</dd>
                    <dd className="break-all">{PLATFORM_ZONE}</dd>
                  </div>
                </dl>
              </SettingRow>
            ) : null}
          </SettingGroup>

          <SettingGroup
            title={t("groups.search.title")}
            description={t("groups.search.description")}
          >
            <SettingRow htmlFor="workspace-seo-title" label={t("seoTitle")}>
              <Input
                id="workspace-seo-title"
                value={values.seo_title ?? ""}
                onChange={(event) => patch({ seo_title: event.target.value })}
              />
            </SettingRow>
            <SettingRow htmlFor="workspace-seo-description" label={t("seoDescription")} stacked>
              <Textarea
                id="workspace-seo-description"
                value={values.seo_description ?? ""}
                onChange={(event) => patch({ seo_description: event.target.value })}
              />
            </SettingRow>
          </SettingGroup>

          <SaveBar
            dirty={settings.dirty}
            summary={settings.summary}
            saving={settings.saving}
            onDiscard={settings.discard}
            onSave={settings.save}
          />

          <ConfirmDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            pending={clearMutation.isPending}
            intent={{
              title: t("removeTitle"),
              description: t("removeDescription", {
                domain: domain.domain ?? t("thisDomain"),
                workspace: ws.name
              }),
              confirmLabel: t("removeDomain"),
              tone: "danger"
            }}
            onConfirm={() => clearMutation.mutate()}
          />
        </>
      )}
    </WorkspaceSettingsFrame>
  );
}
