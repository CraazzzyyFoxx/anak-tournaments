import type { ReactNode } from "react";

import { EYEBROW_CLASS } from "@/components/kit/tone";

/** A setup step's configuration as one row of label/value facts, not KPI tiles. */
export function DraftFacts({
  facts
}: Readonly<{ facts: ReadonlyArray<{ label: string; value: ReactNode }> }>) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className={EYEBROW_CLASS}>{fact.label}</dt>
          <dd className="mt-1 text-sm font-medium tabular-nums">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
