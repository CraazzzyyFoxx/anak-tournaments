import { AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { BalancerStatus } from "@/types/registration.types";

interface StatusConfig {
  label: string;
  fullLabel: string;
  icon: typeof CheckCircle2;
  className: string;
}

const BALANCER_STATUS_CONFIG: Record<BalancerStatus, StatusConfig> = {
  not_in_balancer: {
    label: "Out",
    fullLabel: "Not Added",
    icon: MinusCircle,
    className: "border-white/10 bg-white/5 text-white/40",
  },
  incomplete: {
    label: "Fix",
    fullLabel: "Incomplete",
    icon: AlertTriangle,
    className: "border-orange-500/20 bg-orange-500/10 text-orange-400",
  },
  ready: {
    label: "Ready",
    fullLabel: "Ready",
    icon: CheckCircle2,
    className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  },
};

export default function BalancerStatusBadge({
  status,
}: {
  status: BalancerStatus | undefined;
}) {
  const config =
    BALANCER_STATUS_CONFIG[status ?? "not_in_balancer"] ??
    BALANCER_STATUS_CONFIG.not_in_balancer;
  const Icon = config.icon;

  return (
    <span
      title={config.fullLabel}
      aria-label={config.fullLabel}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        config.className,
      )}
    >
      <Icon className="size-3" />
      {config.label}
    </span>
  );
}
