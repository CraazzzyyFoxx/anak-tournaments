import { redirect } from "next/navigation";

import { balancerRedirectTarget, searchParamsFromRecord } from "@/app/balancer/redirect-map";

// D28: legacy route permanently redirects to the sheets-filtered registration tab.
export default async function BalancerApplicationsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(
    balancerRedirectTarget("/balancer/applications", searchParamsFromRecord(await searchParams))
  );
}
