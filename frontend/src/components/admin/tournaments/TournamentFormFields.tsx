"use client";

import type { DivisionGridVersion } from "@/types/workspace.types";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type TournamentFormFieldsMode = "manual-create" | "challonge-create";

export type TournamentFormFieldsValue = {
  name: string;
  description?: string | null;
  is_league: boolean;
  start_date: string;
  end_date: string;
  // Public-URL slug (`/tournaments/<slug>`); blank at creation auto-generates
  // one from `name`.
  slug?: string | null;
  win_points?: number;
  draw_points?: number;
  loss_points?: number;
  division_grid_version_id?: number | null;
  team_formation?: string;
};

/** Visual required marker; `required` on the control carries the semantics. */
const requiredMark = (
  <span aria-hidden className="ml-0.5 text-danger">
    *
  </span>
);

interface TournamentFormFieldsProps<T extends TournamentFormFieldsValue> {
  value: T;
  onChange: (next: T) => void;
  mode: TournamentFormFieldsMode;
  idPrefix?: string;
  challongeSlugValue?: string;
  onChallongeSlugValueChange?: (value: string) => void;
  divisionGridVersions?: DivisionGridVersion[];
  divisionGridLoading?: boolean;
}

/**
 * Step 1 of the new-tournament wizard. Team formation lives here and not on
 * the Rules step because the Schedule step right after needs it to know
 * whether a draft phase exists; the division grid sits beside it.
 */
export function TournamentFormFields<T extends TournamentFormFieldsValue>({
  value,
  onChange,
  mode,
  idPrefix = "tournament",
  challongeSlugValue,
  onChallongeSlugValueChange,
  divisionGridVersions = [],
  divisionGridLoading = false,
}: Readonly<TournamentFormFieldsProps<T>>) {
  const t = useTranslations("adminTournaments.form");
  const challonge = mode === "challonge-create";

  return (
    <div className="grid gap-5">
      {challonge ? (
        <div className="col-span-full">
          <Label htmlFor={`${idPrefix}-challonge-separate`}>
            {t.rich("challongeUrlOrSlugRequired", {
              required: () => requiredMark
            })}
          </Label>
          <Input
            id={`${idPrefix}-challonge-separate`}
            placeholder={t("challongePlaceholder")}
            value={challongeSlugValue ?? ""}
            onChange={(event) => onChallongeSlugValueChange?.(event.target.value)}
            required
            className="mt-1.5"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("challongeHelp")}
          </p>
        </div>
      ) : (
        <div className="col-span-full">
          <Label htmlFor={`${idPrefix}-name`}>
            {t.rich("nameRequired", { required: () => requiredMark })}
          </Label>
          <Input
            id={`${idPrefix}-name`}
            value={value.name}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            required
            className="mt-1.5"
          />
        </div>
      )}

      <div className="col-span-full">
        <Label htmlFor={`${idPrefix}-slug`}>{t("publicSlug")}</Label>
        <Input
          id={`${idPrefix}-slug`}
          value={value.slug ?? ""}
          onChange={(event) => onChange({ ...value, slug: event.target.value })}
          placeholder={t("slugPlaceholder")}
          className="mt-1.5"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">{t("slugCreateHelp")}</p>
      </div>

      {challonge ? null : (
        <div className="col-span-full">
          <Label htmlFor={`${idPrefix}-description`}>{t("description")}</Label>
          <Textarea
            id={`${idPrefix}-description`}
            value={value.description ?? ""}
            onChange={(event) => onChange({ ...value, description: event.target.value })}
            className="mt-1.5 min-h-[80px]"
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 col-span-full">
        <div>
          <Label htmlFor={`${idPrefix}-team-formation`}>{t("teamFormation")}</Label>
          <Select
            value={value.team_formation ?? "balancer"}
            onValueChange={(nextValue) => onChange({ ...value, team_formation: nextValue })}
          >
            <SelectTrigger id={`${idPrefix}-team-formation`} className="mt-1.5">
              <SelectValue placeholder={t("selectMethod")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="balancer">{t("formation.balancer")}</SelectItem>
              <SelectItem value="draft">{t("formation.draft")}</SelectItem>
              <SelectItem value="registration">{t("formation.registration")}</SelectItem>
              <SelectItem value="solo">{t("formation.solo")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("teamFormationHelp")}
          </p>
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-division-grid-version`}>{t("divisionGridVersion")}</Label>
          <Select
            value={value.division_grid_version_id?.toString() ?? "none"}
            onValueChange={(nextValue) =>
              onChange({
                ...value,
                division_grid_version_id: nextValue === "none" ? null : Number(nextValue),
              })
            }
          >
            <SelectTrigger id={`${idPrefix}-division-grid-version`} className="mt-1.5">
              <SelectValue
                placeholder={divisionGridLoading ? t("loadingDivisionGrids") : t("selectVersion")}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("workspaceDefault")}</SelectItem>
              {divisionGridVersions.map((version) => (
                <SelectItem key={version.id} value={version.id.toString()}>
                  {t("gridVersionOption", {
                    label: version.label,
                    version: version.version,
                    status: version.status,
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="col-span-full flex items-center gap-2">
        <Checkbox
          id={`${idPrefix}-is-league`}
          checked={value.is_league}
          onCheckedChange={(checked) => onChange({ ...value, is_league: checked === true })}
        />
        <Label htmlFor={`${idPrefix}-is-league`} className="cursor-pointer text-sm font-medium">
          {t("leagueSeason")}
        </Label>
      </div>

      <div className="col-span-full">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-date-range`}>
            {t.rich("dateRangeRequired", { required: () => requiredMark })}
          </FieldLabel>
          <div className="mt-1.5">
            <DateRangePicker
              id={`${idPrefix}-date-range`}
              startDate={value.start_date}
              endDate={value.end_date}
              onChange={(start, end) => onChange({ ...value, start_date: start, end_date: end })}
            />
          </div>
        </Field>
      </div>
    </div>
  );
}
