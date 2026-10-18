"use client";

import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { encounterScopeLabel } from "@/components/admin/encounters/EncounterCells";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import SearchableImageSelect from "@/components/ui/searchable-image-select";
import { Spinner } from "@/components/ui/spinner";
import { useBracketRoundLabel, type BracketRoundLabelFormatter } from "@/hooks/useBracketRoundLabel";
import { UNKNOWN_ROUND_SHAPE } from "@/lib/bracket/round-name";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import adminService from "@/services/admin.service";
import encounterService from "@/services/encounter.service";
import type { LogBindRequest, LogProcessingRecord } from "@/types/admin.types";
import type { Encounter } from "@/types/encounter.types";
import { gameObservationRevision, getLogFileName } from "./logs.helpers";

/** Two encounters of one pair share a name, so the stage and round tell them apart. */
function encounterOptionLabel(encounter: Encounter, formatRound: BracketRoundLabelFormatter) {
  return `${encounter.name} · ${encounterScopeLabel(encounter)} · ${formatRound(encounter.round, UNKNOWN_ROUND_SHAPE)}`;
}

/**
 * Picks the encounter and actual game for a log. An awaiting_link job that carries its document teams
 * binds with the operator's complete team map (and the game's observed revision as the precondition);
 * every other row only attaches a hint and is reprocessed through the queue.
 */
export function AttachLogDialog({
  record,
  encounters,
  historyKey,
  workspaceId,
  isPending,
  onAttach,
  onBind,
  onClose
}: Readonly<{
  record: LogProcessingRecord;
  encounters: Encounter[];
  /** Realtime stales this key, so the occupancy read below follows the console. */
  historyKey: readonly unknown[];
  workspaceId: number | null;
  isPending: boolean;
  onAttach: (encounterId: number, encounterGameId: number) => void;
  onBind: (request: LogBindRequest) => void;
  onClose: () => void;
}>) {
  const t = useTranslations("adminTournament.logs");
  const tx = useTranslations("adminTournament.logsExtra");
  const formatRound = useBracketRoundLabel();
  const bindMode = record.status === "awaiting_link" && record.teams.length > 0;
  const [value, setValue] = useState(
    record.attached_encounter_id != null ? String(record.attached_encounter_id) : undefined
  );
  const [gameId, setGameId] = useState(
    record.attached_encounter_game_id != null ? String(record.attached_encounter_game_id) : undefined
  );
  // document team key -> encounter.team id, as the operator picked it. Reset with the game.
  const [teamMap, setTeamMap] = useState<Record<string, string>>({});
  const encounterId = value === undefined ? undefined : Number(value);
  const gamesQuery = useQuery({
    queryKey: encounterQueryKeys.detail(encounterId),
    queryFn: () => encounterService.getEncounter(encounterId!),
    enabled: encounterId !== undefined
  });
  const games = gamesQuery.data?.games.filter((game) => game.state !== "cancelled") ?? [];
  const selectedGame = games.find((game) => String(game.id) === gameId);

  // ponytail: one page of 200 (the history cap) is read; an encounter has a handful of logs.
  const occupancyQuery = useQuery({
    queryKey: [...historyKey, "occupancy", encounterId],
    queryFn: () => adminService.getLogHistory(undefined, { encounterId, workspaceId, limit: 200 }),
    enabled: bindMode && encounterId !== undefined
  });
  const revision =
    selectedGame && occupancyQuery.data
      ? gameObservationRevision(occupancyQuery.data.items, selectedGame.id)
      : null;

  const teamNames = new Map((gamesQuery.data?.teams ?? []).map((team) => [team.id, team.name]));
  const seats = selectedGame?.teams.map((seat) => seat.encounter_team_id) ?? [];
  const picked = record.teams.map((team) => teamMap[team.key]).filter(Boolean);
  const mapComplete = seats.length === record.teams.length && picked.length === record.teams.length;
  const mapSeatMismatch = bindMode && selectedGame != null && seats.length !== record.teams.length;
  const loadFailed = gamesQuery.isError || (bindMode && occupancyQuery.isError);
  const loading = gamesQuery.isFetching || (bindMode && occupancyQuery.isFetching);
  const canSubmit =
    selectedGame != null && !loading && !loadFailed && !isPending && (!bindMode || (mapComplete && revision != null));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{bindMode ? tx("bindTitle") : t("attachTitle")}</DialogTitle>
          <DialogDescription className="break-all">
            {bindMode
              ? tx("bindDescription", { filename: getLogFileName(record.filename) })
              : t("attachDescriptionWithFile", { filename: getLogFileName(record.filename) })}
          </DialogDescription>
        </DialogHeader>
        <SearchableImageSelect
          value={value}
          onValueChange={(next) => {
            setValue(next);
            setGameId(undefined);
            setTeamMap({});
          }}
          disabled={isPending}
          ariaLabel={t("pickEncounter")}
          options={encounters.map((encounter) => ({
            value: String(encounter.id),
            label: encounterOptionLabel(encounter, formatRound)
          }))}
          placeholder={t("pickEncounter")}
          searchPlaceholder={t("searchEncounter")}
          triggerClassName="h-9"
        />
        <SearchableImageSelect
          value={selectedGame ? String(selectedGame.id) : undefined}
          onValueChange={(next) => {
            setGameId(next);
            setTeamMap({});
          }}
          options={games.map((game) => ({
            value: String(game.id),
            label: t("gameOption", {
              position: game.position,
              map: game.map?.name ?? t("unknownMap"),
              id: game.id
            })
          }))}
          placeholder={t("pickGame")}
          ariaLabel={t("pickGame")}
          searchPlaceholder={t("searchGame")}
          disabled={encounterId === undefined || gamesQuery.isFetching || gamesQuery.isError || isPending}
          triggerClassName="h-9"
        />
        {encounterId !== undefined && loading ? (
          <p role="status" className="text-sm text-muted-foreground">{t("loadingGames")}</p>
        ) : loadFailed ? (
          <div role="alert" className="space-y-2 text-sm text-danger">
            <p>{t("gamesLoadFailed")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void gamesQuery.refetch();
                if (bindMode) void occupancyQuery.refetch();
              }}
            >
              {t("reloadGames")}
            </Button>
          </div>
        ) : encounterId !== undefined && gamesQuery.isSuccess && games.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">{t("noGames")}</p>
        ) : null}
        {bindMode && selectedGame && !loading && !loadFailed ? (
          <fieldset className="space-y-2" disabled={isPending}>
            <legend className="mb-1 text-sm font-medium">{tx("teamMap")}</legend>
            {mapSeatMismatch ? (
              <p role="alert" className="text-sm text-danger">
                {tx("seatMismatch", { seats: seats.length, teams: record.teams.length })}
              </p>
            ) : (
              record.teams.map((team) => (
                <div key={team.key} className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {tx("logTeam", { position: team.source_position, key: team.key })}
                    {team.participants.length > 0 ? ` · ${team.participants.join(", ")}` : ""}
                  </p>
                  <SearchableImageSelect
                    value={teamMap[team.key]}
                    onValueChange={(next) =>
                      setTeamMap((current) => ({ ...current, [team.key]: next ?? "" }))
                    }
                    // A seat already given to another log team is not offered twice.
                    options={seats
                      .filter((seat) => String(seat) === teamMap[team.key] || !picked.includes(String(seat)))
                      .map((seat) => ({
                        value: String(seat),
                        label: teamNames.get(seat) ?? `#${seat}`
                      }))}
                    placeholder={tx("pickSeat")}
                    ariaLabel={tx("seatFor", { team: team.key })}
                    searchPlaceholder={tx("searchSeat")}
                    triggerClassName="h-9"
                  />
                </div>
              ))
            )}
            {revision ? (
              <p role="status" className="text-xs text-muted-foreground">
                {tx("willReplace", { revision })}
              </p>
            ) : null}
          </fieldset>
        ) : null}
        <DialogFooter>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (encounterId === undefined || !selectedGame) return;
              if (!bindMode) return onAttach(encounterId, selectedGame.id);
              onBind({
                encounter_game_id: selectedGame.id,
                teams: Object.fromEntries(record.teams.map((team) => [team.key, Number(teamMap[team.key])])),
                expected_revision: revision ?? 0
              });
            }}
          >
            {isPending ? <Spinner /> : <Link2 aria-hidden />}
            {bindMode ? tx("bind") : t("attach")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
