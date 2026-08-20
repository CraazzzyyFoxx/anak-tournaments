import { getTranslations } from "next-intl/server";

import OwalSeasonFilter from "./_components/OwalSeasonFilter";
import OwalPageTabs from "./_components/OwalPageTabs";
import { getOwalPageData, OwalPageSearchParams } from "./_data";

export const dynamic = "force-dynamic";

type OwalPageProps = {
  searchParams: Promise<OwalPageSearchParams>;
};

const OwalPage = async ({ searchParams }: OwalPageProps) => {
  const [{ seasons, selectedSeason, standings, stacks }, t] = await Promise.all([
    getOwalPageData(searchParams),
    getTranslations()
  ]);

  return (
    <div className="flex flex-col gap-4">
      {/* This route shipped with no heading at all — the only public page whose
          document outline started at nothing. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-onest text-2xl font-semibold tracking-tight text-[color:var(--aqt-fg)]">
          {t("owal.title")}
        </h1>
        {selectedSeason ? (
          <OwalSeasonFilter seasons={seasons} selectedSeason={selectedSeason} />
        ) : null}
      </div>
      <OwalPageTabs standings={standings} stacks={stacks} />
    </div>
  );
};

export default OwalPage;
