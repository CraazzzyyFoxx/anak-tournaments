"use client";

import { useTranslations } from "next-intl";

import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { CardSurface } from "@/components/profile/atoms";
import ProfileWidget from "@/components/profile/ProfileWidget";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { useRoleName } from "@/hooks/useRoleName";
import { winrateColor } from "@/lib/colors";
import { findRole, ratedDimension, roleTint, rosterRoleRank } from "@/lib/roster/ontology";
import { aggregateRoleStats } from "@/lib/roster/role-ref";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import type { CharacterSummary, UserProfile, UserRole } from "@/types/user.types";

/** The unassigned bucket's hue: the open roster slot's, never a role's. */
const UNASSIGNED_COLOR = "var(--aqt-flex)";

const formatPercent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

interface Bucket {
  id: string;
  role: UserRole;
  label: string;
  color: string;
  maps: number;
  won: number;
  lost: number;
  winrate: number;
  share: number;
}

interface Props {
  profile: UserProfile;
  /** The profile's game: its ontology names and paints the roles, its module may add signature characters. */
  discipline: string;
  /** The workspace axis the profile is viewed on: its ontology carries that workspace's sub-roles (tenant host: its own). */
  axis: WorkspaceAxis;
  /** The player's characters in that game (no per-stat best records) — the signature source. */
  characters: CharacterSummary[];
  /** Per-character game counts over the player's maps; `null` without map data. */
  games: Record<number, number> | null;
}

/**
 * The overview's role split: each role the player was rated in (parent totals, game ontology order) plus the
 * unassigned bucket, by maps played and won. The roles' names, glyphs and hues come from the game's ontology; the
 * game's module may add a signature character per role (`roleSignatures` slot).
 */
const OverviewRoleSplit = ({ profile, discipline, axis, characters, games }: Props) => {
  const t = useTranslations();
  const nameOf = useRoleName();
  const ontology = useDisciplineMetadata(axis, discipline).data ?? null;
  if (!profile.roles.length) return null;

  const totalMaps = profile.maps_total;
  const rank = rosterRoleRank(ontology);
  const buckets: Bucket[] = aggregateRoleStats(profile.roles)
    .sort((a, b) => (a.role === null ? 1 : 0) - (b.role === null ? 1 : 0) || rank(a.role) - rank(b.role))
    .map((role) => {
      const node = ontology && role.role ? findRole(ontology, role.role) : null;
      return {
        id: role.role ? `${role.role.dimension}:${role.role.role}` : "unassigned",
        role,
        label: role.role === null ? t("common.roles.flex") : node ? nameOf(node) : role.role.role,
        color: role.role === null ? UNASSIGNED_COLOR : roleTint(ontology, role.role.role),
        maps: role.maps,
        won: role.maps_won,
        lost: role.maps - role.maps_won,
        winrate: role.maps > 0 ? role.maps_won / role.maps : 0,
        share: totalMaps > 0 ? role.maps / totalMaps : 0
      };
    });

  const primary = buckets.reduce<Bucket | undefined>(
    (best, current) => (best === undefined || current.role.tournaments > best.role.tournaments ? current : best),
    undefined
  );
  const rated = ontology ? ratedDimension(ontology)?.code : undefined;
  const ratedRoles = buckets.flatMap((b) => (b.role.role && b.role.role.dimension === rated ? [b.role.role.role] : []));

  return (
    <CardSurface
      title={t("users.overview.roleSplit.title")}
      subtitle={t("users.overview.roleSplit.subtitle", {
        maps: totalMaps,
        tournaments: profile.tournaments_count
      })}
    >
      <div className="flex flex-col gap-3.5">
        {/* Role-spectrum distribution bar (design-book §3f) — one thin
            full-width bar segmented by each role's share of maps played. */}
        <div className="flex flex-col gap-2">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--aqt-card-2)]" aria-hidden>
            {buckets.map((b) =>
              b.share > 0 ? (
                <div
                  key={b.id}
                  style={{ width: `${b.share * 100}%`, background: b.color }}
                  title={`${b.label} · ${Math.round(b.share * 100)}%`}
                />
              ) : null
            )}
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1">
            {buckets.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1.5 text-label text-[color:var(--aqt-fg-muted)]">
                <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: b.color }} aria-hidden />
                {b.label}
                <span className="aqt-tnum font-bold text-[color:var(--aqt-fg)]">{b.maps}</span>
                <span className="aqt-tnum text-[color:var(--aqt-fg-faint)]">{Math.round(b.share * 100)}%</span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col divide-y divide-[color:var(--aqt-border)]">
          {buckets.map((b) => (
            <div key={b.id} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 py-3 first:pt-0 last:pb-0">
              <DivisionIcon
                division={b.role.division}
                tournamentGrid={b.role.division_grid_version}
                width={44}
                height={44}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-onest text-base font-bold leading-none text-[color:var(--aqt-fg)]">
                  <PlayerRoleIcon role={b.role.role} ontology={ontology} size={14} color={b.color} decorative />
                  {b.label}
                  {primary && b.id === primary.id ? (
                    <span className="ml-1 text-label font-semibold text-[color:var(--aqt-fg-muted)]">
                      · {t("users.overview.roleSplit.main")}
                    </span>
                  ) : null}
                </div>
                <div className="aqt-tnum mt-1 text-label text-[color:var(--aqt-fg-muted)]">
                  {b.won}W · {b.lost}L · {t("users.overview.mapsCount", { count: b.maps })}
                </div>
              </div>
              <div className="text-right">
                <div
                  className="aqt-tnum font-onest text-title font-bold leading-none"
                  style={{ color: winrateColor(b.winrate * 100) }}
                >
                  {formatPercent(b.winrate)}
                </div>
                <div className="aqt-tnum mt-0.5 text-label text-[color:var(--aqt-fg-dim)]">
                  {formatPercent(b.share)} {t("users.overview.roleSplit.ofPool")}
                </div>
              </div>
            </div>
          ))}
        </div>
        {ratedRoles.length > 0 ? (
          <ProfileWidget
            axis={axis}
            discipline={discipline}
            slot="roleSignatures"
            props={{ characters, games, roles: ratedRoles }}
            fallback={null}
          />
        ) : null}
      </div>
    </CardSurface>
  );
};

export default OverviewRoleSplit;
