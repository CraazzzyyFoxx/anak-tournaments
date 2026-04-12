export const ROLES = [
  { code: "tank", display: "Tank", icon: "Tank" },
  { code: "dps", display: "DPS", icon: "Damage" },
  { code: "support", display: "Support", icon: "Support" },
] as const;

export const DEFAULT_SUBROLES: Record<string, string[]> = {
  dps: ["hitscan", "projectile"],
  support: ["main_heal", "light_heal"],
};

export const SUBROLE_LABELS: Record<string, string> = {
  hitscan: "Hitscan",
  projectile: "Projectile",
  main_heal: "Main Heal",
  light_heal: "Light Heal",
  main_tank: "Main Tank",
  off_tank: "Off Tank",
  main_dps: "Main DPS",
  flex_dps: "Flex DPS",
  flex_support: "Flex Support",
};
