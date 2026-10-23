import type { AuthMergePolicy } from "@/types/admin.types";

// The preview normalizes the submitted auth policy. If it came back different,
// the preview describes choices the admin never made, so it must not be shown.
export function authPolicyDiverged(submitted: AuthMergePolicy, normalized: AuthMergePolicy | undefined): boolean {
  return (
    !normalized ||
    normalized.surviving_auth_user_id !== submitted.surviving_auth_user_id ||
    normalized.other_account_action !== submitted.other_account_action ||
    submitted.oauth_destinations.some((destination) =>
      normalized.oauth_destinations.find((item) => item.connection_id === destination.connection_id)?.auth_user_id !== destination.auth_user_id
    ) ||
    Object.entries(submitted.conflict_choices).some(([key, value]) =>
      normalized.conflict_choices[key] !== value
    ) ||
    (submitted.membership_actions ?? []).length !== (normalized.membership_actions ?? []).length ||
    (submitted.membership_actions ?? []).some((action) =>
      normalized.membership_actions?.find((item) => item.workspace_id === action.workspace_id)?.action !== action.action
    )
  );
}
