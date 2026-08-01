import { redirect } from "next/navigation";

import { balancerRedirectTarget, searchParamsFromRecord } from "@/app/balancer/redirect-map";

// D28: legacy route permanently redirects to the hub registration tab.
export default async function BalancerRegistrationsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(balancerRedirectTarget("/balancer/registrations", searchParamsFromRecord(await searchParams)));
}
