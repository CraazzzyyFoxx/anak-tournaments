# Tournament analytics: release note

`/tournaments/analytics` now uses the site's design system instead of its own. The flows stay the same: the tournament
and ranking pickers, the standings list beside the team/player panel (push navigation on a phone), the Table view and
the glossary.

## Behaviour

* **Header.** Crumbs, then the tournament name (it links to the tournament) with its status pill, and one meta line:
  format · formation · teams · players. The verdict (who beat the forecast, who fell short) is the lede. The six figures
  (climbing, dropping, watch flags, average confidence, upsets, new faces) replace Teams/Players/Groups/Stages; only
  climbing and dropping are coloured. The figures no longer switch the list mode: the mode toggle above the list does
  that. "How this works" moved from the foot of the page into the header.
* **Standings list.** One framed list. The place shows as on the Teams tab: a medal for 1–3 once the tournament has
  ended, `#N` otherwise. A row shows its group chip only when the bracket has several groups. The record is text, and
  the flags are listed by kind, each with its glyph, short name and count.
  The predicted → actual connector is drawn with tokens (hidden below 640px), and its sentence is in `title` and
  `aria-label`. The delta is coloured text. "Watch list" is offered only while something is flagged. The selected row
  gets a background, not a coloured left edge.
* **Team and player panels.** Each is one card with sections divided by hairlines (they were stacks of cards). The panel
  takes about 40% of the row (at least 21rem), as wide as before.
  - A watch flag is its kind's glyph and short name (smurf, throw, griefing, sandbag) in the one warning colour; the
    three contradictory per-kind palettes are gone. In a roster line it sits in the meta line beside the impact bar.
  - Newcomer and new-role marks are the roster cards' icons.
  - The kind's name replaces the raw API value in the copy.
  - Numbers are formatted through next-intl.
* **Table view.** Rebuilt on `ui/table` inside a labelled scroll region. Coloured stripes, role tiles and chips are gone.
  Impact and vs-similar appear only for viewers who can read them. The view is kept in `?view=table`.
* **Organizer tools.** Same actions. The radio buttons and checkboxes come from `ui`. Job status and stage names are
  translated. There are no tinted panels. The manual-shift dialog uses `NumberInput`, starts from the saved value each
  time it opens, and reports a refused save.
* No entrance animation.

## Contract

* `AnalyticsHeroParts` is now `{ counts: { teams, players }, lede, stats, actions, controls }` (`rankedBy` and `groups`
  are gone). `SlotProps["analytics"]` gains `ended`, which decides the medals.
* New `ui` primitives: `RowButton` (`ui/row-button.tsx`) and `Button size="icon-sm"`, both documented in `DESIGN.md` §6.

## Removed

Both `Analytics.module.css` files and the `--c-*` aliases. The components `VerdictBanner`, `KpiRail`, `HowItWorksCard`,
`DeltaPill`, `ForecastChip`, `AnomalyLegend`, `AnomalyTooltip` and `MetricTooltip`. The `analytics.*` messages nothing
renders any more, in both languages.

## Verification

* `tsc --noEmit`: clean.
* `eslint` on the changed files: the two `react-hooks/set-state-in-effect` findings in `MLAdminToolbar` were already there
  before this change.
* `lint:zones`: clean. `lint:design`: no findings in the changed files.
* `vitest`: the analytics host, board, helpers and pre-move parity tests, plus i18n parity.
* Browser check against the dev API at 1440, 1024, 768 and 390 px, signed out and as `dev-admin`, in English and Russian:
  - the list and Table views;
  - the team and player panels;
  - the glossary and how-it-works sheets;
  - the organizer tools and the training dialog.

  The page never scrolls sideways.
