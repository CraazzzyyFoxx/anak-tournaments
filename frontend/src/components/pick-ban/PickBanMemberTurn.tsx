"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Spinner } from "@/components/ui/spinner";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import pickBanService from "@/services/pickBan.service";
import type { PickBanKind, PickBanState, PickBanSubmissionItem } from "@/types/tournament.types";

import type { PickBanItemLike } from "./PickBanGrid";

/** Whom a member pick is made for, when the viewer may pick for more than one player (spec §11.6 R4-3, R4-9). */
export function PickBanMemberChooser({
  members,
  value,
  onChange
}: Readonly<{
  members: { id: number; name: string }[];
  value: number | null;
  onChange: (memberId: number) => void;
}>) {
  const t = useTranslations("pickBan.room");
  return (
    <div className="flex flex-col gap-1" role="group" aria-label={t("member.pickFor")}>
      <Eyebrow>{t("member.pickFor")}</Eyebrow>
      <div className="flex flex-wrap gap-1">
        {members.map((member) => (
          <Button
            key={member.id}
            type="button"
            size="sm"
            variant={member.id === value ? "default" : "outline"}
            aria-pressed={member.id === value}
            onClick={() => onChange(member.id)}
          >
            {member.name}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * An assignment step (spec §11.6 R4-1, model c): a team's captain gives each player one of the heroes the team
 * picked; the offer per player is the server's (`member_eligible`, Fearless applied). A host assigns for any team
 * still owing. What nobody locks in time the clock assigns at random.
 */
export function PickBanAssignBoard({
  kind,
  encounterId,
  state,
  itemsById,
  isAdmin,
  queryKey,
  teamName,
  header
}: Readonly<{
  kind: PickBanKind;
  encounterId: number;
  state: PickBanState;
  itemsById: Record<number, PickBanItemLike | undefined>;
  isAdmin: boolean;
  queryKey: unknown[];
  teamName: (teamId: number) => string;
  header: React.ReactNode;
}>) {
  const t = useTranslations("pickBan.room");
  const queryClient = useQueryClient();
  const own = state.viewer_can_act && state.viewer_team_id != null ? [state.viewer_team_id] : [];
  const teams = isAdmin ? [...new Set([...own, ...state.acting_team_ids])] : own;
  // member -> hero; giving a hero to one player takes it from whoever had it.
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const submit = useMutation({
    mutationFn: ({ teamId, items }: { teamId: number; items: PickBanSubmissionItem[] }) =>
      own.includes(teamId)
        ? pickBanService.submitDraft(kind, encounterId, { items, lock: true })
        : adminService.adminPickBanSubmit(encounterId, {
            kind,
            encounter_team_id: teamId,
            items,
            lock: true
          }),
    onError: (error) => notify.apiError(error, { title: t("assign.failed") }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey })
  });
  const heroName = (heroId: number) =>
    itemsById[heroId]?.name ?? t(`${kind}.itemNumber`, { id: heroId });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 pb-3">
        {header}
        <CardTitle className="border-t border-[color:var(--aqt-border)] pt-4 text-base">
          {t("assign.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {teams.length === 0 ? (
          <p className="text-sm text-[color:var(--aqt-fg-muted)]">{t("assign.waiting")}</p>
        ) : null}
        {teams.map((teamId) => {
          const members = state.members.filter((member) => member.encounter_team_id === teamId);
          const items: PickBanSubmissionItem[] = members.flatMap((member) =>
            chosen[member.id] != null
              ? [{ item_id: chosen[member.id], target_player_id: null, member_id: member.id }]
              : []
          );
          return (
            <section key={teamId} className="flex flex-col gap-2" aria-label={teamName(teamId)}>
              <Eyebrow>{teamName(teamId)}</Eyebrow>
              {members.map((member) => (
                <div key={member.id} className="flex flex-wrap items-center gap-1">
                  <span className="w-32 truncate text-sm">{member.name}</span>
                  {(state.member_eligible?.[String(member.id)] ?? []).map((heroId) => (
                    <Button
                      key={heroId}
                      type="button"
                      size="sm"
                      variant={chosen[member.id] === heroId ? "default" : "outline"}
                      aria-pressed={chosen[member.id] === heroId}
                      aria-label={t("assign.give", { hero: heroName(heroId), member: member.name })}
                      onClick={() =>
                        setChosen((current) => ({
                          ...Object.fromEntries(
                            Object.entries(current).filter(([, hero]) => hero !== heroId)
                          ),
                          [member.id]: heroId
                        }))
                      }
                    >
                      {heroName(heroId)}
                    </Button>
                  ))}
                </div>
              ))}
              <Button
                size="sm"
                className="self-start"
                disabled={items.length === 0 || submit.isPending}
                onClick={() => submit.mutate({ teamId, items })}
              >
                {submit.isPending ? <Spinner className="mr-2" /> : null}
                {t("assign.lock")}
              </Button>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
