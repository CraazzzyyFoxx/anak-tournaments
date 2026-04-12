export type AdditionalRole = {
  code: string;
  subrole: string;
};

export interface WizardState {
  step: number;
  values: Record<string, string>;
  smurfTags: string[];
  isFlex: boolean;
  primaryRole: string;
  subrole: string;
  additionalRoles: AdditionalRole[];
}

export type WizardAction =
  | { type: "SET_STEP"; step: number }
  | { type: "SET_VALUE"; key: string; value: string }
  | { type: "SET_SMURF_TAGS"; tags: string[] }
  | { type: "SET_FLEX"; isFlex: boolean }
  | { type: "SET_PRIMARY_ROLE"; role: string }
  | { type: "SET_SUBROLE"; subrole: string }
  | { type: "SET_ADDITIONAL_ROLES"; roles: AdditionalRole[] }
  | { type: "INIT_VALUES"; values: Record<string, string> };
