"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, ChevronsUpDown, Clock, Loader2, LogIn, UserPlus, XCircle } from "lucide-react";
import Link from "next/link";

import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import registrationService from "@/services/registration.service";
import userService from "@/services/user.service";
import type {
  CustomFieldDefinition,
  RegistrationCreateInput,
  RegistrationForm,
} from "@/types/registration.types";
import type { User } from "@/types/user.types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLES = [
  { code: "tank", display: "Tank", icon: "Tank" },
  { code: "dps", display: "DPS", icon: "Damage" },
  { code: "support", display: "Support", icon: "Support" },
] as const;

/** Fallback subrole definitions when form config doesn't specify */
const DEFAULT_SUBROLES: Record<string, string[]> = {
  dps: ["hitscan", "projectile"],
  support: ["main_heal", "light_heal"],
};

const SUBROLE_LABELS: Record<string, string> = {
  hitscan: "Hitscan",
  projectile: "Projectile",
  main_heal: "Main Heal",
  light_heal: "Light Heal",
  main_tank: "Main Tank",
  off_tank: "Off Tank",
  flanker: "Flanker",
  flex_dps: "Flex DPS",
  flex_support: "Flex Support",
};

function getSubroleOptions(role: string, form: RegistrationForm): { value: string; label: string }[] {
  const roleFieldCfg = form.built_in_fields?.primary_role ?? form.built_in_fields?.additional_roles;
  const configuredSubroles = roleFieldCfg?.subroles?.[role];
  const list = configuredSubroles ?? DEFAULT_SUBROLES[role] ?? [];
  return list.map((v) => ({ value: v, label: SUBROLE_LABELS[v] ?? v }));
}

// ---------------------------------------------------------------------------
// Account combobox (Popover + Command from shadcn/ui)
// ---------------------------------------------------------------------------

function AccountCombobox({
  label,
  placeholder,
  value,
  onChange,
  suggestions,
  icon,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  icon?: string;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleSelect = (selected: string) => {
    onChange(selected);
    setInputValue(selected);
    setOpen(false);
  };

  const handleInputChange = (v: string) => {
    setInputValue(v);
    onChange(v);
  };

  const hasSuggestions = suggestions.length > 0;
  const filtered = inputValue
    ? suggestions.filter((s) => s.toLowerCase().includes(inputValue.toLowerCase()))
    : suggestions;

  const iconEl = icon ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={icon} alt="" className="size-3.5 object-contain opacity-50" />
  ) : null;

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-medium text-white/60">
        {iconEl}
        {label}
      </label>
      {hasSuggestions ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              role="combobox"
              aria-expanded={open}
              className={cn(
                "flex h-9 w-full items-center justify-between rounded-lg border border-white/10 bg-white/3 px-3 text-sm transition-colors hover:border-white/15",
                value ? "text-white" : "text-white/30",
              )}
            >
              <span className="truncate">{value || placeholder}</span>
              <ChevronsUpDown className="ml-2 size-3.5 shrink-0 text-white/30" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="p-0"
            style={{ width: triggerRef.current?.offsetWidth ?? undefined }}
          >
            <Command>
              <CommandInput
                value={inputValue}
                onValueChange={handleInputChange}
                placeholder={placeholder}
              />
              <CommandList>
                <CommandEmpty>
                  {inputValue ? "Type to use custom value" : "No linked accounts"}
                </CommandEmpty>
                <CommandGroup heading="Linked accounts">
                  {filtered.map((s) => (
                    <CommandItem key={s} value={s} onSelect={() => handleSelect(s)}>
                      <span className="flex-1 truncate">{s}</span>
                      <Check className={cn("ml-2 size-4", value === s ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  ))}
                </CommandGroup>
                {inputValue && !suggestions.includes(inputValue) && (
                  <CommandGroup heading="Custom">
                    <CommandItem value={inputValue} onSelect={() => handleSelect(inputValue)}>
                      Use &quot;{inputValue}&quot;
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full rounded-lg border border-white/10 bg-white/3 px-3 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-white/20"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Smurf tags multi-input (with icon)
// ---------------------------------------------------------------------------

function SmurfTagsInput({
  tags,
  onChange,
  suggestions,
  icon,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  icon?: string;
}) {
  const [inputValue, setInputValue] = useState("");

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setInputValue("");
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(inputValue);
    }
    if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const unusedSuggestions = suggestions.filter((s) => !tags.includes(s));

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-medium text-white/60">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {icon && <img src={icon} alt="" className="size-3.5 object-contain opacity-50" />}
        Smurf Accounts
      </label>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/70"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(i)}
                className="ml-0.5 text-white/30 hover:text-white/60"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Add smurf BattleTag and press Enter"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-9 flex-1 rounded-lg border border-white/10 bg-white/3 px-3 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-white/20"
        />
      </div>
      {unusedSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unusedSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              className="rounded border border-white/7 bg-white/2 px-2 py-0.5 text-[11px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role selector with icons + subroles
// ---------------------------------------------------------------------------

function RoleSelector({
  selected,
  subrole,
  onSelect,
  onSubroleChange,
  form,
}: {
  selected: string;
  subrole: string;
  onSelect: (role: string) => void;
  onSubroleChange: (subrole: string) => void;
  form: RegistrationForm;
}) {
  const subOptions = selected ? getSubroleOptions(selected, form) : [];

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-white/60">Primary Role</label>
      <div className="flex gap-2">
        {ROLES.map((r) => {
          const active = selected === r.code;
          return (
            <button
              key={r.code}
              type="button"
              onClick={() => onSelect(active ? "" : r.code)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all",
                active
                  ? "border-white/20 bg-white/10 text-white shadow-sm"
                  : "border-white/7 bg-white/2 text-white/45 hover:bg-white/5 hover:text-white/70",
              )}
            >
              <PlayerRoleIcon role={r.icon} size={18} />
              <span className="hidden sm:inline">{r.display}</span>
            </button>
          );
        })}
      </div>
      {subOptions.length > 0 && (
        <div className="flex gap-2">
          {subOptions.map((sub) => {
            const active = subrole === sub.value;
            return (
              <button
                key={sub.value}
                type="button"
                onClick={() => onSubroleChange(active ? "" : sub.value)}
                className={cn(
                  "flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-white/15 bg-white/8 text-white"
                    : "border-white/7 bg-white/2 text-white/40 hover:bg-white/4",
                )}
              >
                {sub.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Additional roles selector (with subroles per role)
// ---------------------------------------------------------------------------

type AdditionalRole = { code: string; subrole: string };

function AdditionalRolesSelector({
  primaryRole,
  selected,
  onChange,
  form,
}: {
  primaryRole: string;
  selected: AdditionalRole[];
  onChange: (roles: AdditionalRole[]) => void;
  form: RegistrationForm;
}) {
  const available = ROLES.filter((r) => r.code !== primaryRole);
  if (available.length === 0) return null;

  const toggle = (code: string) => {
    const exists = selected.find((r) => r.code === code);
    onChange(
      exists
        ? selected.filter((r) => r.code !== code)
        : [...selected, { code, subrole: "" }],
    );
  };

  const setSubrole = (code: string, subrole: string) => {
    onChange(
      selected.map((r) =>
        r.code === code ? { ...r, subrole: r.subrole === subrole ? "" : subrole } : r,
      ),
    );
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-white/60">Additional Roles</label>
      <div className="flex gap-2">
        {available.map((r) => {
          const active = selected.some((s) => s.code === r.code);
          return (
            <button
              key={r.code}
              type="button"
              onClick={() => toggle(r.code)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                active
                  ? "border-white/15 bg-white/8 text-white"
                  : "border-white/7 bg-white/2 text-white/40 hover:bg-white/4",
              )}
            >
              <PlayerRoleIcon role={r.icon} size={16} />
              <span className="hidden sm:inline">{r.display}</span>
            </button>
          );
        })}
      </div>
      {/* Subroles for each selected additional role */}
      {selected.map((entry) => {
        const subOptions = getSubroleOptions(entry.code, form);
        if (subOptions.length === 0) return null;
        const roleDef = ROLES.find((r) => r.code === entry.code);
        return (
          <div key={entry.code} className="flex gap-2">
            <span className="flex h-7 items-center text-[11px] text-white/30 shrink-0 w-16">
              {roleDef?.display}:
            </span>
            {subOptions.map((sub) => {
              const active = entry.subrole === sub.value;
              return (
                <button
                  key={sub.value}
                  type="button"
                  onClick={() => setSubrole(entry.code, sub.value)}
                  className={cn(
                    "flex-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-white/15 bg-white/8 text-white"
                      : "border-white/7 bg-white/2 text-white/40 hover:bg-white/4",
                  )}
                >
                  {sub.label}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registration modal
// ---------------------------------------------------------------------------

function RegistrationModal({
  workspaceId,
  tournamentId,
  tournamentName,
  form,
  onClose,
}: {
  workspaceId: number;
  tournamentId: number;
  tournamentName?: string;
  form: RegistrationForm;
  onClose: () => void;
}) {
  const { user: authUser } = useAuthProfile();
  const queryClient = useQueryClient();

  const [values, setValues] = useState<Record<string, string>>({});
  const [smurfTags, setSmurfTags] = useState<string[]>([]);
  const [primaryRole, setPrimaryRole] = useState("");
  const [subrole, setSubrole] = useState("");
  const [additionalRoles, setAdditionalRoles] = useState<AdditionalRole[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Fetch user's linked accounts for autocomplete suggestions
  const userQuery = useQuery({
    queryKey: ["user-profile-full", authUser?.username],
    queryFn: () => userService.getUserByName(authUser!.username),
    enabled: !!authUser?.username,
    staleTime: 60_000,
  });

  const linkedUser: User | undefined = userQuery.data;
  const battleTagSuggestions = linkedUser?.battle_tag?.map((bt) => bt.battle_tag) ?? [];
  const discordSuggestions = linkedUser?.discord?.map((d) => d.name) ?? [];
  const twitchSuggestions = linkedUser?.twitch?.map((t) => t.name) ?? [];

  // Auto-fill first linked account
  useEffect(() => {
    if (!linkedUser) return;
    setValues((prev) => {
      const next = { ...prev };
      if (!next.battle_tag && battleTagSuggestions.length > 0) next.battle_tag = battleTagSuggestions[0];
      if (!next.discord_nick && discordSuggestions.length > 0) next.discord_nick = discordSuggestions[0];
      if (!next.twitch_nick && twitchSuggestions.length > 0) next.twitch_nick = twitchSuggestions[0];
      return next;
    });
  }, [linkedUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: () => {
      const rolesPayload: { role: string; subrole?: string; is_primary: boolean }[] = [];
      if (primaryRole) {
        rolesPayload.push({ role: primaryRole, ...(subrole ? { subrole } : {}), is_primary: true });
      }
      for (const ar of additionalRoles) {
        rolesPayload.push({ role: ar.code, ...(ar.subrole ? { subrole: ar.subrole } : {}), is_primary: false });
      }
      const input: RegistrationCreateInput = {
        battle_tag: values.battle_tag || undefined,
        smurf_tags: smurfTags.length > 0 ? smurfTags : undefined,
        discord_nick: values.discord_nick || undefined,
        twitch_nick: values.twitch_nick || undefined,
        roles: rolesPayload.length > 0 ? rolesPayload : undefined,
        stream_pov: values.stream_pov === "true",
        notes: values.notes || undefined,
        custom_fields: Object.fromEntries(
          form.custom_fields
            .map((f) => [f.key, values[f.key] ?? ""])
            .filter(([, v]) => v !== ""),
        ),
      };
      return registrationService.register(workspaceId, tournamentId, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["registration", workspaceId, tournamentId] });
      await queryClient.invalidateQueries({ queryKey: ["registrations-list", workspaceId, tournamentId] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const update = (key: string, value: string) => setValues((p) => ({ ...p, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/10 bg-[#0f1117] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">
          Register{tournamentName ? ` for ${tournamentName}` : ""}
        </h2>
        <p className="mt-1 text-sm text-white/50">Fill out the form below to register.</p>

        <div className="mt-5 grid gap-4">
          {/* Accounts with autocomplete */}
          <AccountCombobox
            label="BattleTag"
            placeholder="Player#1234"
            value={values.battle_tag ?? ""}
            onChange={(v) => update("battle_tag", v)}
            suggestions={battleTagSuggestions}
            icon="/battlenet.svg"
          />
          {/* Smurf accounts */}
          <SmurfTagsInput
            tags={smurfTags}
            onChange={setSmurfTags}
            suggestions={battleTagSuggestions.filter((t) => t !== values.battle_tag)}
            icon="/battlenet.svg"
          />
          <AccountCombobox
            label="Discord"
            placeholder="username"
            value={values.discord_nick ?? ""}
            onChange={(v) => update("discord_nick", v)}
            suggestions={discordSuggestions}
            icon="/discord-white.svg"
          />
          <AccountCombobox
            label="Twitch"
            placeholder="channel_name"
            value={values.twitch_nick ?? ""}
            onChange={(v) => update("twitch_nick", v)}
            suggestions={twitchSuggestions}
            icon="/twitch.png"
          />

          {/* Primary role + subrole */}
          <RoleSelector
            selected={primaryRole}
            subrole={subrole}
            onSelect={(r) => {
              setPrimaryRole(r);
              setSubrole("");
              setAdditionalRoles((prev) => prev.filter((ar) => ar.code !== r));
            }}
            onSubroleChange={setSubrole}
            form={form}
          />

          {/* Additional roles */}
          <AdditionalRolesSelector
            primaryRole={primaryRole}
            selected={additionalRoles}
            onChange={setAdditionalRoles}
            form={form}
          />

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-white/60">Notes</label>
            <textarea
              placeholder="Anything you'd like organizers to know"
              value={values.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-white/10 bg-white/3 px-3 py-2 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-white/20"
            />
          </div>

          {/* Custom fields */}
          {form.custom_fields.map((field) => (
            <CustomField
              key={field.key}
              definition={field}
              value={values[field.key] ?? ""}
              onChange={(v) => update(field.key, v)}
            />
          ))}
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/4"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom field renderer
// ---------------------------------------------------------------------------

function CustomField({
  definition,
  value,
  onChange,
}: {
  definition: CustomFieldDefinition;
  value: string;
  onChange: (v: string) => void;
}) {
  const label = `${definition.label}${definition.required ? " *" : ""}`;

  if (definition.type === "select" && definition.options) {
    return (
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-white/60">{label}</label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full rounded-lg border border-white/10 bg-white/3 px-3 text-sm text-white outline-none"
        >
          <option value="">Select...</option>
          {definition.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  if (definition.type === "checkbox") {
    return (
      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "")}
          className="size-4 rounded border-white/20"
        />
        <span className="text-sm text-white/70">{definition.label}</span>
      </label>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-white/60">{label}</label>
      <input
        type="text"
        placeholder={definition.placeholder ?? ""}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-white/10 bg-white/3 px-3 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-white/20"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button (exported)
// ---------------------------------------------------------------------------

type Props = {
  workspaceId: number;
  tournamentId: number;
  tournamentName?: string;
};

export default function TournamentRegisterButton({ workspaceId, tournamentId, tournamentName }: Props) {
  const { user, status: authStatus } = useAuthProfile();
  const isAuthenticated = authStatus === "authenticated" && user !== null;
  const [showModal, setShowModal] = useState(false);

  const formQuery = useQuery({
    queryKey: ["registration-form", workspaceId, tournamentId],
    queryFn: () => registrationService.getForm(workspaceId, tournamentId),
  });

  const myRegQuery = useQuery({
    queryKey: ["registration", workspaceId, tournamentId],
    queryFn: () => registrationService.getMyRegistration(workspaceId, tournamentId),
    enabled: isAuthenticated,
  });

  const form = formQuery.data;
  const myReg = myRegQuery.data;

  if (formQuery.isLoading) return null;
  if (!form) return null;

  if (!form.is_open) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-white/7 bg-white/2 px-4 py-2 text-sm text-white/40">
        <Clock className="size-4" />
        Registration closed
      </div>
    );
  }

  if (myReg && myReg.status !== "withdrawn") {
    const statusMap: Record<string, { icon: typeof Clock; label: string; className: string }> = {
      pending: { icon: Clock, label: "Pending", className: "border-amber-500/20 bg-amber-500/10 text-amber-400" },
      approved: { icon: CheckCircle2, label: "Registered", className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" },
      rejected: { icon: XCircle, label: "Rejected", className: "border-red-500/20 bg-red-500/10 text-red-400" },
    };
    const config = statusMap[myReg.status] ?? statusMap.pending;
    const StatusIcon = config.icon;
    return (
      <Link
        href={`/tournaments/${tournamentId}/participants`}
        className={cn("inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80", config.className)}
      >
        <StatusIcon className="size-4" />
        {config.label}
      </Link>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/3 px-4 py-2 text-sm text-white/50">
        <LogIn className="size-4" />
        Sign in to register
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
      >
        <UserPlus className="size-4" />
        Register
      </button>
      {showModal && form && (
        <RegistrationModal
          workspaceId={workspaceId}
          tournamentId={tournamentId}
          tournamentName={tournamentName}
          form={form}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
