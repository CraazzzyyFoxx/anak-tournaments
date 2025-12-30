import * as React from "react";

import encounterService from "@/services/encounter.service";
import EncountersTable from "@/components/EncountersTable";
import { Suspense } from "react";

type EncountersPageProps = {
  searchParams: Promise<{
    page?: string;
    search?: string;
  }>;
};

export default async function EncountersPage({ searchParams }: EncountersPageProps) {
  const resolvedSearchParams = await searchParams;
  const page = Number.parseInt(resolvedSearchParams.page ?? "1", 10) || 1;
  const search = resolvedSearchParams.search ?? "";
  const data = await encounterService.getAll(page, search);

  return (
    <Suspense>
      <EncountersTable data={data} search={search} InitialPage={page} />
    </Suspense>
  );
}
