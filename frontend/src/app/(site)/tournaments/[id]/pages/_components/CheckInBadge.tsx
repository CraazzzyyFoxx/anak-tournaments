import { CheckCircle2, Circle } from "lucide-react";

import { cn } from "@/lib/utils";

export default function CheckInBadge({
  checkedIn,
}: {
  checkedIn: boolean | undefined;
}) {
  const isCheckedIn = checkedIn === true;
  const label = isCheckedIn ? "Checked In" : "Not Checked In";

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex size-5 items-center justify-center",
        isCheckedIn ? "text-emerald-400" : "text-white/35",
      )}
    >
      {isCheckedIn ? (
        <CheckCircle2 className="size-4" />
      ) : (
        <Circle className="size-4" />
      )}
    </span>
  );
}
