import { notFound } from "next/navigation";

import achievementsService from "@/services/achievements.service";
import { cn } from "@/lib/utils";
import { resolveServerDisciplineScope, resolveStatsScope } from "@/lib/site/tenant-host";
import { classifyRarity, rarityVarClass } from "@/lib/achievements/rarity";
import AchievementUsers from "@/app/(site)/achievements/[id]/components/AchievementUsers";
import AchievementDetailHeader from "@/app/(site)/achievements/[id]/components/AchievementDetailHeader";
import AchievementConditionsCard from "@/app/(site)/achievements/[id]/components/AchievementConditionsCard";

export const dynamic = "force-dynamic";

const AchievementPage = async (props: { params: Promise<{ id: string }> }) => {
  const params = await props.params;
  // `/achievements/<slug>.webp` art guesses for missing public files land here too.
  if (!/^\d+$/.test(params.id)) notFound();
  // In the all-workspaces scope the catalogue links one copy per slug with the
  // slug's pooled numbers; the detail asks for the same pooling.
  const scope = await resolveStatsScope();
  // The viewing workspace axis (a tenant host's own; never `all` there): condition role names resolve in it.
  const { axis } = await resolveServerDisciplineScope();
  const data = await achievementsService.getOne(Number(params.id), scope);
  // Nobody holds it yet: 0% would tint it mythic, so it stays neutral.
  const rarity = (data.count ?? 0) > 0 ? classifyRarity(data.rarity * 100) : "common";

  return (
    <div className={cn("aqt-player space-y-6", rarityVarClass(rarity))}>
      <AchievementDetailHeader achievement={data} />
      <AchievementConditionsCard achievement={data} axis={axis} />
      <AchievementUsers achievement={data} scope={scope} />
    </div>
  );
};

export default AchievementPage;
