import { CheckCircle2, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { BalancerStatus } from "@/types/registration.types";
import type { RegistrationStatus } from "@/types/registration.types";

export function isAdmitted(
  registrationStatus: RegistrationStatus,
  balancerStatus: BalancerStatus | undefined,
  checkedIn: boolean | undefined,
): boolean {
  return (
    registrationStatus === "approved" &&
    balancerStatus === "ready" &&
    checkedIn === true
  );
}

export default function AdmissionBadge({
  registrationStatus,
  balancerStatus,
  checkedIn,
}: {
  registrationStatus: RegistrationStatus;
  balancerStatus: BalancerStatus | undefined;
  checkedIn: boolean | undefined;
}) {
  const admitted = isAdmitted(registrationStatus, balancerStatus, checkedIn);
  const label = admitted ? "Admitted" : "Not Admitted";

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex size-5 items-center justify-center",
        admitted ? "text-emerald-400" : "text-red-400",
      )}
    >
      {admitted ? (
        <CheckCircle2 className="size-4" />
      ) : (
        <XCircle className="size-4" />
      )}
    </span>
  );
}
