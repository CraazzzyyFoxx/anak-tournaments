import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import type { CustomFieldDefinition } from "@/types/registration.types";

/**
 * One stored custom-field answer, rendered for a table cell.
 *
 * Shared by the public participants roster and the admin registrations table:
 * the two render the same organizer-defined definitions off the same stored
 * JSON, and a second copy of this switch would drift the moment a field type
 * is added.
 *
 * `booleanLabels` is passed in rather than a translator: the public roster is
 * inside a next-intl provider and the admin table is not, and next-intl's
 * `Translator` type is keyed on the message catalogue so it cannot be widened
 * to a plain `(key: string) => string` here.
 */
export function renderCustomFieldValue(
  // Only the type is read, so the narrower shape lets a caller that holds just a
  // `{type, value}` pair (the live draft board) render without fabricating a
  // whole definition.
  field: Pick<CustomFieldDefinition, "type">,
  value: unknown,
  booleanLabels: { yes: string; no: string } = { yes: "Yes", no: "No" },
): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-[color:var(--aqt-fg-dim)]">&mdash;</span>;
  }

  switch (field.type) {
    case "checkbox": {
      // Answers are stored as the strings the form submits, so the literal
      // "false" has to read as No rather than as a truthy non-empty string.
      const on = value !== false && value !== "false";
      return (
        <span className="text-[color:var(--aqt-fg-muted)]">
          {on ? booleanLabels.yes : booleanLabels.no}
        </span>
      );
    }
    case "url":
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[color:var(--aqt-fg-muted)] underline decoration-[color:var(--aqt-border-3)] hover:text-[color:var(--aqt-fg)]"
        >
          <span className="max-w-[120px] truncate">{String(value)}</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </a>
      );
    case "select":
      return (
        <span className="inline-flex items-center rounded-md border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-3)] px-1.5 py-0.5 text-xs font-medium text-[color:var(--aqt-fg-muted)]">
          {String(value)}
        </span>
      );
    default:
      return <span className="text-[color:var(--aqt-fg-muted)]">{String(value)}</span>;
  }
}
