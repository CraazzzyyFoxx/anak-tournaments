import { redirect } from "next/navigation";

import { balancerRedirectTarget } from "@/app/balancer/redirect-map";

// D28: the canonical statuses route lives in the admin panel.
export default function BalancerStatusesRedirectPage() {
  redirect(balancerRedirectTarget("/balancer/statuses", new URLSearchParams()));
}
