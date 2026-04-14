import StatusMetaBadge from "@/components/status/StatusMetaBadge";
import type { RegistrationStatus, StatusMeta } from "@/types/registration.types";

export default function StatusBadge({
  status,
  meta,
}: {
  status: RegistrationStatus;
  meta?: StatusMeta | null;
}) {
  return <StatusMetaBadge meta={meta} fallbackValue={status} />;
}
