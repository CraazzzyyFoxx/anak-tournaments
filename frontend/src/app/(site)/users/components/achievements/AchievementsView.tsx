"use client";

import { useMemo, useState, useTransition } from "react";
import { Award, Crown, Flame, Gem, Sparkles, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AchievementRarity } from "@/types/achievement.types";
import type { UserTournamentSummary } from "@/types/user.types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  classifyRarity,
  localizedText,
  RARITY_ORDER,
  rarityRanges,
  rarityTitles,
  type Rarity
} from "@/app/(site)/users/components/achievements/rarity";
import { AchievementDetailDialog } from "@/app/(site)/users/components/achievements/AchievementDetailDialog";
import { FilterChip, FilterChipGroup } from "@/components/ui/filter-chip";
import { SearchField } from "@/components/ui/search-field";

const TOURNAMENT_QUERY_KEY = "achievementTournamentId";

// Crest per tier. `uncommon` and `common` share the neutral award crest: the
// tiers exist in the ranking, but nothing about them is worth its own symbol.
const RARITY_ICON: Record<Rarity, LucideIcon> = {
  mythic: Flame,
  legendary: Crown,
  epic: Gem,
  rare: Sparkles,
  uncommon: Award,
  common: Award
};

interface Props {
  achievements: AchievementRarity[];
  tournaments?: UserTournamentSummary[];
  selectedTournamentValue?: string;
}

const AchievementsView = ({ achievements, tournaments = [], selectedTournamentValue = "all" }: Props) => {
  const tr = useTranslations();
  const locale = useLocale();
  const titles = rarityTitles(tr);
  const ranges = rarityRanges(tr);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [rarityFilter, setRarityFilter] = useState<Rarity | null>(null);
  const [lockFilter, setLockFilter] = useState<"all" | "unlocked" | "locked">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"rarity" | "name" | "count">("rarity");
  const [selected, setSelected] = useState<AchievementRarity | null>(null);

  const uniqueTournaments = useMemo(() => {
    const seen = new Set<number>();
    return tournaments.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [tournaments]);

  const onTournamentChange = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      next.delete(TOURNAMENT_QUERY_KEY);
    } else {
      next.set(TOURNAMENT_QUERY_KEY, value);
    }
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  };

  const grouped = useMemo(() => {
    const buckets: Record<Rarity, AchievementRarity[]> = {
      mythic: [],
      legendary: [],
      epic: [],
      rare: [],
      uncommon: [],
      common: []
    };
    for (const ach of achievements) {
      const rarity = classifyRarity(ach.rarity * 100);
      buckets[rarity].push(ach);
    }
    return buckets;
  }, [achievements]);

  const counts = useMemo(() => {
    return {
      mythic: grouped.mythic.length,
      legendary: grouped.legendary.length,
      epic: grouped.epic.length,
      rare: grouped.rare.length,
      uncommon: grouped.uncommon.length,
      common: grouped.common.length
    };
  }, [grouped]);

  // An achievement with count === 0 is a not-yet-earned (locked) entry.
  const unlockedCounts = useMemo(() => {
    const f = (list: AchievementRarity[]) => list.filter((a) => a.count > 0).length;
    return {
      mythic: f(grouped.mythic),
      legendary: f(grouped.legendary),
      epic: f(grouped.epic),
      rare: f(grouped.rare),
      uncommon: f(grouped.uncommon),
      common: f(grouped.common)
    };
  }, [grouped]);

  const totalCount = achievements.length;
  const unlockedCount = useMemo(() => achievements.filter((a) => a.count > 0).length, [achievements]);
  const lockedCount = totalCount - unlockedCount;
  const hasLocked = lockedCount > 0;

  const visibleGrouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filteredEntry = (rarity: Rarity): AchievementRarity[] => {
      if (rarityFilter && rarityFilter !== rarity) return [];
      let list = grouped[rarity];
      if (lockFilter === "unlocked") list = list.filter((a) => a.count > 0);
      else if (lockFilter === "locked") list = list.filter((a) => a.count === 0);
      if (q) {
        list = list.filter((a) =>
          (a.name?.toLowerCase().includes(q)) ||
          (a.description_en?.toLowerCase().includes(q)) ||
          (a.description_ru?.toLowerCase().includes(q))
        );
      }
      const sorted = [...list].sort((a, b) => {
        if (sort === "name") return (a.name ?? "").localeCompare(b.name ?? "");
        if (sort === "count") return b.count - a.count;
        return a.rarity - b.rarity; // rarest first
      });
      return sorted;
    };
    return Object.fromEntries(RARITY_ORDER.map((r) => [r, filteredEntry(r)])) as Record<Rarity, AchievementRarity[]>;
  }, [grouped, rarityFilter, lockFilter, search, sort]);

  return (
    <div className="aqt-player flex flex-col gap-3.5">
      {/* Rarity rank */}
      <div className="aqt-ach-rank">
        {RARITY_ORDER.map((r) => (
          <div key={r} className={cn("aqt-tier", r)}>
            <span className="aqt-l">{r}</span>
            <span className="aqt-n">{unlockedCounts[r]}</span>
            <span className="aqt-sub">{ranges[r]}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <FilterChipGroup label={tr("common.filters")}>
        <FilterChip
          active={rarityFilter === null && lockFilter === "all"}
          count={totalCount}
          onClick={() => {
            setRarityFilter(null);
            setLockFilter("all");
          }}
        >
          {tr("common.all")}
        </FilterChip>
        {hasLocked ? (
          <>
            <FilterChip
              active={lockFilter === "unlocked"}
              count={unlockedCount}
              onClick={() => setLockFilter(lockFilter === "unlocked" ? "all" : "unlocked")}
            >
              {tr("users.achievements.unlocked")}
            </FilterChip>
            <FilterChip
              active={lockFilter === "locked"}
              count={lockedCount}
              onClick={() => setLockFilter(lockFilter === "locked" ? "all" : "locked")}
            >
              {tr("users.achievements.locked")}
            </FilterChip>
          </>
        ) : null}
        <span aria-hidden className="aqt-filter-divider" />
        {RARITY_ORDER.map((r) => (
          <FilterChip
            key={r}
            active={rarityFilter === r}
            count={counts[r]}
            onClick={() => setRarityFilter(rarityFilter === r ? null : r)}
          >
            <span className="capitalize">{r}</span>
          </FilterChip>
        ))}
        <span aria-hidden className="aqt-filter-divider" />
        {uniqueTournaments.length > 0 && (
          <Select value={selectedTournamentValue} onValueChange={onTournamentChange}>
            <SelectTrigger className="h-8 w-48 border-[color:var(--aqt-border)] bg-[hsl(0_0%_100%/0.02)] text-[14px] text-[color:var(--aqt-fg-muted)] shadow-none hover:border-[color:var(--aqt-border-2)] hover:bg-[hsl(0_0%_100%/0.04)] focus:ring-1 focus:ring-[color:var(--aqt-teal)] focus:ring-offset-0">
              <SelectValue placeholder={tr("users.achievements.filter.allTournaments")} />
            </SelectTrigger>
            <SelectContent className="max-h-[min(var(--radix-select-content-available-height),20rem)]">
              <SelectItem value="all">{tr("users.achievements.filter.allTournaments")}</SelectItem>
              <SelectItem value="none">{tr("users.achievements.filter.withoutTournament")}</SelectItem>
              {uniqueTournaments.map((t) => (
                <SelectItem key={t.id} value={`t-${t.id}`}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={sort} onValueChange={(v) => setSort(v as "rarity" | "name" | "count")}>
          <SelectTrigger
            title={tr("users.achievements.sort.title")}
            className="aqt-mono h-8 w-[150px] shadow-none border-[color:var(--aqt-border)] bg-[hsl(0_0%_100%/0.02)] text-[13px] text-[color:var(--aqt-fg-muted)] hover:border-[color:var(--aqt-border-2)] hover:bg-[hsl(0_0%_100%/0.04)] focus:ring-1 focus:ring-[color:var(--aqt-teal)] focus:ring-offset-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rarity">{tr("users.achievements.sort.rarity")}</SelectItem>
            <SelectItem value="name">{tr("users.achievements.sort.name")}</SelectItem>
            <SelectItem value="count">{tr("users.achievements.sort.earned")}</SelectItem>
          </SelectContent>
        </Select>
        <SearchField
          label={tr("users.achievements.searchLabel")}
          placeholder={tr("users.achievements.searchPlaceholder")}
          value={search}
          onValueChange={setSearch}
          containerClassName="ml-auto min-w-[200px] max-w-[300px] flex-1"
        />
      </FilterChipGroup>

      {/* Sections per rarity */}
      {RARITY_ORDER.map((r) => {
        const list = visibleGrouped[r];
        if (list.length === 0) return null;
        const sectionUnlocked = list.filter((a) => a.count > 0).length;
        const RarityIcon = RARITY_ICON[r];
        return (
          <div key={r} className="aqt-card-surface">
            <div className="aqt-card-head">
              <div className="aqt-card-title">
                <span aria-hidden className="aqt-card-title-ic">
                  <RarityIcon size={15} />
                </span>
                <span>{titles[r]}</span>
              </div>
              <span className="aqt-card-sub">
                {tr("users.achievements.sectionUnlocked", {
                  unlocked: String(sectionUnlocked),
                  total: String(list.length)
                })}
              </span>
            </div>
            <div className="aqt-card-body">
              <div className="aqt-ach-grid">
                {list.map((ach) => {
                  const imgSrc = ach.image_url ?? `/achievements/${ach.slug}.webp`;
                  const initial = (ach.name ?? "?").slice(0, 1).toUpperCase();
                  const locked = ach.count === 0;
                  return (
                    <button
                      key={ach.id}
                      type="button"
                      onClick={() => setSelected(ach)}
                      className={cn("aqt-ach-card w-full text-left", r, locked && "locked")}
                      style={locked ? { opacity: 0.6, filter: "grayscale(0.5)" } : undefined}
                    >
                      {ach.count > 0 ? (
                        <span className="aqt-stamp x">×{ach.count}</span>
                      ) : null}
                      <div className="flex items-start gap-2.5">
                        <div className="aqt-ic-circle relative">
                          {imgSrc ? (
                            <Image
                              src={imgSrc}
                              alt={ach.name}
                              fill
                              sizes="48px"
                              className="object-cover"
                            />
                          ) : (
                            <span className="relative z-[1]">{initial}</span>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="text-[14.5px] font-semibold leading-tight">{ach.name}</div>
                          <div className="text-[12px] leading-snug text-[color:var(--aqt-fg-dim)]">
                            {localizedText(locale, ach.description_ru, ach.description_en)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-auto flex items-center justify-between border-t border-[color:var(--aqt-border)] pt-2 text-[11.5px] text-[color:var(--aqt-fg-muted)]">
                        {locked ? (
                          <span className="aqt-rarity">{tr("users.achievements.locked")}</span>
                        ) : (
                          <span className="aqt-rarity">
                            <span aria-hidden>◆</span> <span className="capitalize">{r}</span>
                          </span>
                        )}
                        <span className="aqt-mono">{(ach.rarity * 100).toFixed(2)}%</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      {achievements.length === 0 ? (
        <div className="aqt-card-surface">
          <div className="aqt-card-body text-center text-[color:var(--aqt-fg-dim)]">
            {tr("users.achievements.emptyState")}
          </div>
        </div>
      ) : null}

      <AchievementDetailDialog achievement={selected} onClose={() => setSelected(null)} />
    </div>
  );
};

export default AchievementsView;
