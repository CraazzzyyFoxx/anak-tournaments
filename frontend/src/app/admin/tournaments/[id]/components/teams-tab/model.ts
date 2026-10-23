import type { ChallongeTeamPreviewParticipant } from "@/types/admin.types";

export const UNMAPPED_TEAM_VALUE = "unmapped";

export function getChallongeParticipantKey(participant: ChallongeTeamPreviewParticipant) {
  return `${participant.participant_id}:${participant.group_id ?? "none"}`;
}
