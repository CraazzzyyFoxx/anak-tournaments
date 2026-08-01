import { redirect } from "next/navigation";

import { balancerRedirectTarget, searchParamsFromRecord } from "@/app/balancer/redirect-map";

// D28: legacy route permanently redirects to the hub registration form builder.
export default async function BalancerRegistrationFormRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(
    balancerRedirectTarget("/balancer/registrations/form", searchParamsFromRecord(await searchParams))
  );
}
