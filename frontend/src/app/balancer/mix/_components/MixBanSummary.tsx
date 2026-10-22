"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { HeroBanStrip } from "@/app/balancer/mix/_components/MatchHistoryList";
import { PickBanSideAssignment } from "@/components/pick-ban/PickBanSideChoice";
import type { PickBanSeat } from "@/components/pick-ban/pick-ban-model";
import { useSideLabel } from "@/components/pick-ban/useSideLabel";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { useCatalogEntities } from "@/hooks/useCatalogEntities";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import pickBanService from "@/services/pickBan.service";

/**
 * A Live match's settled bans (spec §7.5 E2), read-only and for everyone: the banned heroes in the order they were
 * made and, in LoL, which team starts on which side. One read of the ban room's key -- the room is settled, so
 * nothing polls. Nothing renders unless the room completed: a cancelled one means the match plays without bans.
 */
export function MixBanSummary({
  encounterId,
  discipline,
  seats,
}: Readonly<{ encounterId: number; discipline: string; seats: PickBanSeat[] }>) {
  const t = useTranslations("mixes.room");
  const sideLabelOf = useSideLabel();
  const { data: state } = useQuery({
    queryKey: encounterQueryKeys.pregameHeroState(encounterId),
    queryFn: () => pickBanService.getPickBanState("hero", encounterId),
    // That one read is a real one: the key may still hold the unfinished room Pre-game cached, still "fresh".
    refetchOnMount: "always",
  });
  const slotOf = new Map(seats.map((seat) => [seat.id, seat.slot]));
  // The history's order (`hero_bans`): as the room applied them, each by the team that banned it.
  const bans = (state?.pool ?? [])
    .filter((entry) => entry.status === "banned")
    .sort((a, b) => (a.action_index ?? 0) - (b.action_index ?? 0) || a.id - b.id)
    .flatMap((entry) => {
      const slot = entry.picked_by_team_id == null ? undefined : slotOf.get(entry.picked_by_team_id);
      return slot == null ? [] : [{ slot, item_id: entry.item_id }];
    });
  const heroes = useCatalogEntities(bans.length > 0 ? discipline : null, "character");
  const heroById = new Map((heroes.data ?? []).map((hero) => [hero.id, hero]));

  if (state?.is_complete !== true || (bans.length === 0 && !state.starting_sides?.length)) return null;
  return (
    <Card variant="flat" className="flex flex-col gap-2 px-4 py-3">
      <Eyebrow>{t("bansTitle")}</Eyebrow>
      {bans.length > 0 ? <HeroBanStrip bans={bans} heroById={heroById} /> : null}
      {/* A mix match is one game: position 1. */}
      <PickBanSideAssignment
        startingSides={state.starting_sides}
        position={1}
        seats={seats}
        sideLabel={(code) => sideLabelOf(discipline, code)}
      />
    </Card>
  );
}
