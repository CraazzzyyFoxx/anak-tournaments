"use client";

import { Fragment, useId, useMemo, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Check, Sparkles, Trash2, UserPlus, X } from "lucide-react";

import {
  AdminDetailTableShell,
  getAdminDetailTableStyles
} from "@/components/admin/AdminDetailTable";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { UserSearchCombobox } from "@/components/admin/UserSearchCombobox";
import DivisionIcon from "@/components/DivisionIcon";
import RosterSlotGlyph from "@/components/registration/RosterSlotGlyph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageStateCard } from "@/components/ui/page-state-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { useSlotLabel } from "@/hooks/useSlotLabel";
import { ratedDimension, roleChoices, subRoleOptions, type RoleOntology } from "@/lib/roster/ontology";
import { roleOf, subRoleOf, toRoleRef } from "@/lib/roster/role-ref";
import { OPEN_SLOT_CODE } from "@/lib/roster/shape";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import type { PlayerCreateInput, PlayerUpdateInput } from "@/types/admin.types";
import type { Player } from "@/types/team.types";
import type { DivisionGridVersion } from "@/types/workspace.types";
import { formatSubRoleLabel, sortTeamPlayers } from "@/lib/player";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";

interface TeamRosterEditorProps {
  teamId: number;
  tournamentId: number;
  workspaceId: number | null;
  discipline: string | null;
  players: Player[];
  /** Grid the tournament scores ranks against; falls back to the workspace grid. */
  divisionGrid: DivisionGridVersion | null;
  canCreatePlayer: boolean;
  canUpdatePlayer: boolean;
  canDeletePlayer: boolean;
}

/** A roster row being composed. `parentId` set means it replaces that player. */
interface RosterDraft {
  parentId: number | null;
  userId: number;
  userName: string;
  name: string;
  role: string;
  rank: number;
  subRole: string;
}

const NO_SUB_ROLE = "none";

function emptyDraft(parentId: number | null, role: string = OPEN_SLOT_CODE): RosterDraft {
  return { parentId, userId: 0, userName: "", name: "", role, rank: 0, subRole: "" };
}

/**
 * Roster order (role, then rank, substitutes under the slot they cover) plus the
 * nesting depth each row renders at. Walks `related_player_id` upwards with a
 * seen-set so a corrupt cycle degrades to depth 0 instead of hanging.
 */
function buildRosterRows(players: Player[]): Array<{ player: Player; depth: number }> {
  const byId = new Map(players.map((player) => [player.id, player]));

  const depthOf = (player: Player) => {
    const seen = new Set<number>([player.id]);
    let current = player;
    let depth = 0;

    while (current.is_substitution && current.related_player_id != null) {
      const parent = byId.get(current.related_player_id);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      depth += 1;
      current = parent;
    }

    return depth;
  };

  return sortTeamPlayers(players).map((player) => ({ player, depth: depthOf(player) }));
}

/**
 * Text/number field that keeps a local draft and persists on blur or Enter.
 * Escape restores the saved value. Used instead of the pencil-reveal
 * `InlineEditText` because this whole table is an editor: one click on the
 * value, type, tab away.
 */
function CommitField({
  value,
  onCommit,
  label,
  disabled,
  className,
  inputMode
}: Readonly<{
  value: string;
  onCommit: (next: string) => void;
  /** Accessible name, e.g. `Rank of Nickname`. */
  label: string;
  disabled?: boolean;
  className?: string;
  inputMode?: "numeric";
}>) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next !== value) {
      onCommit(next);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
    }
  };

  return (
    <Input
      aria-label={label}
      value={draft ?? value}
      disabled={disabled}
      inputMode={inputMode}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      className={cn(
        // Quiet but present: a field the operator can see is a field, without
        // 40 hard-bordered boxes fighting each other down the table.
        "h-8 border-border/50 bg-background/40 px-2 hover:border-input",
        className
      )}
    />
  );
}

/**
 * Role picker whose trigger is the same glyph the rest of the site shows.
 *
 * The accessible name carries the field *and* the current value, because an
 * `aria-label` on a Radix trigger overrides the value it renders — an icon-only
 * trigger labelled just "Role of X" would never announce which role is set.
 */
function RoleSelect({
  value,
  onChange,
  label,
  disabled,
  ontology
}: Readonly<{
  /** A role code of the owner game's rated dimension, or `OPEN_SLOT_CODE` for none assigned. */
  value: string;
  onChange: (role: string) => void;
  /** Field name, e.g. `Role of Nickname`. */
  label: string;
  disabled?: boolean;
  ontology: RoleOntology | null;
}>) {
  const slotLabel = useSlotLabel(ontology);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || !ontology}>
      <SelectTrigger aria-label={[label, slotLabel(value)].join(": ")} className="h-8 w-[4.5rem] gap-1 px-2">
        <SelectValue>
          <RosterSlotGlyph code={value} ontology={ontology} size={18} decorative />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {roleChoices(ontology, value).map((code) => (
          <SelectItem key={code} value={code}>
            <span className="flex items-center gap-2">
              <RosterSlotGlyph code={code} ontology={ontology} size={16} decorative />
              {slotLabel(code)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SubRoleSelect({
  value,
  options,
  onChange,
  label,
  disabled,
  describedBy
}: Readonly<{
  value: string;
  options: Array<{ slug: string; label: string }>;
  onChange: (subRole: string) => void;
  /** Field name, e.g. `Sub-role of Nickname`. */
  label: string;
  disabled?: boolean;
  describedBy?: string;
}>) {
  const t = useTranslations("adminPeople.roster");
  // A saved sub-role missing from the catalog (renamed, deactivated) still needs
  // an option, or Radix renders the trigger empty.
  const items =
    !value || options.some((option) => option.slug === value)
      ? options
      : [...options, { slug: value, label: formatSubRoleLabel(value) ?? value }];
  const selectedLabel = items.find((option) => option.slug === value)?.label ?? t("noSubRole");

  return (
    <Select
      value={value || NO_SUB_ROLE}
      onValueChange={(next) => onChange(next === NO_SUB_ROLE ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger aria-label={[label, selectedLabel].join(": ")} aria-describedby={describedBy} className="h-8 w-[9.5rem] px-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_SUB_ROLE}>{t("noSubRole")}</SelectItem>
        {items.map((option) => (
          <SelectItem key={option.slug} value={option.slug}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FlagToggle({
  active,
  label,
  icon: Icon,
  onToggle,
  disabled
}: Readonly<{
  active: boolean;
  label: string;
  icon: typeof Sparkles;
  onToggle: () => void;
  disabled?: boolean;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-7", active ? "text-warning" : "text-muted-foreground/70")}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onToggle}
        >
          <Icon aria-hidden className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The roster, editable in place.
 *
 * Every control persists on its own: role, rank, sub-role and the newcomer flags
 * PATCH the player as soon as they change, so there is no draft to lose and no
 * dialog to open. Structural moves stay explicit — a substitute is added through
 * "Replace", and removing a player is confirmed.
 */
export function TeamRosterEditor({
  teamId,
  tournamentId,
  workspaceId,
  discipline,
  players,
  divisionGrid,
  canCreatePlayer,
  canUpdatePlayer,
  canDeletePlayer
}: Readonly<TeamRosterEditorProps>) {
  const t = useTranslations("adminPeople.roster");
  const roleT = useTranslations("common.roleOntology");
  const subRoleErrorId = useId();
  const queryClient = useQueryClient();
  const tableStyles = getAdminDetailTableStyles("compact");
  const [draft, setDraft] = useState<RosterDraft | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Player | null>(null);

  // The roles on offer are the roster's own game's: this team's tournament, never a fixed or browsing vocabulary.
  const ownerMetadata = useDisciplineMetadata(workspaceId ?? "all", workspaceId != null ? discipline : null);
  const ontology = ownerMetadata.data ?? null;
  const ratedCode = ontology ? ratedDimension(ontology)?.code : undefined;
  const metadataFailed = ownerMetadata.isError || (ontology !== null && !ratedCode);

  const subRolesQuery = useQuery({
    queryKey: adminQueryKeys.playerSubRoles(workspaceId, discipline),
    queryFn: ({ signal }) => adminService.getPlayerSubRoles({ workspace_id: workspaceId!, discipline: discipline! }, signal),
    enabled: workspaceId != null && Boolean(discipline)
  });
  const playerSubRoles = subRolesQuery.data;

  const rows = useMemo(() => buildRosterRows(players), [players]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.team(teamId) }),
      queryClient.invalidateQueries({ queryKey: tournamentQueryKeys.teamsAll() }),
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.tournament(tournamentId) })
    ]);

  const patchPlayer = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: PlayerUpdateInput }) =>
      adminService.updatePlayer(id, payload),
    onSuccess: refresh
  });

  const addPlayer = useMutation({
    mutationFn: (payload: PlayerCreateInput) => adminService.createPlayer(payload),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    }
  });

  const removePlayer = useMutation({
    mutationFn: (id: number) => adminService.deletePlayer(id),
    onSuccess: async () => {
      setDraft(null);
      setPendingRemoval(null);
      await refresh();
    }
  });

  const savingPlayerId = patchPlayer.isPending ? patchPlayer.variables?.id : undefined;

  const patch = (player: Player, payload: PlayerUpdateInput) =>
    patchPlayer.mutate({ id: player.id, payload });

  /** The game's own role as a reference (`{dimension, role[, sub-role leaf]}`); the open slot is no role at all. */
  const roleRef = (role: string, subRole: string | null) =>
    toRoleRef(role === OPEN_SLOT_CODE ? null : role, subRole, ratedCode ?? "");

  /** The open slot has no rows in the sub-role catalog, so its sub-role select renders inert rather than empty. */
  const subRoleOptionsFor = (role: string) => subRoleOptions(playerSubRoles, ratedCode, role);

  const substituteCount = players.filter((player) => player.is_substitution).length;
  const draftIsValid = draft != null && draft.userId > 0 && draft.name.trim().length > 0;

  const submitDraft = () => {
    if (!draft || !draftIsValid) return;
    addPlayer.mutate({
      name: draft.name.trim(),
      user_id: draft.userId,
      team_id: teamId,
      tournament_id: tournamentId,
      role: roleRef(draft.role, draft.subRole),
      rank: draft.rank,
      is_substitution: draft.parentId != null,
      related_player_id: draft.parentId
    });
  };

  const renderDraftRow = (depth: number) =>
    draft ? (
    <TableRow key="roster-draft" className={cn(tableStyles.row, "bg-muted/20")}>
      <TableCell className={tableStyles.cell}>
        <div
          className="flex flex-col gap-1.5"
          style={depth > 0 ? { paddingLeft: `${depth * 1.25}rem` } : undefined}
        >
          <UserSearchCombobox
            value={draft.userId || undefined}
            selectedName={draft.userName || undefined}
            placeholder={t("linkUser")}
            onSelect={(user) =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      userId: user?.id ?? 0,
                      userName: user?.name ?? "",
                      name: current.name || user?.name || ""
                    }
                  : current
              )
            }
          />
          <Input
            aria-label={t("newPlayer")}
            value={draft.name}
            placeholder={t("rosterName")}
            className="h-8"
            onChange={(event) =>
              setDraft((current) => (current ? { ...current, name: event.target.value } : current))
            }
          />
        </div>
      </TableCell>
      <TableCell className={tableStyles.cell}>
        <RoleSelect
          value={draft.role}
          label={t("roleOf")}
          disabled={!ratedCode}
          ontology={ontology}
          onChange={(role) =>
            setDraft((current) => (current ? { ...current, role, subRole: "" } : current))
          }
        />
      </TableCell>
      <TableCell className={tableStyles.numericCell}>
        <Input
          aria-label={t("rankOf")}
          value={String(draft.rank)}
          inputMode="numeric"
          className="h-8 w-20 tabular-nums"
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            setDraft((current) =>
              current ? { ...current, rank: Number.isFinite(next) && next > 0 ? next : 0 } : current
            );
          }}
        />
      </TableCell>
      <TableCell className={tableStyles.cell}>
        <SubRoleSelect
          value={draft.subRole}
          options={subRoleOptionsFor(draft.role)}
          disabled={subRolesQuery.isError || draft.role === OPEN_SLOT_CODE}
          describedBy={subRolesQuery.isError ? subRoleErrorId : undefined}
          label={t("subRoleOf")}
          onChange={(subRole) =>
            setDraft((current) => (current ? { ...current, subRole } : current))
          }
        />
      </TableCell>
      <TableCell className={tableStyles.cell}>
        {draft.parentId != null ? <Badge variant="secondary">{t("substitute")}</Badge> : null}
      </TableCell>
      <TableCell className={tableStyles.cell}>
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            size="sm"
            disabled={!draftIsValid || addPlayer.isPending}
            onClick={submitDraft}
          >
            <Check aria-hidden className="mr-1.5 size-4" />
            {addPlayer.isPending ? t("adding") : t("add")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("cancel")}
            onClick={() => setDraft(null)}
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  ) : null;

  if (!discipline || workspaceId === null) {
    return <PageStateCard state="error" title={roleT("ownerScopeError")} />;
  }
  return (
    <div className="space-y-3">
      {subRolesQuery.isError && <p id={subRoleErrorId} role="status" className="text-sm text-muted-foreground">{roleT("roleLoadError")}</p>}
      {metadataFailed && <p role="status" className="text-sm text-muted-foreground">{roleT("metadataError")}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm tabular-nums text-muted-foreground">
          {players.length
            ? t("rosterCount", { starters: players.length - substituteCount, substitutes: substituteCount })
            : t("empty")}
        </p>
        {canCreatePlayer ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={draft != null}
            onClick={() => setDraft(emptyDraft(null))}
          >
            <UserPlus aria-hidden className="mr-2 size-4" />
            {t("add")}
          </Button>
        ) : null}
      </div>

      <AdminDetailTableShell>
        <Table>
          <TableHeader>
            <TableRow className={tableStyles.headerRow}>
              <TableHead className={tableStyles.head}>{t("player")}</TableHead>
              <TableHead className={tableStyles.head}>{t("role")}</TableHead>
              <TableHead className={tableStyles.head}>{t("rank")}</TableHead>
              <TableHead className={tableStyles.head}>{t("subRole")}</TableHead>
              <TableHead className={tableStyles.head}>{t("flags")}</TableHead>
              <TableHead className={cn(tableStyles.head, "text-right")}>{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ player, depth }) => {
              const role = roleOf(player.role) ?? OPEN_SLOT_CODE;
              const saving = savingPlayerId === player.id;

              return (
                <Fragment key={player.id}>
                <TableRow
                  className={cn(tableStyles.row, saving && "opacity-60")}
                  aria-busy={saving || undefined}
                >
                  <TableCell className={tableStyles.cell}>
                    <div
                      className="min-w-0"
                      style={depth > 0 ? { paddingLeft: `${depth * 1.25}rem` } : undefined}
                    >
                      <CommitField
                        value={player.name}
                        label={t("rosterNameOf", { name: player.name })}
                        disabled={!canUpdatePlayer}
                        className="font-medium"
                        onCommit={(name) => {
                          if (name) {
                            patch(player, { name });
                          }
                        }}
                      />
                      <p className="truncate px-2 text-xs text-muted-foreground">
                        {player.user?.name ?? `User #${player.user_id}`}
                      </p>
                    </div>
                  </TableCell>

                  <TableCell className={tableStyles.cell}>
                    <RoleSelect
                      value={role}
                      label={t("roleOfPlayer", { name: player.name })}
                      disabled={!canUpdatePlayer || !ratedCode}
                      ontology={ontology}
                      onChange={(next) => patch(player, { role: roleRef(next, null) })}
                    />
                  </TableCell>

                  <TableCell className={tableStyles.numericCell}>
                    <div className="flex items-center gap-2">
                      <DivisionIcon
                        division={player.division}
                        tournamentGrid={divisionGrid}
                        width={24}
                        height={24}
                      />
                      <CommitField
                        value={String(player.rank)}
                        label={t("rankOfPlayer", { name: player.name })}
                        disabled={!canUpdatePlayer}
                        inputMode="numeric"
                        className="w-20 tabular-nums"
                        onCommit={(next) => {
                          const rank = Number.parseInt(next, 10);
                          if (Number.isFinite(rank) && rank >= 0) {
                            patch(player, { rank });
                          }
                        }}
                      />
                    </div>
                  </TableCell>

                  <TableCell className={tableStyles.cell}>
                    <SubRoleSelect
                      value={subRoleOf(player.role) ?? ""}
                      options={subRoleOptionsFor(role)}
                      label={t("subRoleOfPlayer", { name: player.name })}
                      disabled={subRolesQuery.isError || !canUpdatePlayer || role === OPEN_SLOT_CODE}
                      describedBy={subRolesQuery.isError ? subRoleErrorId : undefined}
                      onChange={(subRole) => patch(player, { role: roleRef(role, subRole) })}
                    />
                  </TableCell>

                  <TableCell className={tableStyles.cell}>
                    <div className="flex items-center gap-0.5">
                      <FlagToggle
                        active={player.is_newcomer}
                        icon={Sparkles}
                        label={t("newcomer", { name: player.name })}
                        disabled={!canUpdatePlayer}
                        onToggle={() => patch(player, { is_newcomer: !player.is_newcomer })}
                      />
                      <FlagToggle
                        active={player.is_newcomer_role}
                        icon={ArrowLeftRight}
                        label={t("newRole", { name: player.name })}
                        disabled={!canUpdatePlayer}
                        onToggle={() =>
                          patch(player, { is_newcomer_role: !player.is_newcomer_role })
                        }
                      />
                      {player.is_substitution ? <Badge variant="secondary">{t("sub")}</Badge> : null}
                    </div>
                  </TableCell>

                  <TableCell className={tableStyles.cell}>
                    <div className="flex items-center justify-end gap-1">
                      {canCreatePlayer ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          // Keeps the visible word in the accessible name (WCAG 2.5.3).
                          aria-label={t("replace", { name: player.name })}
                          disabled={draft != null}
                          onClick={() => setDraft(emptyDraft(player.id, role))}
                        >
                          {t("replaceAction")}
                        </Button>
                      ) : null}
                      {canDeletePlayer ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive"
                          aria-label={t("remove", { name: player.name })}
                          onClick={() => setPendingRemoval(player)}
                        >
                          <Trash2 aria-hidden className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
                {draft?.parentId === player.id ? renderDraftRow(depth + 1) : null}
                </Fragment>
              );
            })}

            {draft?.parentId == null ? renderDraftRow(0) : null}

            {!rows.length && !draft ? (
              <TableRow className={tableStyles.row}>
                <TableCell className={tableStyles.cell} colSpan={6}>
                  <span className="text-muted-foreground">
                    {t("empty")}
                  </span>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </AdminDetailTableShell>

      <ConfirmDialog
        open={pendingRemoval != null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
        onConfirm={() => {
          if (pendingRemoval) removePlayer.mutate(pendingRemoval.id);
        }}
        pending={removePlayer.isPending}
        intent={{
            title: t("removeNamed", { name: pendingRemoval?.name ?? t("player") }),
            description: t("deleteDescription"),
            confirmLabel: removePlayer.isPending ? t("removing") : t("removeAction"),
          tone: "danger",
          cascade: [t("cascadeMatchStats"), t("cascadeSubstitutes")]
        }}
      />
    </div>
  );
}
