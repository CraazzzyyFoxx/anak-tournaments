"use client";

import { useConditionText, type ConditionSentence } from "@/lib/achievements/condition-text";
import type { ConditionNode } from "@/types/achievement.types";

/** Group rows are the only coloured thing here: the operator is the one piece
 *  of structure a reader has to keep in their head. */
const GROUP_COLOR: Record<string, string> = {
  AND: "var(--aqt-blue)",
  OR: "var(--aqt-amber)",
  NOT: "var(--aqt-rose)",
};

function SentenceItem({ sentence }: Readonly<{ sentence: ConditionSentence }>) {
  const color = sentence.group ? GROUP_COLOR[sentence.group] : undefined;

  return (
    <li>
      {sentence.group ? (
        <span
          className="text-label font-bold uppercase tracking-label"
          style={{ color }}
        >
          {sentence.text}
        </span>
      ) : (
        <span className="text-sm text-[color:var(--aqt-fg-muted)]">{sentence.text}</span>
      )}
      {sentence.children && sentence.children.length > 0 ? (
        <ul
          className="mt-1.5 flex flex-col gap-1.5 border-l pl-3"
          style={{
            borderColor: color
              ? `color-mix(in srgb, ${color} 25%, transparent)`
              : "var(--aqt-border)",
          }}
        >
          {sentence.children.map((child, index) => (
            <SentenceItem key={index} sentence={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The condition tree as prose: one sentence per engine node, nested under the
 * group it belongs to. The raw params ("op >= value 5") never reach the page -
 * `condition-text` folds them into the sentence, with hero and stat names
 * resolved, and the admin viewer reads the same text.
 */
export default function ConditionTreeView({
  tree,
  discipline
}: Readonly<{ tree: ConditionNode; discipline: string }>) {
  const { describe } = useConditionText(tree, discipline);

  return (
    <ul className="flex flex-col gap-1.5">
      <SentenceItem sentence={describe(tree)} />
    </ul>
  );
}
