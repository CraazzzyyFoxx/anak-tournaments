"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Gauge,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Sparkles,
  Users
} from "lucide-react";

import TeamName from "@/components/TeamName";
import { DataTable, columnMeta, createKebabColumn } from "@/components/data-table";
import { Combobox, ComboboxCheck } from "@/components/kit/Combobox";
import { getAdminDetailTableStyles } from "@/components/admin/AdminDetailTable";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { WizardShell } from "@/components/kit/WizardShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type {
  ChallongeTeamMapping,
  ChallongeTeamPreviewParticipant,
  ChallongeTeamPreviewTeam
} from "@/types/admin.types";
import type { Team } from "@/types/team.types";
import { invalidateTournamentWorkspace } from "@/lib/tournament/workspace-query-keys";
import { Spinner } from "@/components/ui/spinner";
import { adminQueryKeys } from "@/lib/admin/query-keys";

interface TournamentTeamsTabProps {
  tournamentId: number;
  teams: Team[];
  stagesCount: number;
  hasChallongeSource: boolean;
  canCreateTeam: boolean;
  canUpdateTeam: boolean;
  canDeleteTeam: boolean;
  canImportTeams: boolean;
  canCreatePlayer: boolean;
  canUpdatePlayer: boolean;
  canDeletePlayer: boolean;
}

const UNMAPPED_TEAM_VALUE = "unmapped";

function getChallongeParticipantKey(participant: ChallongeTeamPreviewParticipant) {
  return `${participant.participant_id}:${participant.group_id ?? "none"}`;
}

type TeamsTranslator = ReturnType<typeof useTranslations<"adminTournament.teams">>;

const TEAM_COLUMNS = (t: TeamsTranslator): ColumnDef<Team>[] => [
  {
    accessorKey: "name",
    header: t("team"),
    cell: ({ row }) => <TeamName team={row.original} size="xs" nameClassName="font-medium" />,
    // Player names too: an admin often knows who is on a roster, not what it is called.
    meta: columnMeta<Team>({
      searchValue: (team) => [team.name, ...team.players.map((player) => player.name)].join(" ")
    })
  },
  {
    accessorKey: "avg_sr",
    header: t("avgSr"),
    cell: ({ row }) => row.original.avg_sr.toFixed(0),
    meta: columnMeta<Team>({ align: "right", numeric: true })
  },
  {
    accessorKey: "total_sr",
    header: t("totalSr"),
    meta: columnMeta<Team>({ align: "right", numeric: true })
  },
  {
    id: "players",
    accessorFn: (team) => team.players.length,
    header: t("players"),
    meta: columnMeta<Team>({ align: "right", numeric: true })
  },
  createKebabColumn<Team>(
    (team) => [{ label: t("open"), icon: Pencil, href: `/admin/teams/${team.id}` }],
    { rowLabel: (team) => team.name }
  )
];

function summarizeChallongeSyncResult(result: {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}, t: TeamsTranslator) {
  return <span className="tabular-nums">{t("syncSummary", result)}</span>;
}

/**
 * Searchable internal-team picker for one Challonge participant.
 *
 * A plain `<Select>` listed every team in creation order with no way to type:
 * a mix roster runs to dozens of teams whose Challonge participant name
 * ("litnik team") differs from the internal one ("litnik"), which is precisely
 * the case that lands here — auto-mapping only matches on an exact normalized
 * name, so whatever it could resolve is already mapped before this dialog opens.
 *
 * Search covers the internal name, the balancer name and the numeric id, because
 * all three are what an admin actually has in hand while reading the Challonge
 * side. Own `open`/`searchValue` state per row: the shell is controlled, and one
 * row's popover must not know about another's.
 */
function ChallongeTeamPicker({
  participant,
  teams,
  value,
  onChange
}: Readonly<{
  participant: ChallongeTeamPreviewParticipant;
  teams: ChallongeTeamPreviewTeam[];
  value: string;
  onChange: (next: string) => void;
}>) {
  const t = useTranslations("adminTournament.teams");
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const selected = teams.find((team) => String(team.id) === value);

  const select = (next: string) => {
    onChange(next);
    setOpen(false);
    setSearchValue("");
  };

  return (
    <Combobox
      open={open}
      onOpenChange={setOpen}
      label={selected ? selected.name : t("unmapped")}
      // The visible label repeats down the column, so it cannot name the control.
      triggerAriaLabel={t("internalTeamFor", { name: participant.name })}
      searchValue={searchValue}
      onSearchValueChange={setSearchValue}
      searchPlaceholder={t("search")}
      searchLabel={t("searchInternalTeamFor", { name: participant.name })}
      emptyMessage={t("noMatch")}
      clear={
        selected
          ? {
              label: t("unmapped"),
              value: "challonge-unmap-participant",
              onSelect: () => select(UNMAPPED_TEAM_VALUE)
            }
          : undefined
      }
    >
      <CommandGroup>
        {teams.map((team) => (
          <CommandItem
            key={team.id}
            value={`${team.name} ${team.balancer_name} ${team.id}`}
            onSelect={() => select(String(team.id))}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{team.name}</span>
              {team.balancer_name && team.balancer_name !== team.name ? (
                <span className="truncate text-xs text-muted-foreground">{team.balancer_name}</span>
              ) : null}
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{team.id}</span>
            <ComboboxCheck selected={String(team.id) === value} />
          </CommandItem>
        ))}
      </CommandGroup>
    </Combobox>
  );
}

export function TournamentTeamsTab({
  tournamentId,
  teams,
  stagesCount,
  hasChallongeSource,
  canCreateTeam,
  canUpdateTeam,
  canDeleteTeam,
  canImportTeams,
  canCreatePlayer,
  canUpdatePlayer,
  canDeletePlayer
}: Readonly<TournamentTeamsTabProps>) {
  const t = useTranslations("adminTournament.teams");
  const tx = useTranslations("adminTournament.teamsExtra");
  const queryClient = useQueryClient();
  const tableStyles = getAdminDetailTableStyles("compact");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // `?challongeSync=1` exists so the Integrations card can send an admin straight
  // to the mapping table that clears its "N participants not mapped" failure —
  // otherwise the error is on one tab and its only fix on another. Read once for
  // the initial value and stripped on mount: with the param left in place a
  // refresh (or a Back into this page) would reopen a dialog nobody asked for.
  const [challongeSyncDialogOpen, setChallongeSyncDialogOpen] = useState(
    () => searchParams.get("challongeSync") === "1"
  );
  const [challongeMappingDraft, setChallongeMappingDraft] = useState<Record<string, string>>({});
  const [challongeSyncStep, setChallongeSyncStep] = useState<"map" | "confirm">("map");

  useEffect(() => {
    if (searchParams.get("challongeSync") !== "1") {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("challongeSync");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const canManageRoster = canCreatePlayer || canUpdatePlayer || canDeletePlayer;
  const canManageTeams = canCreateTeam || canUpdateTeam || canDeleteTeam || canManageRoster;
  const teamsAdminHref = `/admin/teams?tournament=${tournamentId}`;

  const { data: challongePreview, isLoading: isChallongePreviewLoading } = useQuery({
    queryKey: adminQueryKeys.challongeTeamSyncPreview(tournamentId),
    queryFn: () => adminService.getChallongeTeamSyncPreview(tournamentId),
    enabled: challongeSyncDialogOpen && hasChallongeSource
  });

  const syncTeamsMutation = useMutation({
    mutationFn: (mappings: ChallongeTeamMapping[]) =>
      adminService.syncTeamsFromChallonge(tournamentId, { mappings }),
    onSuccess: (result) => {
      invalidateTournamentWorkspace(queryClient, tournamentId);
      setChallongeSyncDialogOpen(false);
      notify.success(tx("syncSuccess"), {
        description: summarizeChallongeSyncResult(result, t)
      });
    }
  });

  const challongeParticipants = useMemo(
    () => challongePreview?.participants ?? [],
    [challongePreview?.participants]
  );
  const challongeTeamOptions = useMemo(
    () => challongePreview?.teams ?? [],
    [challongePreview?.teams]
  );
  const challongeTeamsById = useMemo(
    () => new Map(challongeTeamOptions.map((team) => [team.id, team])),
    [challongeTeamOptions]
  );
  const getChallongeMappingValue = (participant: ChallongeTeamPreviewParticipant) =>
    challongeMappingDraft[getChallongeParticipantKey(participant)] ??
    (participant.mapped_team_id != null ? String(participant.mapped_team_id) : UNMAPPED_TEAM_VALUE);
  const activeUnmappedParticipants = challongeParticipants.filter(
    (participant) =>
      participant.active && getChallongeMappingValue(participant) === UNMAPPED_TEAM_VALUE
  );
  const selectedChallongeMappings = challongeParticipants.flatMap((participant) => {
    const value = getChallongeMappingValue(participant);
    if (!value || value === UNMAPPED_TEAM_VALUE) {
      return [];
    }

    const teamId = Number.parseInt(value, 10);
    if (Number.isNaN(teamId)) {
      return [];
    }

    return [
      {
        participant_id: participant.participant_id,
        group_id: participant.group_id,
        team_id: teamId
      }
    ];
  });
  const canSubmitChallongeMappings =
    !isChallongePreviewLoading &&
    challongeParticipants.length > 0 &&
    selectedChallongeMappings.length > 0 &&
    activeUnmappedParticipants.length === 0;

  // The confirm step reads back what will be written, so it needs the names
  // behind the ids the request carries.
  const onConfirmStep = challongeSyncStep === "confirm";
  const confirmedChallongeRows = challongeParticipants.flatMap((participant) => {
    const value = getChallongeMappingValue(participant);
    const team = value === UNMAPPED_TEAM_VALUE ? undefined : challongeTeamsById.get(Number(value));
    return team
      ? [
          {
            key: getChallongeParticipantKey(participant),
            participant: participant.name,
            team: team.name,
            group: participant.group_name ?? tx("mainGroup")
          }
        ]
      : [];
  });

  const openChallongeSyncDialog = () => {
    syncTeamsMutation.reset();
    setChallongeMappingDraft({});
    setChallongeSyncStep("map");
    setChallongeSyncDialogOpen(true);
  };

  const closeChallongeSyncDialog = () => {
    if (syncTeamsMutation.isPending) {
      return;
    }

    setChallongeSyncDialogOpen(false);
    setChallongeMappingDraft({});
    setChallongeSyncStep("map");
  };

  const applyChallongeSuggestions = () => {
    setChallongeMappingDraft((current) => {
      const next = { ...current };
      for (const participant of challongeParticipants) {
        if (participant.suggested_team_id != null) {
          next[getChallongeParticipantKey(participant)] = String(participant.suggested_team_id);
        }
      }
      return next;
    });
  };

  const submitChallongeMappings = () => {
    if (!canSubmitChallongeMappings) {
      notify.error(tx("mappingsIncomplete"), {
        description: tx("mappingsIncompleteDescription", { count: activeUnmappedParticipants.length })
      });
      return;
    }

    syncTeamsMutation.mutate(selectedChallongeMappings);
  };

  const rosterPlayersCount = teams.reduce((sum, team) => sum + team.players.length, 0);
  const teamsWithRosterCount = teams.filter((team) => team.players.length > 0).length;
  const emptyRosterTeamsCount = teams.length - teamsWithRosterCount;
  const averageSr =
    teams.length > 0
      ? Math.round(teams.reduce((sum, team) => sum + team.avg_sr, 0) / teams.length)
      : 0;

  const syncTeamsButton = canImportTeams ? (
    <Button
      variant="outline"
      onClick={openChallongeSyncDialog}
      disabled={syncTeamsMutation.isPending || !hasChallongeSource}
    >
      <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
      {t("sync")}
    </Button>
  ) : null;

  return (
    <>
      <StatTileGrid className="mb-4">
        <StatTile
          label={t("teams")}
          value={teams.length}
          detail={tx("stages", { count: stagesCount })}
          icon={Users}
        />
        <StatTile
          label={t("rosterRecords")}
          value={rosterPlayersCount}
          detail={tx("rosterCount", { withPlayers: teamsWithRosterCount, total: teams.length })}
          icon={ClipboardList}
        />
        <StatTile
          label={t("averageSr")}
          value={teams.length ? averageSr : "—"}
          detail={tx("acrossLoaded")}
          icon={Gauge}
        />
        <StatTile
          label={t("emptyRosters")}
          value={emptyRosterTeamsCount}
          detail={
            emptyRosterTeamsCount > 0
              ? t("playersBeforeSeeding")
              : t("everyTeamHasPlayers")
          }
          icon={AlertTriangle}
          tone={emptyRosterTeamsCount > 0 ? "warning" : "success"}
        />
      </StatTileGrid>

      <Card className="border-border/40">
        <CardHeader className="gap-3 pb-3">
          <div className="min-w-0">
            <CardTitle asChild className="text-base font-semibold">
              <h2>{t("operations")}</h2>
            </CardTitle>
            <CardDescription className="mt-1">
              {t("operationsDescription")}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {syncTeamsButton}
            {canImportTeams ? (
              <Button asChild variant="outline">
                {/* D30/A-O2: the sole UI entry to the balancer tool after the shell removal (v3.1). */}
                <Link href={`/balancer?tournament=${tournamentId}`}>
                  <Scale className="mr-2 h-4 w-4" aria-hidden />
                  {t("openBalancer")}
                </Link>
              </Button>
            ) : null}
            {canManageTeams ? (
              <Button asChild>
                <Link href={teamsAdminHref}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden />
                  {t("manage")}
                </Link>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={teams}
            columns={TEAM_COLUMNS(t)}
            getRowId={(team) => String(team.id)}
            searchPlaceholder={t("searchTeamsPlayers")}
            rowUnit="teams"
            onRowClick={(row) => router.push(`/admin/teams/${row.original.id}`)}
            emptyMessage={t("empty")}
          />
        </CardContent>
      </Card>

      <Dialog
        open={challongeSyncDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setChallongeSyncDialogOpen(true);
          } else {
            closeChallongeSyncDialog();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader className="border-b border-border/60 pb-4">
            <DialogTitle>{t("syncChallonge")}</DialogTitle>
            <DialogDescription>
              {t("mappingDescription")}
            </DialogDescription>
          </DialogHeader>

          {/* Two steps rather than one long table with a Sync button at the
              bottom: the mapping is destructive on the internal teams, and the
              confirm step is where the admin reads back what will be written
              instead of re-scanning the picker column they just filled in. */}
          <WizardShell
            steps={[
              { key: "map", label: t("mapParticipants"), state: onConfirmStep ? "done" : "current" },
              { key: "confirm", label: t("confirm"), state: onConfirmStep ? "current" : "todo" }
            ]}
            footer={{
              back: onConfirmStep ? () => setChallongeSyncStep("map") : undefined,
              next: onConfirmStep
                ? {
                    label: syncTeamsMutation.isPending ? tx("syncing") : tx("syncMappings"),
                    onClick: submitChallongeMappings,
                    disabled: !canSubmitChallongeMappings || syncTeamsMutation.isPending
                  }
                : {
                    label: t("continue"),
                    onClick: () => setChallongeSyncStep("confirm"),
                    disabled: !canSubmitChallongeMappings
                  },
              secondary: (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeChallongeSyncDialog}
                  disabled={syncTeamsMutation.isPending}
                >
                  {t("cancel")}
                </Button>
              )
            }}
          >
            {onConfirmStep ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {tx("mappingSummary", { selected: selectedChallongeMappings.length, total: challongeParticipants.length })}
                </p>
                <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                  {confirmedChallongeRows.map((row) => (
                    <li
                      key={row.key}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate" title={row.participant}>
                        {row.participant}
                      </span>
                      <ArrowRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate font-medium" title={row.team}>
                        {row.team}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {row.group}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="tabular-nums">
                      {t("participantsCount", { count: challongeParticipants.length })}
                    </Badge>
                    <Badge
                      tone={activeUnmappedParticipants.length ? "danger" : "neutral"}
                      className="tabular-nums"
                    >
                      {t("unmappedCount", { count: activeUnmappedParticipants.length })}
                    </Badge>
                    <Badge variant="secondary" className="tabular-nums">
                      {t("selectedCount", { count: selectedChallongeMappings.length })}
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={applyChallongeSuggestions}
                    disabled={
                      isChallongePreviewLoading ||
                      !challongeParticipants.some(
                        (participant) => participant.suggested_team_id != null
                      )
                    }
                  >
                    <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                    {t("apply")}
                  </Button>
                </div>

                <div className="max-h-[52vh] overflow-auto rounded-md border border-border/60">
                  <Table>
                    <TableHeader>
                      <TableRow className={tableStyles.headerRow}>
                        <TableHead className={tableStyles.head}>{tx("participant")}</TableHead>
                        <TableHead className={tableStyles.head}>{t("group")}</TableHead>
                        <TableHead className={tableStyles.head}>{t("current")}</TableHead>
                        <TableHead className={tableStyles.head}>{t("suggestion")}</TableHead>
                        <TableHead className={tableStyles.head}>{t("internalTeam")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isChallongePreviewLoading ? (
                        <TableRow className={tableStyles.row}>
                          <TableCell className={tableStyles.cell} colSpan={5}>
                            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                              <Spinner />
                              {t("loadingParticipants")}
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : challongeParticipants.length ? (
                        challongeParticipants.map((participant) => {
                          const participantKey = getChallongeParticipantKey(participant);
                          const currentTeam =
                            participant.mapped_team_id != null
                              ? challongeTeamsById.get(participant.mapped_team_id)
                              : undefined;
                          const suggestedTeam =
                            participant.suggested_team_id != null
                              ? challongeTeamsById.get(participant.suggested_team_id)
                              : undefined;

                          return (
                            <TableRow key={participantKey} className={tableStyles.row}>
                              <TableCell className={tableStyles.cell}>
                                <div className="min-w-0">
                                  <div className="truncate font-medium" title={participant.name}>
                                    {participant.name}
                                  </div>
                                  <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                                    {tx("participantNumber", {
                                      id: participant.participant_id,
                                      challongeId: participant.challonge_id
                                    })}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className={tableStyles.cell}>
                                {participant.group_name ?? tx("mainGroup")}
                              </TableCell>
                              <TableCell className={tableStyles.cell}>
                                {currentTeam ? (
                                  <span className="truncate" title={currentTeam.name}>
                                    {currentTeam.name}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">{t("unmapped")}</span>
                                )}
                              </TableCell>
                              <TableCell className={tableStyles.cell}>
                                {suggestedTeam ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 max-w-[180px] justify-start px-2"
                                    aria-label={t("mapAria", { participant: participant.name, team: suggestedTeam.name })}
                                    onClick={() =>
                                      setChallongeMappingDraft((current) => ({
                                        ...current,
                                        [participantKey]: String(suggestedTeam.id)
                                      }))
                                    }
                                  >
                                    <Sparkles className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden />
                                    <span className="truncate">{suggestedTeam.name}</span>
                                  </Button>
                                ) : (
                                  <span className="text-muted-foreground">{t("none")}</span>
                                )}
                              </TableCell>
                              <TableCell className={tableStyles.cell}>
                                <ChallongeTeamPicker
                                  participant={participant}
                                  teams={challongeTeamOptions}
                                  value={getChallongeMappingValue(participant)}
                                  onChange={(next) =>
                                    setChallongeMappingDraft((current) => ({
                                      ...current,
                                      [participantKey]: next
                                    }))
                                  }
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow className={tableStyles.row}>
                          <TableCell className={tableStyles.cell} colSpan={5}>
                            <div className="py-4 text-sm text-muted-foreground">
                              {t("noParticipants")}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </WizardShell>
        </DialogContent>
      </Dialog>
    </>
  );
}
