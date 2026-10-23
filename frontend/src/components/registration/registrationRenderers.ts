import type { RendererRegistry } from "@/components/forms/types";
import { IDENTITY_PROVIDERS, identityKey } from "@/lib/forms/builtin-keys";

import IdentityField from "./fields/IdentityField";
import NotesField from "./fields/NotesField";
import RoleRanksField from "./fields/RoleRanksField";
import RolesField from "./fields/RolesField";

/**
 * Which component answers which builtin key.
 *
 * Every entry here is a key the SERVER owns the behaviour of — the verified
 * accounts, the handle grammars, the role composition — so the registry is a
 * fixed table, not something a form can extend. A key with no entry falls
 * through to `GenericField`, which is the right answer for every custom
 * question, for the boolean builtins (`stream_pov`, `reserve` — its checkbox
 * case carries their fallback copy) and a survivable one for a builtin a newer
 * server has added.
 */
export const registrationRenderers: RendererRegistry = {
  roles: RolesField,
  public_notes: NotesField,
  organizer_notes: NotesField,
  // Keyed by KIND, not by a builtin key: `role_ranks` is a custom question an
  // organizer adds — any number of times — and only its rendering is fixed.
  role_ranks: RoleRanksField,
  ...Object.fromEntries(
    IDENTITY_PROVIDERS.map((provider) => [identityKey(provider), IdentityField] as const),
  ),
};
