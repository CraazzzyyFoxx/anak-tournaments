import { redirect } from "next/navigation";

import { balancerRedirectTarget, searchParamsFromRecord } from "@/app/balancer/redirect-map";

// D28: legacy route permanently redirects to the hub rank-autofill sub-route.
export default async function BalancerRankAutofillRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(
    balancerRedirectTarget(
      "/balancer/registrations/rank-autofill",
      searchParamsFromRecord(await searchParams)
    )
  );
}
