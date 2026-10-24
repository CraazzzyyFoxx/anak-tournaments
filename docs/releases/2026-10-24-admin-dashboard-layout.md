# Admin dashboard: layout and look

`/admin` keeps its blocks and data; their arrangement and look change, and each tournament card gains the
tournament's logo and cover. One additive wire change, no migration.

## Behaviour

* **Two columns from the top.** At `xl` the rail (To do, Activity) starts beside the tournament cards instead of below
  them, so one card no longer leaves most of its row empty. Below `xl` the order is unchanged: cards, to do, next 7
  days, trends, activity, backlog, platform health; on phones the to-do leads while a tournament is live.
* **Tournament cards.** As many columns as fit at 20rem: one card takes the whole column, three share it. A card at
  least 48rem wide splits into its identity (cover strip, logo, phase, title, lifecycle strip, next deadline, the way
  in) and the phase body; narrower, the two stack. The lifecycle strip (`PhaseStrip variant="compact"`) marks
  preparation → registration → team formation → in play → wrap-up. Bars show ranks covered and pool readiness in the
  checklist, ranked and checked in against approved during registration, and played against scheduled during play,
  where a pulsing dot marks encounters in progress. The phase line drops the status when its label repeats the phase.
  Without a cover the card has no strip; without a logo the game mark stands alone.
* **Next 7 days** is a list grouped by day (Today, Tomorrow, then the date), overdue starts first under their own
  heading; a row reads time, event, tournament and the relative time.
* **Activity** rows are grouped by day; the rows and their limit are unchanged.
* **Trends and Platform health** are open sections: a heading over their tiles, no card around them. Health tiles fill
  as many columns as fit at 14rem.
* **Type.** The greeting, section titles and tile figures are set in the display face (DESIGN §3). `StatTile` is shared,
  so the collector health pages (streams, ranks, subscriptions) get the same figures.
* **Progress bars announce their value.** `ui/progress.tsx` now passes `value` to the Radix root: every `Progress`
  exposes `aria-valuenow` and `aria-valuetext` instead of reading as indeterminate.

## Wire

* `GET /api/v1/admin/dashboard`: each `tournaments[]` card gains `logo_url` and `cover_image_url` (string or `null`,
  unmasked, like the name).
* `gateway/internal/openapi/schemas.json` and `frontend/src/types/api.generated.ts` are regenerated. The generated types
  also catch up with the encounters route and schemas of `d94942346`, which did not regenerate them.

## Deploy

Additive: deploy tournament-svc, the gateway (regenerated `schemas.json`) and the frontend from one SHA. A frontend
ahead of tournament-svc shows the cards without images; an older frontend ignores the new fields.

## Verification

`uv run pytest tests/test_admin_dashboard.py` (tournament-service, against the test Postgres);
`bash backend/scripts/export_openapi_schemas.sh --check`; `go test ./internal/openapi/` in the gateway;
`bunx vitest run src/components/admin/dashboard src/components/kit/PhaseStrip.behavior.test.tsx
src/components/admin/quota/ApiKeyQuotaDialog.behavior.test.tsx`; `eslint` on the changed files; `lint:design` (no new
finding: the one it reports, `DivisionRangePicker.tsx`, predates this change); `tsc` on the commit's own tree; browser
check of `/admin` at 1816, 1440, 1280, 1024 and 390 px with fixture responses (one, two and three cards, an overdue
start, between tournaments).
