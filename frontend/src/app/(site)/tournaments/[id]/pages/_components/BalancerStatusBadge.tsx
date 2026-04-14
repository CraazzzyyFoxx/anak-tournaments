import StatusMetaBadge from "@/components/status/StatusMetaBadge";
import type { BalancerStatus, StatusMeta } from "@/types/registration.types";

export default function BalancerStatusBadge({
  status,
  meta,
}: {
  status: BalancerStatus | undefined;
  meta?: StatusMeta | null;
}) {
  return <StatusMetaBadge meta={meta} fallbackValue={status ?? "not_in_balancer"} />;
}
