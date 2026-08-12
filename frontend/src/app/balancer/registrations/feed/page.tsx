import { redirect } from "next/navigation";

import { balancerRedirectTarget, searchParamsFromRecord } from "@/app/balancer/redirect-map";

// D28: legacy route permanently redirects to the hub sheets-feed sub-route.
export default async function BalancerRegistrationsFeedRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(
    balancerRedirectTarget("/balancer/registrations/feed", searchParamsFromRecord(await searchParams))
  );
}
