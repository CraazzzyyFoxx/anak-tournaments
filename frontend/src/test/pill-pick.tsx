"use client";

import { useScopePillOpen } from "@/components/workspace/scope-pill-store";
import { useGameScope } from "@/hooks/useGameScope";

/**
 * The scope pill's game pick without its popover (ruling R5): the page's registered game-bound params ride along as
 * `dropParams`. A page test renders it beside the page and clicks `[data-pill-pick=<code>]`, then asserts the URL.
 */
export function PillPick({ code }: Readonly<{ code: string }>) {
  const scope = useGameScope();
  const gameBoundParams = useScopePillOpen((state) => state.gameBoundParams);
  return (
    <button
      type="button"
      data-pill-pick={code}
      onClick={() => scope.selectScope(code, { dropParams: [...gameBoundParams] })}
    />
  );
}
