"use client";

import Link from "next/link";
import { ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import pickBanService from "@/services/pickBan.service";

interface PregameRoomLinkProps {
  encounterId: number;
  tournamentId: number;
}

/**
 * Link to the unified pre-game room (map veto + hero bans). Rendered whenever
 * EITHER kind applies to this encounter — a room reachable only once its
 * session exists would hide the very room captains need to open to confirm
 * readiness in the first place (backend: `EncounterReadiness` gates session
 * creation, not room existence). Replaces the retired `VetoRoomLink` /
 * `HeroBanRoomLink` pair.
 */
export function PregameRoomLink({ encounterId, tournamentId }: PregameRoomLinkProps) {
  const t = useTranslations();
  const mapQuery = useQuery({
    queryKey: ["pregame-state", encounterId, "map"],
    queryFn: () => pickBanService.getPickBanState("map", encounterId),
  });
  const heroQuery = useQuery({
    queryKey: ["pregame-state", encounterId, "hero"],
    queryFn: () => pickBanService.getPickBanState("hero", encounterId),
  });

  const applies = (state: typeof mapQuery.data) => state != null && (state.reason !== "not_configured" || state.session != null);
  if (!applies(mapQuery.data) && !applies(heroQuery.data)) {
    return null;
  }

  return (
    <Button variant="outline" asChild>
      <Link href={`/tournaments/${tournamentId}/pregame/${encounterId}`}>
        <ListChecks className="mr-2 h-4 w-4" aria-hidden />
        {t("encounters.detail.pregameRoom")}
      </Link>
    </Button>
  );
}
