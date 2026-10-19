"use client";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ResTag, ScoreCell } from "@/components/match/cells";
import MatchLogIndicator from "@/components/match/MatchLogIndicator";
import { CatalogEntityStrip } from "@/components/catalog/CatalogEntityImage";
import { TooltipProvider } from "@/components/ui/tooltip";
import MatchRowBadge from "@/components/match/MatchRowBadge";
import { encounterPerspective } from "@/app/(site)/users/components/shared/encounter-perspective";
import { EncounterWithUserStats } from "@/types/user.types";
import type { CatalogEntityRead } from "@/types/catalog.types";
import { tournamentHref } from "@/lib/tournament/url";

interface MatchRowProps {
  enc: EncounterWithUserStats;
  selfUserId: number;
}

const MatchRow = ({ enc, selfUserId }: MatchRowProps) => {
  const router = useRouter();
  const t = useTranslations();
  const { opponent, userScore, oppScore, kind: scoreKind } = encounterPerspective(enc, selfUserId);
  const resKind = scoreKind === "win" ? "w" : scoreKind === "loss" ? "l" : "d";
  const opponentName = opponent?.name;
  const tournamentName = enc.tournament?.name ?? `#${enc.tournament_id}`;
  const heroSet = new Set<number>();
  const heroList: CatalogEntityRead[] = [];
  (enc.matches ?? []).forEach((match) => {
    // `viewer.characters` is already the viewer's characters for this match (the module's eligibility rule is
    // applied server-side from native character facts).
    (match.viewer?.characters ?? []).forEach((character) => {
      if (!heroSet.has(character.id)) {
        heroSet.add(character.id);
        heroList.push(character);
      }
    });
  });

  const observedMatches = (enc.matches ?? []).filter((m) => m.viewer != null);

  return (
    <tr
      onClick={() => router.push(`/encounters/${enc.id}`)}
      className="cursor-pointer border-b border-[color:var(--aqt-border)] transition-colors last:border-b-0 hover:bg-[color:var(--aqt-overlay-2)]"
    >
      <td className="px-3.5 py-3">
        <HoverPrefetchLink
          href={tournamentHref(enc.tournament_id)}
          onClick={(e) => e.stopPropagation()}
          title={tournamentName}
          className="block max-w-[200px] truncate text-[color:var(--aqt-fg-muted)] hover:text-[color:var(--aqt-teal)]"
        >
          {tournamentName}
        </HoverPrefetchLink>
      </td>
      <td className="px-3.5 py-3 text-[color:var(--aqt-fg-dim)]">
        {(enc.stage_item?.name ?? enc.stage?.name)?.trim() || "—"}
      </td>
      <td className="px-3.5 py-3">
        <span className="inline-flex items-center gap-2">
          <ResTag kind={resKind} />
          <HoverPrefetchLink
            href={`/encounters/${enc.id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-[color:var(--aqt-teal)]"
          >
            {t("common.vs")} {opponentName}
          </HoverPrefetchLink>
        </span>
      </td>
      <td className="px-3.5 py-3">
        <ScoreCell kind={scoreKind} value={`${userScore}-${oppScore}`} />
      </td>
      <td className="px-3.5 py-3">
        <CatalogEntityStrip entities={heroList} size="sm" limit={4} />
      </td>
      <td className="px-3.5 py-3">
        {observedMatches.length > 0 ? (
          <TooltipProvider delayDuration={150}>
            <span className="inline-flex items-center gap-2">
              {observedMatches.map((m) => (
                <MatchRowBadge key={m.id} match={m} />
              ))}
            </span>
          </TooltipProvider>
        ) : (
          <span className="aqt-tnum text-[color:var(--aqt-fg-faint)]">—</span>
        )}
      </td>
      <td className="aqt-tnum px-3.5 py-3 text-label text-[color:var(--aqt-fg-dim)]">
        {enc.closeness != null ? `${(enc.closeness * 100).toFixed(0)}%` : "—"}
      </td>
      <td className="px-3.5 py-3" onClick={(e) => e.stopPropagation()}>
        <MatchLogIndicator
          hasLogs={enc.has_logs}
          logs={
            enc.has_logs
              ? (enc.matches ?? []).map((m) => ({
                  matchId: m.id,
                  rawAvailable: m.raw_available,
                  label: `${m.map?.name ?? t("encounters.match.mapAlt")} · #${m.id}`
                }))
              : undefined
          }
        />
      </td>
    </tr>
  );
};

export default MatchRow;
