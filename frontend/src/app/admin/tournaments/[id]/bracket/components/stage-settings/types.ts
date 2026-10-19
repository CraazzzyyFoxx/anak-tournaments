import type { Stage } from "@/types/tournament.types";

import type { StageForm } from "../../stageForm";

/**
 * One editor section per `?section=` (`General`, `Seeding`, `Tiebreakers`,
 * `BestOf`). These are the field groups that used to live inside
 * `StageManager`'s single `Advanced` `Collapsible` — three levels deep, all
 * mounted at once and saved by one "Save override" button. Promoted to
 * sections they are the same forms with the same payload; only the disclosure
 * is gone.
 */
export type SectionProps = Readonly<{
  stage: Stage;
  form: StageForm;
  onChange: (patch: Partial<StageForm>) => void;
}>;
