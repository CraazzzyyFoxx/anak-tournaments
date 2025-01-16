import * as React from "react";

import encounterService from "@/services/encounter.service";
import EncountersTable from "@/components/EncountersTable";
import { Suspense } from "react";

export default async function EncountersPage({ searchParams }: { searchParams: URLSearchParams }) {
  // @ts-ignore
  const page = parseInt(searchParams.page) || 1;
  // @ts-ignore
  const search = searchParams.search || "";
  const data = await encounterService.getAll(page, search);

  return (
    <Suspense>
      <EncountersTable data={data} search={search} InitialPage={page} />
    </Suspense>
  );
}
