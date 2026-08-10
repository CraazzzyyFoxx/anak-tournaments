"use client";

import Link from "next/link";
import { Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import pickBanService from "@/services/pickBan.service";

interface HeroBanRoomLinkProps {
  encounterId: number;
  tournamentId: number;
}

/**
 * Sibling of `VetoRoomLink` for the generic hero-ban room. Rendered only when
 * a hero pick-ban session exists for the encounter — `session: null` (not
 * configured / teams unknown) keeps the link hidden.
 */
export function HeroBanRoomLink({ encounterId, tournamentId }: HeroBanRoomLinkProps) {
  const t = useTranslations();
  const stateQuery = useQuery({
    queryKey: ["encounter-hero-pool-state", encounterId],
    queryFn: () => pickBanService.getHeroPoolState(encounterId),
  });

  if (!stateQuery.data?.session) {
    return null;
  }

  return (
    <Button variant="outline" asChild>
      <Link href={`/tournaments/${tournamentId}/hero-ban/${encounterId}`}>
        <Shield className="mr-2 h-4 w-4" aria-hidden />
        {t("encounters.detail.heroBanRoom")}
      </Link>
    </Button>
  );
}
