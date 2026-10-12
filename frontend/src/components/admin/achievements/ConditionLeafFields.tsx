"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { OPERATORS, STAT_LABEL_KEYS, STATS } from "./condition-flow.model";

/** Stat select + operator/value row shared by `stat_threshold`/`global_stat_sum`
 * and `hero_stat` (which prefixes it with its own hero-slug input). */
function StatOpValueFields({
  params,
  setParam,
  controlName
}: Readonly<{
  params: Record<string, unknown>;
  setParam: (key: string, value: unknown) => void;
  controlName: (field: string) => string;
}>) {
  const t = useTranslations("adminAchievements");
  return (
    <>
      <Select value={(params.stat as string) ?? ""} onValueChange={(v) => setParam("stat", v)}>
        <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.stat"))}><SelectValue placeholder={t("fields.stat")} /></SelectTrigger>
        <SelectContent>{STATS.map((s) => <SelectItem key={s} value={s}>{t(STAT_LABEL_KEYS[s])}</SelectItem>)}</SelectContent>
      </Select>
      <div className="flex gap-1">
        <Select value={(params.op as string) ?? ">="} onValueChange={(v) => setParam("op", v)}>
          <SelectTrigger className="h-7 text-xs w-16" aria-label={controlName(t("fields.operator"))}><SelectValue /></SelectTrigger>
          <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
        <NumberInput className="h-7 text-xs" aria-label={controlName(t("fields.thresholdValue"))} value={(params.value as number) ?? 0} onValueChange={(next) => setParam("value", next ?? 0)} />
      </div>
    </>
  );
}

/**
 * The inline parameter editors for one leaf condition. Which fields appear is
 * decided entirely by `conditionType`; every control is named through
 * `controlName` because thirty-odd param controls across the canvas share the
 * same handful of field names ("Operator", "Value").
 */
export function ConditionLeafFields({
  nodeId,
  conditionType,
  params,
  setParam,
  controlName
}: Readonly<{
  nodeId: string;
  conditionType: string | undefined;
  params: Record<string, unknown>;
  setParam: (key: string, value: unknown) => void;
  controlName: (field: string) => string;
}>) {
  const t = useTranslations("adminAchievements");
  const lostInRoundParam = params.lost_in_round;
  const lostInRound =
    lostInRoundParam !== null && typeof lostInRoundParam === "object"
      ? lostInRoundParam
      : null;
  const lostInRoundOp =
    lostInRound && "op" in lostInRound && typeof lostInRound.op === "string"
      ? lostInRound.op
      : undefined;
  const lostInRoundValue =
    lostInRound && "value" in lostInRound && typeof lostInRound.value === "number"
      ? lostInRound.value
      : 1;

  return (
    <div className="space-y-1.5 text-xs">
      {(conditionType === "stat_threshold" || conditionType === "global_stat_sum") && (
        <StatOpValueFields params={params} setParam={setParam} controlName={controlName} />
      )}
      {conditionType === "match_criteria" && (
        <>
          <Select value={(params.field as string) ?? ""} onValueChange={(v) => setParam("field", v)}>
            <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.field"))}><SelectValue placeholder={t("fields.field")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="closeness">{t("fields.closeness")}</SelectItem>
              <SelectItem value="match_time">{t("fields.matchTime")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            <Select value={(params.op as string) ?? ">="} onValueChange={(v) => setParam("op", v)}>
              <SelectTrigger className="h-7 text-xs w-16" aria-label={controlName(t("fields.operator"))}><SelectValue /></SelectTrigger>
              <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
            <NumberInput className="h-7 text-xs" aria-label={controlName(t("fields.thresholdValue"))} value={(params.value as number) ?? 0} onValueChange={(next) => setParam("value", next ?? 0)} />
          </div>
        </>
      )}
      {conditionType === "player_role" && (
        <Select value={(params.role as string) ?? "Damage"} onValueChange={(v) => setParam("role", v)}>
          <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.role"))}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Tank">{t("fields.tank")}</SelectItem>
            <SelectItem value="Damage">{t("fields.damage")}</SelectItem>
            <SelectItem value="Support">{t("fields.support")}</SelectItem>
          </SelectContent>
        </Select>
      )}
      {conditionType === "player_div" && (
        <div className="flex gap-1">
          <Select value={(params.op as string) ?? "=="} onValueChange={(v) => setParam("op", v)}>
            <SelectTrigger className="h-7 text-xs w-16" aria-label={controlName(t("fields.operator"))}><SelectValue /></SelectTrigger>
            <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
          <NumberInput integer className="h-7 text-xs" aria-label={controlName(t("fields.division"))} value={(params.value as number) ?? 1} onValueChange={(next) => setParam("value", next ?? 1)} />
        </div>
      )}
      {/* ── op + value conditions ── */}
      {(conditionType === "standing_position" || conditionType === "tournament_count" || conditionType === "div_level" || conditionType === "stage_completed") && (
        <div className="flex gap-1">
          <Select value={(params.op as string) ?? "=="} onValueChange={(v) => setParam("op", v)}>
            <SelectTrigger className="h-7 text-xs w-16" aria-label={controlName(t("fields.operator"))}><SelectValue /></SelectTrigger>
            <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
          <NumberInput integer className="h-7 text-xs" aria-label={controlName(t("fields.value"))} value={(params.value as number) ?? 1} onValueChange={(next) => setParam("value", next ?? 1)} />
        </div>
      )}
      {/* ── standing_record: field + op + value ── */}
      {conditionType === "standing_record" && (
        <>
          <Select value={(params.field as string) ?? "wins"} onValueChange={(v) => setParam("field", v)}>
            <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.field"))}><SelectValue placeholder={t("fields.field")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="wins">{t("fields.wins")}</SelectItem>
              <SelectItem value="losses">{t("fields.losses")}</SelectItem>
              <SelectItem value="draws">{t("fields.draws")}</SelectItem>
              <SelectItem value="points">{t("fields.points")}</SelectItem>
              <SelectItem value="buchholz">{t("fields.buchholz")}</SelectItem>
              <SelectItem value="matches">{t("fields.matches")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            <Select value={(params.op as string) ?? ">="} onValueChange={(v) => setParam("op", v)}>
              <SelectTrigger className="h-7 text-xs w-16" aria-label={controlName(t("fields.operator"))}><SelectValue /></SelectTrigger>
              <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
            <NumberInput className="h-7 text-xs" aria-label={controlName(t("fields.value"))} value={(params.value as number) ?? 0} onValueChange={(next) => setParam("value", next ?? 0)} />
          </div>
        </>
      )}
      {/* ── div_change ── */}
      {conditionType === "div_change" && (
        <div className="flex gap-1">
          <Select value={(params.direction as string) ?? "up"} onValueChange={(v) => setParam("direction", v)}>
            <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.direction"))}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="up">{t("fields.up")}</SelectItem>
              <SelectItem value="down">{t("fields.down")}</SelectItem>
            </SelectContent>
          </Select>
          <NumberInput integer className="h-7 text-xs" aria-label={controlName(t("fields.minimumShift"))} placeholder={t("fields.minShift")} value={(params.min_shift as number) ?? 1} onValueChange={(next) => setParam("min_shift", next ?? 1)} />
        </div>
      )}
      {/* ── hero_stat: hero + stat + op + value ── */}
      {conditionType === "hero_stat" && (
        <>
          <Input className="h-7 text-xs" aria-label={controlName(t("fields.heroSlug"))} placeholder={t("fields.heroSlugExample")} value={(params.hero_slug as string) ?? ""} onChange={(e) => setParam("hero_slug", e.target.value)} />
          <StatOpValueFields params={params} setParam={setParam} controlName={controlName} />
        </>
      )}
      {/* ── hero_kd_best ── */}
      {conditionType === "hero_kd_best" && (
        <>
          <Input className="h-7 text-xs" aria-label={controlName(t("fields.heroSlug"))} placeholder={t("fields.heroSlug")} value={(params.hero_slug as string) ?? ""} onChange={(e) => setParam("hero_slug", e.target.value)} />
          <div className="flex gap-1">
            <NumberInput integer className="h-7 text-xs" aria-label={controlName(t("fields.minimumTimePlayed"))} placeholder={t("fields.minTime")} value={(params.min_time as number) ?? 600} onValueChange={(next) => setParam("min_time", next ?? 600)} />
            <NumberInput integer className="h-7 text-xs" aria-label={controlName(t("fields.minimumMatches"))} placeholder={t("fields.minMatches")} value={(params.min_matches as number) ?? 3} onValueChange={(next) => setParam("min_matches", next ?? 3)} />
          </div>
        </>
      )}
      {/* ── global_winrate: order + limit + op/value ── */}
      {conditionType === "global_winrate" && (
        <>
          <div className="flex gap-1">
            <Select value={(params.order as string) ?? "desc"} onValueChange={(v) => setParam("order", v)}>
              <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.rankingEnd"))}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">{t("fields.top")}</SelectItem>
                <SelectItem value="asc">{t("fields.bottom")}</SelectItem>
              </SelectContent>
            </Select>
            <NumberInput integer className="h-7 text-xs" aria-label={controlName(t("fields.rankingLimit"))} placeholder={t("fields.limit")} value={(params.limit as number) ?? 20} onValueChange={(next) => setParam("limit", next ?? 20)} />
          </div>
          <div className="flex gap-1">
            <Select value={(params.op as string) ?? "none"} onValueChange={(v) => setParam("op", v === "none" ? undefined : v)}>
              <SelectTrigger className="h-7 text-xs w-16" aria-label={controlName(t("fields.winrateOperator"))}><SelectValue placeholder={t("fields.op")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("fields.none")}</SelectItem>
                {OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
            {Boolean(params.op) && <NumberInput className="h-7 text-xs w-16" aria-label={controlName(t("fields.winrate"))} placeholder={t("fields.rate")} value={(params.value as number) ?? 0.5} onValueChange={(next) => setParam("value", next ?? 0.5)} />}
          </div>
        </>
      )}
      {/* ── consecutive: metric + streak + day_two position ── */}
      {conditionType === "consecutive" && (
        <>
          <div className="flex gap-1">
            <Select value={(params.metric as string) ?? "win"} onValueChange={(v) => setParam("metric", v)}>
              <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.streakMetric"))}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="win">{t("fields.win")}</SelectItem>
                <SelectItem value="day_two">{t("fields.dayTwo")}</SelectItem>
              </SelectContent>
            </Select>
            <NumberInput integer className="h-7 text-xs" aria-label={controlName(t("fields.minimumStreak"))} placeholder={t("fields.streak")} value={(params.min_streak as number) ?? 2} onValueChange={(next) => setParam("min_streak", next ?? 2)} />
          </div>
          {(params.metric as string) === "day_two" && (
            <div className="flex gap-1 items-center">
              <p className="text-muted-foreground text-xs shrink-0">{t("fields.position")}</p>
              <Select value={(params.position_op as string) ?? "<"} onValueChange={(v) => setParam("position_op", v)}>
                <SelectTrigger className="h-7 text-xs w-16" aria-label={controlName(t("fields.positionOperator"))}><SelectValue /></SelectTrigger>
                <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
              <NumberInput integer className="h-7 text-xs w-14" aria-label={controlName(t("fields.position"))} value={(params.position_value as number) ?? 7} onValueChange={(next) => setParam("position_value", next ?? 7)} />
            </div>
          )}
        </>
      )}
      {/* ── is_newcomer: bool or count mode ── */}
      {conditionType === "is_newcomer" && (
        <div className="flex gap-1">
          <Select
            value={params.op !== undefined ? "count" : "bool"}
            onValueChange={(v) => {
              if (v === "bool") {
                setParam("op", undefined);
                setParam("value", undefined);
              } else {
                setParam("op", params.op ?? ">=");
                setParam("value", params.value ?? 1);
              }
            }}
          >
            <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.newcomerMode"))}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bool">{t("fields.isNewcomer")}</SelectItem>
              <SelectItem value="count">{t("fields.countTournaments")}</SelectItem>
            </SelectContent>
          </Select>
          {params.op !== undefined && (
            <>
              <Select value={(params.op as string) ?? ">="} onValueChange={(v) => setParam("op", v)}>
                <SelectTrigger className="h-7 text-xs w-16" aria-label={controlName(t("fields.tournamentCountOperator"))}><SelectValue /></SelectTrigger>
                <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
              <NumberInput integer className="h-7 text-xs w-14" aria-label={controlName(t("fields.tournamentCount"))} value={(params.value as number) ?? 1} onValueChange={(next) => setParam("value", next ?? 1)} />
            </>
          )}
        </div>
      )}
      {/* ── tournament_type: any/league/not league ── */}
      {conditionType === "tournament_type" && (
        <Select
          value={params.is_league === null || params.is_league === undefined ? "any" : String(params.is_league)}
          onValueChange={(v) => setParam("is_league", v === "any" ? null : v === "true")}
        >
          <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.tournamentType"))}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t("fields.any")}</SelectItem>
            <SelectItem value="true">{t("fields.league")}</SelectItem>
            <SelectItem value="false">{t("fields.notLeague")}</SelectItem>
          </SelectContent>
        </Select>
      )}
      {/* ── encounter_score: round_type + scores + winner ── */}
      {conditionType === "encounter_score" && (
        <>
          <div className="flex gap-1">
            <Select value={(params.round_type as string) ?? "any"} onValueChange={(v) => setParam("round_type", v)}>
              <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.roundType"))}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t("fields.anyRound")}</SelectItem>
                <SelectItem value="final">{t("fields.final")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(params.winner ?? true)} onValueChange={(v) => setParam("winner", v === "true")}>
              <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.whichSideCounts"))}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">{t("fields.winnerOnly")}</SelectItem>
                <SelectItem value="false">{t("fields.bothTeams")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">{t("fields.scorePatterns")}</p>
            {((params.scores as number[][]) ?? [[2, 3]]).map((pair, i) => (
              <div key={i} className="flex gap-1 items-center">
                <NumberInput integer className="h-7 text-xs w-12" aria-label={controlName(t("fields.homeScore", { index: i + 1 }))} value={pair[0]} onValueChange={(next) => {
                  const scores = [...((params.scores as number[][]) ?? [[2, 3]])];
                  scores[i] = [next ?? 0, scores[i][1]];
                  setParam("scores", scores);
                }} />
                <span className="text-xs text-muted-foreground" aria-hidden>–</span>
                <NumberInput integer className="h-7 text-xs w-12" aria-label={controlName(t("fields.awayScore", { index: i + 1 }))} value={pair[1]} onValueChange={(next) => {
                  const scores = [...((params.scores as number[][]) ?? [[2, 3]])];
                  scores[i] = [scores[i][0], next ?? 0];
                  setParam("scores", scores);
                }} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={controlName(t("fields.removeScorePattern", { index: i + 1 }))}
                  onClick={() => {
                    const scores = ((params.scores as number[][]) ?? [[2, 3]]).filter((_, idx) => idx !== i);
                    setParam("scores", scores.length > 0 ? scores : [[0, 0]]);
                  }}
                >
                  <X className="h-3 w-3 text-destructive" aria-hidden />
                </Button>
              </div>
            ))}
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              aria-label={controlName(t("condition.addScorePattern"))}
              onClick={() => {
                const scores = [...((params.scores as number[][]) ?? [[2, 3]]), [0, 0]];
                setParam("scores", scores);
              }}
            >
              <Plus className="h-3 w-3" aria-hidden />
              {t("condition.addScorePattern")}
            </button>
          </div>
        </>
      )}
      {/* ── match_mvp_check: stat + top_n + team count in top ── */}
      {conditionType === "match_mvp_check" && (
        <>
          <div className="flex gap-1">
            <Select value={(params.stat as string) ?? "Performance"} onValueChange={(v) => setParam("stat", v)}>
              <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.stat"))}><SelectValue placeholder={t("fields.stat")} /></SelectTrigger>
              <SelectContent>{STATS.map((s) => <SelectItem key={s} value={s}>{t(STAT_LABEL_KEYS[s])}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={(params.sort_order as string) ?? "auto"} onValueChange={(v) => setParam("sort_order", v)}>
              <SelectTrigger className="h-7 text-xs w-20" aria-label={controlName(t("fields.sortOrder"))}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("fields.auto")}</SelectItem>
                <SelectItem value="desc">{t("fields.desc")}</SelectItem>
                <SelectItem value="asc">{t("fields.asc")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-1 items-center">
            <p className="text-muted-foreground text-xs shrink-0">{t("fields.top")}</p>
            <NumberInput integer className="h-7 text-xs w-12" aria-label={controlName(t("fields.topNPlayers"))} min={1} value={(params.top_n as number) ?? 3} onValueChange={(next) => setParam("top_n", next ?? 3)} />
            <p className="text-muted-foreground text-xs shrink-0">{t("fields.teamInTop")}</p>
            <Select value={(params.op as string) ?? "=="} onValueChange={(v) => setParam("op", v)}>
              <SelectTrigger className="h-7 text-xs w-16" aria-label={controlName(t("fields.teammatesInTopOperator"))}><SelectValue /></SelectTrigger>
              <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
            <NumberInput integer className="h-7 text-xs w-12" aria-label={controlName(t("fields.teammatesInTop"))} min={0} value={(params.value as number) ?? 0} onValueChange={(next) => setParam("value", next ?? 0)} />
          </div>
        </>
      )}
      {/* ── bracket_path: lower/upper bracket + options ── */}
      {conditionType === "bracket_path" && (
        <>
          <div className="flex gap-1">
            <Select
              value={params.played_upper_bracket === true ? "upper" : "lower"}
              onValueChange={(v) => {
                if (v === "upper") {
                  setParam("played_lower_bracket", undefined);
                  setParam("played_upper_bracket", true);
                } else {
                  setParam("played_lower_bracket", true);
                  setParam("played_upper_bracket", undefined);
                }
              }}
            >
              <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.bracketPath"))}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lower">{t("fields.lowerBracket")}</SelectItem>
                <SelectItem value="upper">{t("fields.upperBracketOnly")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(params.played_lower_bracket ?? true) && (
            <>
              <div className="flex gap-1 items-center">
                <p className="text-muted-foreground text-xs shrink-0">{t("fields.minLbWins")}</p>
                <NumberInput integer className="h-7 text-xs w-14" aria-label={controlName(t("fields.minimumLowerBracketWins"))} value={(params.min_lower_bracket_wins as number) ?? null} placeholder={t("fields.any")} onValueChange={(next) => setParam("min_lower_bracket_wins", next ?? undefined)} />
              </div>
              <div className="flex gap-1 items-center">
                <p className="text-muted-foreground text-xs shrink-0">{t("fields.lostInRound")}</p>
                <Select value={lostInRoundOp ?? "any"} onValueChange={(v) => setParam("lost_in_round", v !== "any" ? { op: v, value: lostInRoundValue } : undefined)}>
                  <SelectTrigger className="h-7 text-xs w-16" aria-label={controlName(t("fields.lostInRoundOperator"))}><SelectValue placeholder={t("fields.any")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{t("fields.any")}</SelectItem>
                    {OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
                {lostInRoundOp && (
                  <NumberInput integer className="h-7 text-xs w-14" aria-label={controlName(t("fields.lostInRoundNumber"))} value={lostInRoundValue} onValueChange={(next) => setParam("lost_in_round", { ...lostInRound, value: next ?? 1 })} />
                )}
              </div>
            </>
          )}
        </>
      )}
      {/* ── tournament_format: double_elim / single_elim / round_robin ── */}
      {conditionType === "tournament_format" && (
        <Select value={(params.format as string) ?? "double_elim"} onValueChange={(v) => setParam("format", v)}>
          <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.tournamentFormat"))}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="double_elim">{t("fields.doubleElimination")}</SelectItem>
            <SelectItem value="single_elim">{t("fields.singleElimination")}</SelectItem>
            <SelectItem value="round_robin">{t("fields.roundRobin")}</SelectItem>
            <SelectItem value="has_bracket">{t("fields.anyBracket")}</SelectItem>
          </SelectContent>
        </Select>
      )}
      {/* ── distinct_count: field + op + value + scope + min_playtime ── */}
      {conditionType === "distinct_count" && (
        <>
          <div className="flex gap-1">
            <Select value={(params.field as string) ?? ""} onValueChange={(v) => setParam("field", v)}>
              <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.field"))}><SelectValue placeholder={t("fields.field")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="role">{t("fields.role")}</SelectItem>
                <SelectItem value="hero">{t("fields.hero")}</SelectItem>
                <SelectItem value="match">{t("fields.match")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={(params.op as string) ?? ">="} onValueChange={(v) => setParam("op", v)}>
            <SelectTrigger className="h-7 text-xs w-16" aria-label={controlName(t("fields.operator"))}><SelectValue /></SelectTrigger>
              <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
            <NumberInput integer className="h-7 text-xs w-16" aria-label={controlName(t("fields.distinctCount"))} value={(params.value as number) ?? 1} onValueChange={(next) => setParam("value", next ?? 1)} />
          </div>
          <div className="flex gap-1">
            <Select value={(params.scope as string) ?? "global"} onValueChange={(v) => setParam("scope", v)}>
              <SelectTrigger className="h-7 text-xs" aria-label={controlName(t("fields.countingScope"))}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">{t("fields.global")}</SelectItem>
                <SelectItem value="tournament">{t("fields.perTournament")}</SelectItem>
              </SelectContent>
            </Select>
            {(params.field as string) === "hero" && (
              <NumberInput integer className="h-7 text-xs w-20" aria-label={controlName(t("fields.minimumHeroPlaytime"))} placeholder={t("fields.minTime")} value={(params.min_playtime as number) ?? null} onValueChange={(next) => setParam("min_playtime", next ?? undefined)} />
            )}
          </div>
        </>
      )}
      {conditionType === "stable_streak" && (
        <>
          <div className="space-y-1">
            <p className="text-muted-foreground" id={`${nodeId}-streak-fields`}>{t("fields.fields")}</p>
            <div className="flex flex-wrap gap-1" role="group" aria-labelledby={`${nodeId}-streak-fields`}>
              {(["role", "division", "team", "hero"] as const).map((f) => {
                const fields = (params.fields as string[]) ?? [];
                const active = fields.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={active}
                    aria-label={controlName(t("fields.track", { field: t(`fields.${f}`) }))}
                    className={`px-1.5 py-0.5 rounded text-xs border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border hover:bg-accent"}`}
                    onClick={() => {
                      const next = active ? fields.filter((x) => x !== f) : [...fields, f];
                      setParam("fields", next);
                    }}
                  >
                    {t(`fields.${f}`)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-1 items-center">
            <p className="text-muted-foreground shrink-0">{t("fields.minStreak")}</p>
            <NumberInput integer className="h-7 text-xs w-16" aria-label={controlName(t("fields.minimumStreak"))} min={2} value={(params.min_streak as number) ?? 2} onValueChange={(next) => setParam("min_streak", next ?? 2)} />
          </div>
        </>
      )}
      {["match_win", "is_captain", "encounter_revenge"].includes(conditionType ?? "") && (
        <p className="text-muted-foreground italic">{t("fields.noParameters")}</p>
      )}
    </div>
  );
}
