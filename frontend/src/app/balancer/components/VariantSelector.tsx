import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { BalanceVariant } from "./workspace-helpers";

type VariantSelectorProps = {
  variants: BalanceVariant[];
  activeVariantId: string | null;
  onSelectVariant: (id: string) => void;
};

export function VariantSelector({ variants, activeVariantId, onSelectVariant }: VariantSelectorProps) {
  if (variants.length <= 1) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {variants.map((variant) => {
        const isActive = variant.id === activeVariantId;
        return (
          <button
            key={variant.id}
            type="button"
            onClick={() => onSelectVariant(variant.id)}
            className={cn(
              "rounded-xl border px-3 py-2 text-left transition",
              isActive
                ? "border-violet-400/35 bg-violet-500/[0.12] text-white"
                : "border-white/8 bg-white/[0.02] text-white/55 hover:bg-white/[0.05] hover:text-white",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{variant.label}</span>
              {variant.skippedCount != null && variant.skippedCount > 0 ? (
                <Badge className="rounded-full border-amber-400/20 bg-amber-500/10 text-[10px] text-amber-200 hover:bg-amber-500/10">
                  Skip {variant.skippedCount}
                </Badge>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
