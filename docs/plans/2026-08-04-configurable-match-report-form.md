# Configurable match report form

Date: 2026-08-04
Status: accepted, implementing

## Understanding summary

- **What**: a per-tournament configuration for the captain match-report form, plus a
  new built-in `comment` field and organizer-defined custom **text** fields.
- **Why**: match/replay codes are currently silently optional
  (`captain.py` drops blank codes), so organizers cannot enforce evidence.
  Different tournaments need different evidence rules, and organizers want a free-form
  note channel from captains.
- **Who for**: tournament organizers (config) and team captains (submission).
- **Constraints**: reuse the established `balancer.registration_form` shape
  (`built_in_fields_json` + `custom_fields_json`, per-tournament row, admin builder page).
  Backend is the validation source of truth; the frontend mirrors it for UX only.
- **Non-goals**: non-text custom field types, per-stage/per-round config cascade,
  workspace-level defaults, regex validators, custom fields affecting dispute logic.

## Decision log

| # | Decision | Alternatives | Why |
|---|---|---|---|
| 1 | Config scope is **per-tournament** (`uq(tournament_id)`) | workspace default + tournament override (à la `MapVetoConfig` cascade); workspace-only | YAGNI. Mirrors `registration_form`. A cascade can be added later without changing the wire shape. |
| 2 | New table `tournament.encounter_report_form`, defined **inside the existing `encounter_report.py` module** | new module file; JSON columns on `tournament` | Same domain as the reports it configures; avoids touching three `__init__` re-export lists for zero benefit. |
| 3 | `comment` is a **dedicated `TEXT` column** on `encounter_captain_report` | a preset entry in `custom_fields_json` | First-class: reaches `CaptainReportRead`, the admin reports browser, and future filtering without JSON digging. |
| 4 | `map_codes.required` means **one code per played map** (`home_score + away_score`), clamped to the slots the series actually offers | every `best_of` slot; at least one code; a configurable mode enum | Matches series reality: a 2-0 Bo3 has two codes, not three. A forfeit (0-0) requires none. The clamp keeps a nonsense score (3-2 in a Bo3) from becoming a 422 the captain cannot fix. No extra enum to maintain. |
| 5 | `closeness` becomes **nullable** and configurable | keep it always-required | "enable/disable a field" must apply uniformly; `encounter.closeness` is already nullable, so `_recompute_encounter_result` only needs a None branch. |
| 6 | Custom fields and `comment` **do not** participate in auto-confirm / dispute | any field mismatch ⇒ disputed | Two captains never type identical prose ⇒ permanent false disputes. Score stays the only derivation input. |
| 7 | The public config read **rides the existing** `GET /encounters/{id}/reports` envelope | a new public `GET /tournaments/{id}/report-form` route | No new gateway route, no new visibility gate, no extra round trip in the dialog, and the config is guaranteed consistent with the reports shown next to it. |
| 8 | Admin UI is a new **matches sub-tab** `report-form` | section inside `TournamentSettingsTab` (27 KB); section inside `TournamentMatchesTab` (48 KB) | The `MATCHES_SUB_TAB_KEYS` machinery already yields the requested `/admin/tournaments/[id]/matches/report-form` path plus tab-bar + permission integration for free. |
| 9 | **No per-field `max_length` knob**; fixed caps | configurable lengths | One less knob to validate on both sides. `comment ≤ 1000`, custom text `≤ 500`. |
| 10 | `home_score`/`away_score` are **not** configurable | make them toggleable | They are the input to result derivation; a report without a score is meaningless. |

## Assumptions

- No row ⇒ defaults apply; the row is created lazily on first admin save.
  Reads never write.
- Rules apply to **new submissions only**. Existing reports (no comment, no custom
  values, non-null closeness) stay valid and readable.
- Load is negligible: one extra JSON read per report-dialog open, cached by TanStack Query.
- Admin permission: `match.read` to view the config, `match.update` to save it —
  the same pair already guarding encounter result writes.

## Data model

```
tournament.encounter_report_form
  id                    PK
  tournament_id         FK tournament.tournament(id) ON DELETE CASCADE, UNIQUE
  built_in_fields_json  JSON NOT NULL DEFAULT '{}'
  custom_fields_json    JSON NOT NULL DEFAULT '[]'
  created_at/updated_at (TimeStampIntegerMixin)

tournament.encounter_captain_report
  + comment             TEXT NULL
  + custom_fields_json  JSON NOT NULL DEFAULT '{}'
  ~ closeness           INTEGER NULL   (was NOT NULL)
```

`CHECK (closeness BETWEEN 1 AND 10)` is unchanged — NULL passes a SQL CHECK.

Migration `rptform0001`, revises `divgrid0004` — one of the repo's two pre-existing alembic
heads, so the head count does not grow (`alembic heads` → `mtchlog001`, `rptform0001`).

## Wire contracts

### Config shape (shared by admin read/write and the public read)

```ts
type ReportBuiltInFieldConfig = { enabled: boolean; required: boolean };

type ReportCustomFieldDefinition = {
  key: string;              // ^[a-z][a-z0-9_]{0,31}$
  label: string;            // 1..64
  type: "text";
  required: boolean;
  placeholder: string | null;
};

type MatchReportForm = {
  tournament_id: number;
  built_in_fields: {
    closeness: ReportBuiltInFieldConfig;
    map_codes: ReportBuiltInFieldConfig;
    comment: ReportBuiltInFieldConfig;
  };
  custom_fields: ReportCustomFieldDefinition[];   // max 20
};
```

Defaults (also fill any missing key on read):

| field | enabled | required |
|---|---|---|
| `closeness` | `true` | `true` |
| `map_codes` | `true` | `false` |
| `comment` | `true` | `false` |

### Endpoints

| Method | Path | RPC queue | Auth |
|---|---|---|---|
| GET | `/api/v1/admin/tournaments/{tournament_id}/report-form` | `rpc.tournament.report_form_get` | `match.read` |
| PUT | `/api/v1/admin/tournaments/{tournament_id}/report-form` | `rpc.tournament.report_form_upsert` | `match.update` |

`PUT` body is `MatchReportForm` without `tournament_id`.

`GET /api/v1/encounters/{id}/reports` envelope grows a sibling key:

```ts
{ reports: CaptainReport[]; form: MatchReportForm }
```

`CaptainReport` grows:

```ts
comment: string | null;
custom_fields: Record<string, string>;
```

`POST /api/v1/encounters/{id}/report` body grows:

```ts
closeness: number | null;                  // was number
comment?: string | null;
custom_fields?: Record<string, string>;
```

## Validation

### On submit (`422` with a human `detail`)

Applied after the config is resolved; disabled fields are **dropped, not rejected**, so a
stale client cannot fail a submit it could not have known about.

| Rule | Message |
|---|---|
| `closeness` disabled | value ignored, stored `NULL` |
| `closeness` enabled + required, value missing | `closeness is required` |
| `closeness` present and outside `1..10` | `closeness must be between 1 and 10` |
| `map_codes` disabled | all codes dropped |
| `map_codes` enabled + required | a non-blank code for the first `home_score + away_score` entries of the encounter's slot set (`series_map_indices`: the veto pool's pick orders, else `1..best_of`, else `1..3`) → `a match code is required for every played map` |
| `comment` disabled | stored `NULL` |
| `comment` enabled + required, blank | `comment is required` |
| `comment` longer than 1000 chars | `comment must be at most 1000 characters` |
| custom key not in the current definitions | dropped |
| custom field required, blank | `"<label>" is required` |
| custom value longer than 500 chars | `"<label>" must be at most 500 characters` |

### On upsert (`422`)

- unknown `built_in_fields` key → rejected
- `custom_fields`: ≤ 20 entries, unique `key`, key matches `^[a-z][a-z0-9_]{0,31}$`,
  key not reserved (`home_score`, `away_score`, `score`, `closeness`, `map_codes`, `comment`),
  `label` 1..64, `type == "text"`

## Result derivation

`_recompute_encounter_result` is unchanged except for closeness:

```
if either report's closeness is NULL -> encounter.closeness = None
else                                 -> encounter.closeness = avg / 10
```

Score matching still decides `confirmed` vs `disputed`. Comments and custom values are
never compared (decision 6).

## UI

### Captain — `MatchReportDialog`
Score controls always render. Each subsequent block renders only when its config says
`enabled`; `required` drives an accessible required marker plus an inline error and a
disabled submit. Order: score → match quality → map codes → comment (`Textarea`) →
custom text fields → existing `CaptainReportsView`.

### Organizer — `/admin/tournaments/[id]/matches/report-form`
`MatchReportFormBuilder`: three built-in rows (enable switch + required switch, with
`required` disabled while `enabled` is off) and a repeatable custom-field editor
(label, auto-slugged key, required, placeholder, remove) with add/save.

### Organizer — reports browser
`CaptainReportsView` and `AdminReportPairCell` surface `comment` and custom values so a
disputing organizer can read what the captains wrote.
