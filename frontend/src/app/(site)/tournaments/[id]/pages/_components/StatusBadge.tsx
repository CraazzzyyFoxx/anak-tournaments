import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldBan,
  Undo2,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { RegistrationStatus } from "@/types/registration.types";

interface StatusConfig {
  label: string;
  fullLabel: string;
  icon: typeof Clock;
  className: string;
}

const STATUS_CONFIG: Record<RegistrationStatus, StatusConfig> = {
  pending: {
    label: "Review",
    fullLabel: "In Review",
    icon: Clock,
    className: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  },
  approved: {
    label: "Approved",
    fullLabel: "Approved",
    icon: CheckCircle2,
    className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  },
  rejected: {
    label: "Rejected",
    fullLabel: "Rejected",
    icon: XCircle,
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  withdrawn: {
    label: "Withdrawn",
    fullLabel: "Withdrawn",
    icon: Undo2,
    className: "border-white/10 bg-white/5 text-white/40",
  },
  banned: {
    label: "Banned",
    fullLabel: "Banned",
    icon: ShieldBan,
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  insufficient_data: {
    label: "Missing",
    fullLabel: "Incomplete",
    icon: AlertTriangle,
    className: "border-orange-500/20 bg-orange-500/10 text-orange-400",
  },
};

export default function StatusBadge({ status }: { status: RegistrationStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
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
