import { ApiError } from "@/lib/api/error";
import type { TournamentLink, TournamentLinkKind } from "@/types/stream.types";

/** Mirrors `TOURNAMENT_LINK_KINDS` in `backend/shared/models/tournament/link.py`. */
export const LINK_KINDS: ReadonlyArray<{ value: TournamentLinkKind }> = [
  { value: "discord" },
  { value: "stream" },
  { value: "vod" },
  { value: "bracket" },
  { value: "rules" },
  { value: "other" }
];

export interface LinkForm {
  kind: TournamentLinkKind;
  label: string;
  url: string;
  sort_order: number;
}

// Key order matters: `hasUnsavedChanges` compares JSON, so `getLinkForm` below
// must list the same fields in the same order or every edit dialog opens dirty.
export const EMPTY_LINK_FORM: LinkForm = { kind: "discord", label: "", url: "", sort_order: 0 };

export function getLinkForm(link: TournamentLink | null): LinkForm {
  if (!link) {
    return { ...EMPTY_LINK_FORM };
  }
  return {
    kind: link.kind,
    label: link.label ?? "",
    url: link.url,
    sort_order: link.sort_order
  };
}

const LINK_FORM_FIELDS = ["kind", "label", "url", "sort_order"] as const;

/**
 * The two rejections this form actually produces are 409 (a link of the same
 * kind and URL already exists on the tournament) and 422 (bad `url`/`kind`).
 * A single "request failed" hides which field to fix, so name them.
 *
 * `parseApiError` already folds pydantic's `loc` into the message as
 * `"url: Input should be a valid URL"` (see `normalizeDetailItem`), so the
 * field name is the prefix. Anything unrecognised is still surfaced verbatim
 * under a synthetic key — `EntityFormDialog` lists every entry.
 */
export function linkFieldErrors(error: unknown, duplicateMessage: string): Record<string, string> {
  if (!(error instanceof ApiError)) {
    return {};
  }

  if (error.status === 409) {
    return {
      url: duplicateMessage
    };
  }

  if (error.status !== 422) {
    return {};
  }

  const fields: Record<string, string> = {};
  error.details.forEach((detail, index) => {
    const [, prefix, message] = /^([a-z_]+)(?:\.[^:]*)?:\s*(.+)$/i.exec(detail.msg) ?? [];
    const known = LINK_FORM_FIELDS.find((field) => field === prefix);
    if (known && message) {
      fields[known] = message;
    } else {
      fields[`detail-${index}`] = detail.msg;
    }
  });
  return fields;
}
