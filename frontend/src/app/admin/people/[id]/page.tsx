"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft } from "lucide-react";

import { PlayerProfileBody } from "@/components/admin/PlayerProfileDialog";
import { UserMergeDialog } from "@/components/admin/UserMergeDialog";
import { LinkTabs, type LinkTabItem } from "@/components/kit/LinkTabs";
import { EntityHubHeader } from "@/components/kit/EntityHubHeader";
import { PersonAccountTab } from "@/components/admin/people/PersonAccountTab";
import { PersonAchievementsTab } from "@/components/admin/people/PersonAchievementsTab";
import { PersonParticipationsTab } from "@/components/admin/people/PersonParticipationsTab";
import { PersonGlance } from "@/components/admin/people/PersonGlance";
import { RankPlayerPanel } from "@/components/admin/people/PersonRankPanel";
import { SubscriptionPlayerPanel } from "@/components/admin/people/PersonSubscriptionPanel";
import { RankOverviewTable } from "@/components/admin/ranks/RankOverviewTable";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageStateCard } from "@/components/ui/page-state-card";
import { usePermissions } from "@/hooks/usePermissions";
import adminService from "@/services/admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { User } from "@/types/user.types";
import { adminQueryKeys } from "@/lib/admin/query-keys";

const TABS = [
  "profile",
  "participations",
  "achievements",
  "ranks",
  "subscriptions",
  "account"
] as const;
type PersonTab = (typeof TABS)[number];

function Section({
  title,
  children
}: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="rounded-xl border border-border/60 p-4">
      <h2 className={EYEBROW_CLASS}>{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * One person: who they are, what they played, who signs in as them.
 *
 * The identity itself has no by-id read (`/api/v1/admin/users/{id}` is
 * PATCH/DELETE only), so the person is picked out of the same full list the
 * People browser loads — one shared cache entry, not a second fetch shape.
 * The key is exactly the one `breadcrumb-registry.ts` declares for the
 * `people` segment, which is how the crumb shows a name instead of "Details".
 */
export default function PersonHubPage() {
  const t = useTranslations("adminPeople.person");
  const params = useParams<{ id: string }>();
  const personId = Number(params.id);
  const searchParams = useSearchParams();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission, hasPermission, isSuperuser, isLoaded } = usePermissions();
  const [mergeOpen, setMergeOpen] = useState(false);

  const canRead = canAccessPermission("user.read", workspaceId);
  const canUpdate = hasPermission("user.update");
  const canReadAuth = hasPermission("auth_user.read");
  const canReadRanks = canAccessPermission("team.update", workspaceId);
  const canMerge = isSuperuser;
  const canManageIdentity = isSuperuser;

  const requested = searchParams.get("tab") ?? "";
  const tab: PersonTab = (TABS as readonly string[]).includes(requested)
    ? (requested as PersonTab)
    : "profile";

  const personQuery = useQuery({
    queryKey: adminQueryKeys.person(personId),
    queryFn: async () => {
      const page = await adminService.getUsers({ per_page: -1 });
      const found = page.results.find((candidate) => candidate.id === personId);
      if (!found) throw new Error(t("error", { id: personId }));
      return found;
    },
    enabled: canRead && Number.isFinite(personId)
  });

  if (!isLoaded) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none" />;
  }

  if (!canRead) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("unauthorized")}</CardTitle>
          <CardDescription>
            {t("noPermission")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (personQuery.isError) {
    return (
      <PageStateCard
        state="not-found"
        title={t("notFound")}
        description={t("notFoundDescription", { id: personId })}
      />
    );
  }

  const person: User | undefined = personQuery.data;
  const tabLabels: Record<PersonTab, string> = {
    profile: t("tabs.profile"), participations: t("tabs.participations"), achievements: t("tabs.achievements"),
    ranks: t("tabs.ranks"), subscriptions: t("tabs.subscriptions"), account: t("tabs.account")
  };
  const items: LinkTabItem[] = TABS.map((key) => ({
    key,
    label: tabLabels[key],
    href: `/admin/people/${personId}?tab=${key}`
  }));

  return (
    <div className="space-y-4">
      <EntityHubHeader
        title={person?.name ?? `Player #${personId}`}
        backHref="/admin/people"
        meta={[
          <span key="id" className="font-mono tabular-nums">
            #{personId}
          </span>,
          `${person?.social_accounts?.length ?? 0} identities`
        ]}
        actions={
          canMerge && person ? (
            <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)}>
              <ArrowRightLeft aria-hidden className="size-3.5" />
              {t("merge")}
            </Button>
          ) : null
        }
      />

      <LinkTabs items={items} activeKey={tab} ariaLabel={t("tabs.profile")} />

      {tab === "profile" ? (
        person ? (
          // The profile body was built for a max-w-md dialog — a centred avatar
          // and a stacked identity list — so it keeps dialog width as the left
          // rail. The rank and subscription tables used to fill the rest and
          // made this the heaviest tab; they have their own tabs now, and the
          // right column keeps one line of each.
          <div className="grid items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Section title={t("tabs.profile")}>
              <PlayerProfileBody
                key={person.id}
                user={person}
                canEdit={canUpdate}
                canManageIdentity={canManageIdentity}
                canSetVisibility={canRead}
                workspaceId={workspaceId}
                // The header already carries Merge; a second button under the
                // avatar said the same thing twice.
                canMerge={false}
              />
            </Section>

            <Section title={t("tabs.profile")}>
              <PersonGlance personId={person.id} canReadAuth={canReadAuth} />
            </Section>
          </div>
        ) : (
          <div className="h-64 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none" />
        )
      ) : null}

      {tab === "participations" ? (
        <PersonParticipationsTab
          personId={personId}
          personName={person?.name ?? ""}
          workspaceId={workspaceId}
        />
      ) : null}

      {tab === "achievements" ? <PersonAchievementsTab personId={personId} /> : null}

      {tab === "ranks" ? (
        <div className="space-y-4">
          {/* The workspace's own numbers for this person — every layer, flat.
              `team.update` is the roster owner's grant, the same one the
              endpoint checks; without it the tab is just the OverFast block. */}
          {canReadRanks ? (
            <Section title={t("tabs.ranks")}>
              <RankOverviewTable playerId={personId} />
            </Section>
          ) : null}
          <Section title={t("tabs.ranks")}>
            <RankPlayerPanel userId={personId} />
          </Section>
        </div>
      ) : null}

      {tab === "subscriptions" ? (
        <Section title={t("tabs.subscriptions")}>
          <SubscriptionPlayerPanel userId={personId} label={person?.name ?? `Player #${personId}`} />
        </Section>
      ) : null}

      {tab === "account" ? (
        <PersonAccountTab personId={personId} canReadAuth={canReadAuth} />
      ) : null}

      {mergeOpen && person ? (
        <UserMergeDialog
          key={person.id}
          sourceUser={person}
          open
          onOpenChange={setMergeOpen}
          onMerged={() => setMergeOpen(false)}
        />
      ) : null}
    </div>
  );
}
