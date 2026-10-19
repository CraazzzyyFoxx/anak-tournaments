# OWT Design System

The single source of truth for how the OWT frontend looks and behaves. Read it
before you add or change anything a user sees: a page, a component, a row, a
label. When this file and the code disagree, the code is a bug or this file is
stale — say which, do not average the two.

- Tokens live in `src/app/globals.css`. Every value quoted here is copied from
  there; if a value moves, `globals.css` wins.
- The interactive token sheet is `public/docs/design-book.html` (served at
  `/docs/design-book.html`). It illustrates; it does not override this file.
- `npm run lint:design` (`scripts/check-design-compliance.mjs`) enforces the
  mechanical subset: no raw hex or Tailwind neutrals, the `color:` hint, an
  11px hard floor on type, no glyph icons, no fake buttons.

## 0. The five rules agents break most

1. **A chip is not a style.** Plain text is the default for every fact. A chip
   is allowed for exactly four jobs — see §4. "It looks nicer in a pill" is
   never one of them.
2. **Say a fact once.** If the card title says the round, the row does not.
   If the score is coloured, there is no "Winner" pill next to it. If a whole
   round is Bo3, "Bo3" goes in the round's header, not on each match.
3. **Show a control only when there is a choice.** One stage → no stage chips.
   One tab → no tab bar. A filter whose count equals the total → hidden.
4. **Reuse, do not re-roll.** Before writing markup, check §6. A new
   hand-rolled `rounded-full border px-2` span is the most common way this
   codebase got 30 chip implementations.
5. **Colour means something.** Colour comes from a token and encodes a result,
   a quality, a role, a status, a group or a medal (§2). Never decoration.

## 1. Atmosphere

**Editorial Tactical**, dark only. An analytics product for tournament
players: every screen answers a concrete question ("who won", "who carried",
"which maps get played") and the data is the interface.

- _Editorial_: hairline rules, open sections, mixed-case headings, whitespace
  as the grouping device.
- _Tactical_: a broadcast-overlay voice for data — small uppercase labels,
  tabular figures, a heavy display face on scores.
- Dials: **variance 3** (calm, grid-aligned, predictable), **motion 2**
  (colour/opacity transitions only), **density 6** ("analytics comfortable":
  denser than marketing, never cramped).
- One accent: teal. Everything else on screen is a neutral or a data colour.

## 2. Colour

Two token families coexist:

- `--aqt-*` hold **complete colours** (`hsl(220 22% 8%)`) and are used
  directly: `bg-[color:var(--aqt-card)]`.
- shadcn tokens (`--background`, `--card`, `--border`, `--primary`, …) hold
  **bare HSL triplets**, because Tailwind wraps them: `bg-card`.

Never redefine a shadcn token name inside a scoped block (`.x { --card: … }`
makes `hsl(var(--card))` resolve to `hsl(hsl(…))` and the surface silently
goes transparent). Scoped aliases take their own prefix (`--tn-*`, `--ed-*`).
Arbitrary Tailwind colours need the `color:` hint:
`text-[color:var(--aqt-fg)]`, never `text-[var(--aqt-fg)]`.

### Ground and text

| Token                  | Value                    | Role                                             |
| ---------------------- | ------------------------ | ------------------------------------------------ |
| `--aqt-bg`             | `hsl(220 21% 5%)`        | page background                                  |
| `--aqt-bg-2`           | `hsl(220 22% 7%)`        | hero frame, raised page band                     |
| `--aqt-card`           | `hsl(220 22% 8%)`        | section card                                     |
| `--aqt-card-2`         | `hsl(222 24% 11%)`       | nested surface, bar track on a card              |
| `--aqt-overlay-1`      | `hsl(0 0% 100% / 0.015)` | group card fill (`.team-card`)                   |
| `--aqt-overlay-2`      | `hsl(0 0% 100% / 0.025)` | **row hover**, bar track                         |
| `--aqt-overlay-3`      | `hsl(0 0% 100% / 0.05)`  | pressed / neutral tint                           |
| `--aqt-overlay-border` | `hsl(0 0% 100% / 0.06)`  | group card border, in-card dividers              |
| `--aqt-border`         | `hsl(219 19% 15%)`       | hairline, section card border                    |
| `--aqt-border-2`       | `hsl(217 17% 21%)`       | control border                                   |
| `--aqt-border-3`       | `hsl(216 16% 26%)`       | hover / focus / active border                    |
| `--aqt-fg`             | `hsl(214 33% 96%)`       | primary text, values                             |
| `--aqt-fg-muted`       | `hsl(212 13% 65%)`       | secondary text, loser's score                    |
| `--aqt-fg-dim`         | `hsl(213 9% 58%)`        | meta lines, the `·` separator, muted rows        |
| `--aqt-fg-faint`       | `hsl(214 10% 52%)`       | labels, column heads, ranks — the floor for text |

Nesting is expressed with overlays, never a new grey. Exactly three borders.

### Accent and data colours

| Group    | Tokens                                                                                                                        | Used for                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Accent   | `--aqt-teal` `hsl(172 70% 49%)`                                                                                               | links on hover, active tab/filter, focus ring, a winner's score, bars with no other meaning |
| Featured | `--aqt-warm` (= `--aqt-amber`)                                                                                                | the featured tournament, titles, the captain crown. Rare.                                   |
| Roles    | `--aqt-tank` `hsl(209 82% 65%)`, `--aqt-damage` `hsl(337 81% 66%)`, `--aqt-support` `hsl(150 57% 52%)`, `--aqt-flex` (violet) | role icons, role bars, the role-share spectrum                                              |
| Results  | win `--aqt-emerald`, loss `--aqt-rose`, draw `--aqt-amber`                                                                    | a map score, W/L/D squares, form streak                                                     |
| Quality  | `winrateColor(pct, lowSample)` in `lib/colors.ts` (≥60 emerald, 50–59 amber, <50 rose; greyed on a low sample)                | winrate, deltas, impact                                                                     |
| Status   | `--aqt-status-live` / `-upcoming` / `-finished` / `-draft`                                                                    | `TournamentStatusPill` only                                                                 |
| Medals   | `--aqt-medal-gold` / `-silver` / `-bronze` (+ `-fg`)                                                                          | places 1–3 of a **finished** competition                                                    |
| Groups   | `groupHue(name)` in `lib/tournament/group.ts`                                                                                 | cycles teal → amber → violet → blue → rose → emerald                                        |
| Brands   | `--aqt-brand-*`                                                                                                               | social/provider icons only                                                                  |

Rules:

- Never raw hex, `white/N`, `slate-*` or `zinc-*`: workspace theming
  (`WorkspaceThemeSync`) cannot reach them.
- Results, roles and statuses are separate meanings even where they share a
  hue: paint a win with `--aqt-emerald`, never `--aqt-support`; a live state
  with `--aqt-status-live`, never `--aqt-rose` directly.
- Never colour-only: a W/L square carries its letter, a status pill its word,
  a pip strip an `aria-label` summary.
- The role spectrum (tank→damage→support gradient) is data: a role
  distribution bar, or the profile header hairline. Never a decorative
  gradient.

## 3. Typography

Two faces, self-hosted with `next/font/local` in `src/app/layout.tsx`, their
`.variable` classes mounted on `<html>` (not `<body>`: `globals.css` aliases
them from `:root`, which cannot see a variable defined below it).

| Face        | Token / utility                                                 | Use                                                                              |
| ----------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Inter**   | `font-sans`, `--aqt-data`, `.aqt-tnum` (Inter + `tabular-nums`) | all text, labels, table cells, numbers in rows                                   |
| **Onest**   | `font-display`, `--aqt-display`                                 | page titles, section titles, scores (`.score`, `.boardScore`), large KPI figures |
| system mono | `font-mono`                                                     | code and identifiers only (API keys, log output). Never a UI label.              |

**Type roles are the only sizes** (`@theme static` in `globals.css`; each
carries its line-height, weight stays explicit):

| Utility         | Size / lh           | Use                                                                                                |
| --------------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| `text-label`    | 12 / 1.25           | eyebrows, column heads, fact labels, counters — with `uppercase tracking-label` when it is a label |
| `text-caption`  | 13 / 1.4            | secondary text, meta lines, table cells                                                            |
| `text-body`     | 14 / 1.5            | body copy                                                                                          |
| `text-ui`       | 15 / 1.5            | row primary text, stage headings (`font-semibold`)                                                 |
| `text-heading`  | 18 / 1.3            | card and block sub-headings                                                                        |
| `text-title`    | 22 / 1.15 / −0.01em | section `h2`, mixed case, display face                                                             |
| `text-headline` | 30 / 1.1 / −0.02em  | compact hero titles                                                                                |
| `text-display`  | clamp(32–56) / 1.03 | page-hero `h1`                                                                                     |

- `tracking-label` (0.08em) is the only tracking for uppercase text. Not
  `tracking-[0.06em]`, not 0.04em.
- No `text-[Npx]`, no `font-size: 11px`. Missing a size? Add a role.
- Numbers that line up use `.aqt-tnum`.
- Uppercase is for labels the product writes ("ROLE", "AVG SR"), never for
  user content (team names, tournament names, nicknames).
- `cn()` (`lib/utils.ts`) knows these role names; keep using it, or
  tailwind-merge files `text-label` under colour and drops it.

## 4. Chips — the policy

A chip is a small bordered or tinted label. The codebase has about 30
implementations and about 150 uses on the public site; most of them wrap a
plain fact. That ends here.

### A chip is allowed for exactly four jobs

| #   | Job                                       | Component                                                                                                           | Notes                                                                                                                                                                                                     |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Interactive filter / toggle**           | `FilterChip` in `FilterChipGroup` (`ui/filter-chip.tsx`)                                                            | A real `<button aria-pressed>`. Only when there is more than one option; hide a chip whose count is 0 or equals the total. A chosen entity (a team, a map) becomes a removable `active` chip with `×`.    |
| 2   | **Lifecycle status that wants attention** | `TournamentStatusPill` (`tournaments/StatusPill.tsx`); admin: `kit/StatusPill`                                      | Live, upcoming, draft, disputed, pending confirmation, an active session. **Not** "finished/completed" on a list where most items are finished — the absence of a pill says finished. One status per row. |
| 3   | **Categorical colour key**                | group: `.group-chip` + `groupHue()`; medal: `PlaceBadge` (`ui/place-badge.tsx`); W/L/D: `ResTag` / `.aqt-form-chip` | Only where the colour distinguishes items within the same view (Group A vs Group B rows in one Swiss round). A medal only for places 1–3 of a finished competition.                                       |
| 4   | **Count**                                 | `FilterChip count`, `TabsTrigger badge` (`ui/tabs.tsx`)                                                             | A count attached to a control. A standalone count is text.                                                                                                                                                |

### Everything else is text — use these instead

| You want to show                                 | Do this instead of a chip                                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| A format (`Bo3`), a round, a stage               | the card/section header that groups the rows (`metricValue`, `.sectionMeta`) — said once                                               |
| A label:value fact ("Teams 16", "Format League") | a `<dl>` fact (label `text-label uppercase tracking-label`, value below) or `Label value` text                                         |
| A qualifier of a title ("Tank · 19.7%")          | muted inline text: `<span class="text-[color:var(--aqt-fg-dim)] font-normal">· 19.7%</span>`                                           |
| A list of meta facts                             | one `text-caption text-[color:var(--aqt-fg-muted)]` line joined with `·` (dot in `--aqt-fg-dim`)                                       |
| Winner / loser                                   | colour the score (teal winner, muted loser) and weight the name                                                                        |
| Home / away                                      | position (home left, away right). Nothing else.                                                                                        |
| A placement outside the medals                   | `#7` in `.aqt-tnum` text                                                                                                               |
| A BattleTag discriminator                        | `#1234` in `--aqt-fg-faint` text after the nick                                                                                        |
| "League", "Preview", "New", "Sub", "Late" flags  | a word in the meta line, or an icon with `aria-label` + `title`; a status pill only if it is the one state on that row worth attention |
| A boolean state (checked-in, verified)           | an icon (`StatusIconBadge`, `role="img"` + `aria-label`), no "Yes/No" word                                                             |
| A role                                           | `PlayerRoleIcon` (icon only in rows; icon + word only in a role split)                                                                 |
| A division                                       | `DivisionIcon`, name in `title`                                                                                                        |

### Limits

- At most **two chips in a header**, at most **one per row** of a list.
- No chips inside table cells, except a status column.
- Never a chip whose content repeats text already visible nearby (a "Final"
  pill under a 3:0 board, "1st place" beside `#1`).
- Never stack chips inside a chip, or a chip inside a card header that
  already carries the same meaning in its title.
- Uppercase chips only for product-written words; never for user content.
- Before adding one, answer: _which of the four jobs is this?_ If none, it is
  text.

## 5. Shape, surfaces, elevation

| Element                        | Radius                  | Surface                                               |
| ------------------------------ | ----------------------- | ----------------------------------------------------- |
| Group card (`.team-card`)      | 12px                    | `--aqt-overlay-1` fill, `--aqt-overlay-border` border |
| Section card (`Card`, `.card`) | 12px (`rounded-xl`)     | `--aqt-card` fill, `--aqt-border` border              |
| Page hero (`HeroFrame`)        | 14px (`--aqt-radius`)   | `--aqt-bg-2`, one teal hairline, one corner glow      |
| Controls, filter chip          | 8px (`--aqt-radius-sm`) | `--aqt-overlay-2`, `--aqt-border-2`                   |
| Status pill, `Badge`           | `rounded-md`            | tone tint (`TONE_CLASS`)                              |
| Bars                           | `rounded-full`          | `--aqt-overlay-2` / `--aqt-card-2` track              |

- **One level of framing.** A card never contains a card. Inside a card,
  group with `tc-divider` / `divide-y` hairlines and whitespace — no tiles,
  no tinted callouts, no coloured left borders.
- **When to frame.** Frame a group of rows that belong together (a team, a
  round, a role column, a day of matches) or a dense data block. A page
  section is open: a heading, then its content.
- No shadows on dark surfaces; elevation is fill + border.
- Hover on a row is `bg-[color:var(--aqt-overlay-2)]`; on a card it is the
  border moving to `--aqt-border-3` (or teal for a whole-card link). Never a
  scale or size change.

## 6. Components — reuse these, do not re-roll them

### Foundations

| Need                       | Use                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Titled group card          | `TournamentTeamCardFrame` (`components/TournamentTeamCard.tsx`): `name`, optional `leadingTag` / `positionTag`, `metricLabel` + `metricValue` on the right, `side` for a home/away top edge. Teams, match rounds, map-pool rounds and stat role columns all use it. Do not retype its classes by hand. |
| Section card               | `Card` (`ui/card.tsx`, keeps `data-ui="card"`)                                                                                                                                                                                                                                                         |
| Page hero                  | `PageHero` / `HeroFrame` (`components/site/PageHero.tsx`); `variant="plain"` on `/` and `/get-workspace`                                                                                                                                                                                               |
| Profile section / open KPI | `CardSurface`, `ProfileStat` (`users/components/shared/atoms.tsx`): uppercase label, Onest figure, dim sub line, colour only for quality                                                                                                                                                               |
| Empty / error / not-found  | `PageStateCard` (`ui/page-state-card.tsx`); on tournament sections `TournamentPageState` (adds `refresh-error` under stale content)                                                                                                                                                                    |
| Skeletons                  | `ui/skeleton.tsx`; tournament sections `_components/TournamentSkeletons.tsx`; dashboards `components/skeletons/dashboard-skeletons.tsx`                                                                                                                                                                |
| Link with hover prefetch   | `HoverPrefetchLink`                                                                                                                                                                                                                                                                                    |
| Team identity              | `TeamName` / `TeamLogo` (`components/TeamName.tsx`) — no fallback glyph when a team has no image                                                                                                                                                                                                       |
| Player identity            | `PlayerName`, roster rows `RosterPlayer` / `RosterRole` / `RosterRank` (`TournamentTeamCard.tsx`)                                                                                                                                                                                                      |
| Role / division marker     | `PlayerRoleIcon`, `DivisionIcon`                                                                                                                                                                                                                                                                       |
| Hero avatars               | `HeroImage`, `HeroStrip` (collapsing `+N` stack)                                                                                                                                                                                                                                                       |
| Group colour               | `groupHue(name)`, `groupIndex(name)`, `groupDisplayName(name, word)` (`lib/tournament/group.ts`)                                                                                                                                                                                                       |

### Controls

| Need                        | Use                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Filter chip                 | `FilterChip` in `FilterChipGroup` (`ui/filter-chip.tsx`)                                                                |
| Filter + controls row       | `SectionToolbar` (tournament sections): chips at the start, search/sort/view at the end                                 |
| Search                      | `SearchField` (`ui/search-field.tsx`), `label` required                                                                 |
| Select                      | `ui/select.tsx` — never a native `<select>`                                                                             |
| Panels of different content | `ui/tabs.tsx` (Radix), `TabsTrigger badge` for a count                                                                  |
| Tabs that are addresses     | `kit/LinkTabs.tsx` (`aria-current="page"`, `level={2}` for sub-tabs)                                                    |
| View/mode of the same data  | `ui/toggle-group.tsx` pill; on tournament sections `ViewSegment` (`?view=` / `?tab=`, default never written to the URL) |
| Pagination                  | `ui/data-pagination.tsx`                                                                                                |
| Data table                  | `components/data-table/DataTable.tsx`                                                                                   |
| URL state                   | `hooks/useQueryParams.ts`                                                                                               |
| Button                      | `ui/button.tsx`; `static={false}` opts into a reduced-motion-safe press                                                 |

### Status and data

| Need               | Use                                                                        |
| ------------------ | -------------------------------------------------------------------------- |
| Lifecycle status   | `TournamentStatusPill` (public), `kit/StatusPill` (admin)                  |
| Boolean state icon | `StatusIconBadge` (`components/status/StatusIconBadge.tsx`)                |
| Live / recency dot | `StatusDot` (`ui/status-dot.tsx`), always `aria-hidden`                    |
| Placement medal    | `PlaceBadge` (`ui/place-badge.tsx`, `--aqt-medal-*`)                       |
| W/L/D square       | `ResTag` (`components/match/cells.tsx`)                                    |
| MVP placement      | `MvpOrdinal` (`users/components/shared/MvpOrdinal.tsx`): gold for 1st only |
| Platform totals    | `components/stats/PlatformStatsGrid.tsx`                                   |
| Markdown           | `components/Markdown.tsx`; editing `components/admin/MarkdownEditor.tsx`   |
| Spinner (rare)     | `ui/spinner.tsx` — prefer a skeleton                                       |

## 7. Layout

- App container: `max-w-screen-3xl` (1720px), gutters `px-4 md:px-6 xl:px-10`.
- Breakpoints (`--breakpoint-*` in `globals.css`): `xs` 320, `xs1` 540,
  `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1520, `3xl` 1720.
- Verify every change at **390, 768, 1024, 1440**. The page body never
  scrolls sideways; measure `document.documentElement.scrollWidth` against
  `innerWidth`, do not eyeball it.

### Grids

| Content                        | Grid                                                      |
| ------------------------------ | --------------------------------------------------------- |
| Group cards (rounds, days)     | `grid gap-3 lg:grid-cols-2 lg:items-start`                |
| Three parallel columns (roles) | `grid gap-3 lg:grid-cols-3 lg:items-start`                |
| Team cards                     | `grid gap-4 md:grid-cols-2 xl:grid-cols-3`                |
| Tournament cards               | `grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` |
| Expandable list                | `space-y-2` of group cards                                |

Grids keep their shape while loading and on error: the skeleton draws the
same columns.

### Section shape (tournament sections)

`<section class={styles.publicDataPage} aria-label>` →
`UpdatingBadge` (refetching) → `SectionToolbar` (only if it has a choice) →
optional caption line (`EYEBROW` title + lede on **one** line) →
stage heading `h2/h3` (`text-ui font-semibold`) → grid of group cards.

### Responsive

- Multi-column grids collapse to one column below their breakpoint.
- A row that reads as a scoreboard on desktop restacks on phones from **one
  DOM** with `grid-template-areas` (`.matchRow` in
  `tournaments/[slug]/TournamentDetail.module.css`, `.mapRow` in
  `components/match/EncounterDetail.module.css`). Do not render two trees.
- Below `sm`, drop secondary columns (`hidden sm:block`): trailing text,
  thumbnails, bars when the number is shown, chips. Keep the number.
- A horizontal strip is allowed **inside** a row for items of one kind (map
  candidates, filter chips): `-mx-3.5 flex snap-x snap-mandatory
scroll-px-3.5 overflow-x-auto px-3.5`, the next item half visible.
- Touch targets: 44px for primary actions on mobile; small icon links grow
  their hit area with `-m-2 p-2 md:m-0 md:p-0` instead of growing the row.

## 8. Canonical patterns

Copy these from the reference implementations; they were built on this
system.

| Pattern                             | How                                                                                                                                                                                                                                              | Reference                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Group card with header meta**     | `TournamentTeamCardFrame name={heading} metricValue={"Bo3 · 2 matches"}`; what every row shares is said in the header once                                                                                                                       | `_views/TournamentEncountersPage.tsx`, `tournamentMatches.model.ts` (`MatchBlock.meta`) |
| **Scoreboard row**                  | `home · score – score · away`, winner's score teal, loser's muted; stacked as a bracket node under 640px                                                                                                                                         | `tournaments/[slug]/_components/MatchRow.tsx`                                           |
| **Whole-row link**                  | in a div/grid row: an `absolute inset-0` link under the cells (or `after:absolute after:inset-0` on the name link); secondary links get `relative` to sit above it. In a `<table>`: link the name cell only — a `<tr>` is not a containing block | `MatchRow.tsx`; `tournaments/components/TournamentsTable.tsx`                           |
| **Expanding row**                   | native `<details>` + `summary list-none [&::-webkit-details-marker]:hidden`, `ChevronDown group-open:rotate-180`, focus ring inset; several can be open                                                                                          | `MatchRow.tsx`, `_views/_components/TeamListRow.tsx`                                    |
| **Leader-scaled bar**               | `h-1.5 rounded-full` track `--aqt-overlay-2`, fill = value / leader, exact value printed beside it; `role="progressbar"` with `aria-valuetext`                                                                                                   | `_views/TournamentStatsPage.tsx` (`getHeroPlaytimeMetric`)                              |
| **Ranked column**                   | zero-padded rank (`01`) in `text-label text-[color:var(--aqt-fg-faint)]`, icon, name, value right-aligned `.aqt-tnum`                                                                                                                            | `TournamentStatsPage.tsx`                                                               |
| **Header with board + facts**       | crumbs and actions → board (team · display score · team) → pills (≤2 states) + `<dl>` facts; an `sr-only` `h1` names the matchup; a fact with no data is omitted, not dashed                                                                     | `encounters/[id]/components/EncounterHeader.tsx`                                        |
| **Tabs only with content**          | build the tab list from what has data; one tab → no tab bar; first tab is the bare URL                                                                                                                                                           | `encounters/[id]/page.tsx`                                                              |
| **Collapsed empties**               | unplayed slots become one line ("2 more maps not played"), not a ghost row each                                                                                                                                                                  | `encounters/[id]/page.tsx` (`mapRowNote`)                                               |
| **Card that drops what is obvious** | a finished tournament card shows no status pill and no progress bar                                                                                                                                                                              | `tournaments/components/TournamentCard.tsx`                                             |
| **Search highlight**                | `<mark className={MARK_CLASS}>` on the matched token                                                                                                                                                                                             | `_views/tournamentTeams.model.ts`                                                       |
| **Inline roster**                   | role glyph + nick, captain crown, in one truncating caption line                                                                                                                                                                                 | `TeamListRow.tsx`                                                                       |

## 9. States

- **Skeleton first.** The skeleton draws the final layout (same grid, same
  rows) so nothing reflows when data lands.
- **Three states, always.** `empty` (nothing exists), `error` (could not load)
  and `filtered-empty` (filters exclude everything, always with a reset). A
  query that can fail destructures `isError`; showing `empty` on failure is a
  lie.
- A background refetch shows `UpdatingBadge`; a failed refetch keeps the stale
  content and shows the error above it.
- Copy defaults come from `common.pageState.*`; override only when the page
  can say something more specific.

## 10. Motion

- Transitions: colour, border, opacity, `transform` for a chevron. ~150ms.
- No entrance animations, no staggered reveals, no perpetual loops — except
  the live pulse (`StatusDot pulse`, `.livePulse`) on something that is live.
- No hover that changes size or shifts layout.
- `prefers-reduced-motion` mutes all of it; the static cue (colour, border,
  word) always remains.

## 11. Content and data honesty

- **Numbers and dates** go through next-intl (`useFormatter()`,
  `getFormatter()` on the server). Never `Intl.NumberFormat("en-US")` or
  `toLocaleDateString("en-US")`: the default locale is `ru`.
- **Dates**: relative (`2d ago`) with the absolute date in `title`.
- **Low-sample gate**: percentiles and vs-average comparisons hide below 10
  games (`LOW_SAMPLE_GAMES`): an em dash, the rule in `title`.
- **No invented data**: no SR/MMR where the system has none, no fabricated
  per-hero stats, no "seasons" — tournaments only.
- **Encounter ⊃ matches**: an encounter is the series (3–1), its matches are
  maps. Never label an encounter with one map's name. A parsed log's score is
  oriented to the encounter's sides (`encounterSideScore` in
  `lib/encounter/detail.ts`) before it is shown or compared.
- **Mix tournaments**: a player has no permanent team.
- **Truncation**: `truncate` plus the full value in `title`.
- **Roles**: icon only in rows and tables (name in `title`/`aria-label`); icon
  - word only in a role split; text only in a meta line. Divisions: icon only,
    name in `title`.
- **Hero avatar sizes**: 30px stacks, 24px compact rows, 26px in tables, 32px
  single.
- **No encoding captions** ("bar = …", "lower is better"): if the encoding
  needs a caption, change the encoding.
- One term per metric (Closeness, not Proximity).

## 12. Accessibility floor

- Visible `:focus-visible` on everything interactive (2px teal, inset inside
  rows and cards).
- Every icon-only control has an accessible name; decorative icons are
  `aria-hidden`.
- No emoji or bare glyphs (`←`, `✓`, `×`) as icons — `lucide-react` with
  `aria-hidden` (lint rule R5).
- No `<div onClick>` / `<span role="button">`: a link is `<a>`, an action is
  `<button>` (lint rule R7).
- Every hover popover also opens on focus and tap.
- `--aqt-fg-faint` is the minimum text colour on `--aqt-bg`; 12px is the
  minimum size for anything meant to be read.
- A wide table gets its own labelled `overflow-x-auto` region (`tabIndex={0}`),
  never `overflow: hidden`.
- Verify names with the browser's accessibility tree, not by reading JSX.

## 13. Public marketing pages

`/` and `/get-workspace` keep the dark theme, teal accent, content and section
order. `SectionStack` is contained at `max-w-7xl` with responsive 56–96px
section gaps. `HeroFrame variant="plain"` uses `--aqt-bg-2` without the accent
hairline or corner glow; the home hero adds a near-black `135deg` gradient
from `--aqt-bg-2` to `--aqt-bg` inside the same 1px frame.

`Showcase` stacks its caption above the real screenshot, caps body copy at
65ch and fades the bottom from 75%. The community form keeps its name/slug
contract: the host and `/workspace/` prefix sit in a wrapping URL preview
below the full-width slug input. Inputs use 16px text, 48px shells, visible
focus/invalid states. Repeated section eyebrows are omitted.

`DirectoryRail` uses borderless ghost controls with 20px icons, 1.5px strokes
and 44px hit targets; desktop arrows sit in reserved gutters, pause/play next
to pagination; below `md` pagination takes a full row and the controls sit
under it.

## 14. Admin kit

`/admin` is one product with one shape. Every screen is an instance of exactly
one of seven templates, assembled from `components/kit/*`,
`components/data-table/*` and `components/ui/*`. Pages do not write layout or
colour of their own. A screen that needs a shape no template has is a sign
the IA is wrong — say so before inventing a surface.

| #   | Template      | Structure                                                                                                                                | Used by                                                                                                                           |
| --- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Dashboard     | greeting + one next action → KPI strip → two columns: "work" / "attention"                                                               | `/admin`                                                                                                                          |
| T2  | Browser       | header → filter bar (search + chips) → table with an always-visible kebab → Inspector (`?id=`) with "Open page" when the row has a route | Tournaments, People, Teams, Matches, Achievements, Members, `content/*`, `access/*`, Audit, hub Registration entries, hub Matches |
| T3  | Hub           | entity header (name, status, metrics, 1–2 actions) → routed tabs → optional routed sub-tabs → body                                       | tournament hub, `people/[id]`, `teams/[id]`, `achievements/[id]`                                                                  |
| T4  | Master-detail | sortable list left (`+ Add`) → editor right; destructive actions in a menu, one parameterised confirm                                    | bracket stages, pre-game phase scopes, access roles; Divisions draft editor (full-screen variant)                                 |
| T5  | Settings      | section nav left → the section's form → sticky save bar while dirty                                                                      | `/admin/settings/*`, tournament `settings/*`, `workspaces/[id]/*`, collector settings                                             |
| T6  | Wizard        | step rail → step body → footer (Back · Save draft · Continue)                                                                            | new workspace, new tournament, draft setup, divisions import, Challonge sync                                                      |
| T7  | Control room  | status hero (phase, timer, connection) → current action + lifecycle buttons → right column (presence, feasibility)                       | live draft                                                                                                                        |

Rules on every admin screen:

- **Row detail has one answer per case.** Up to ~6 editable fields →
  `EntityFormDialog`. Read-only investigation → `Inspector`. Editable _and_
  shareable → its own route. T2 defaults to the Inspector.
- **One filter surface.** `FilterBar` above the table; nothing in the header,
  no `<Select>` in the toolbar.
- **One tab look.** Routed tabs are `LinkTabs`; non-address tabs are
  `ui/tabs.tsx`; a view switch is a `ToggleGroup`, never a hand-rolled
  `<nav>` of pills.
- **One row-actions convention.** `createKebabColumn`
  (`data-table/kebab-column.tsx`). An action the reader may not perform is
  _absent_, never disabled; the menu is always visible.
- **At most three dialogs per screen**: `EntityFormDialog`, one
  `ConfirmDialog` with a swapped `intent`, at most one domain dialog.
- **All three page states**, through `PageStateCard`; the first load is a
  skeleton, never the empty state.
- **State lives in the URL** (`useQueryParams` / `kit/useFilters.ts`). Depth
  stays at three: sidebar → screen → (sub-tab | inspector).
- **Chips in admin follow §4 exactly.** A lifecycle state that needs
  attention → `kit/StatusPill`; the default or finished state of a row
  (active, verified, published, done, processed, completed, accepted,
  connected, monitoring) renders _nothing_, because on a list where most rows
  are in that state the absence of a pill says it. One pill per row, in the
  status column only. A boolean → `StatusIcon`, shown for the exception, not
  the norm. A category (role, kind, scope, provider, format, type, mode,
  class, direction) is plain text; a count beside a heading is plain text; an
  id is plain text. `Badge` is not an admin primitive: the only chip that is
  not a status is a chosen entity shown as a removable `FilterChip`.
- **No metric strip above a table.** `StatTile` lives on the dashboard (T1)
  and on a collector's health page. A count that restates the table below, a
  filter chip's count or a checklist row is said once, there.
- **A fact is shown once per screen.** The hub header carries the status;
  the body does not repeat it in a pill, a `Select` value, a strip and a
  checklist row. An inspector repeats nothing the row already shows.
- **Helper copy earns its line.** No `description` under a heading that
  restates the heading or lists the tabs below it; no placeholder equal to its
  label; no "Yes/No" for a boolean; no `—` or `-` for a missing value (render
  nothing); no raw API enum on screen.

| Component                                    | Owns                                                           |
| -------------------------------------------- | -------------------------------------------------------------- |
| `kit/LinkTabs.tsx`                           | routed tabs and sub-tabs                                       |
| `kit/FilterBar.tsx` + `kit/useFilters.ts`    | the filter surface and its URL state                           |
| `kit/Inspector.tsx`                          | row detail: right panel at `lg`+, a sheet below                |
| `kit/InspectorField.tsx`                     | a labelled fact and a titled group inside an inspector or detail dialog; no local `Field` copies |
| `kit/ConfirmDialog.tsx`                      | every confirmation                                             |
| `kit/SectionNav.tsx`                         | T5 navigation (`<nav>` at `md`+, `Select` below)               |
| `kit/SaveBar.tsx` + `kit/useUnsavedGuard.ts` | dirty-form save/discard and the leave guard                    |
| `kit/WizardShell.tsx`                        | T6 frame                                                       |
| `kit/EntityHubHeader.tsx`                    | T3 header (title, status pill, middot-joined metrics, actions) |
| `kit/PhaseStrip.tsx`                         | lifecycle position, indicator only                             |
| `kit/MasterDetail.tsx`                       | T4 split with the narrow-viewport switch                       |
| `kit/NextActionHero.tsx`                     | the single "do this next" on T1 and hub Overview               |
| `kit/tone.ts` / `ui/tone.ts`                 | `TONE_CLASS` / `TONE_TEXT` tint recipes                        |
| `admin/AdminDetailTable.tsx`                 | styling for a dense table inside an editor, not a browser      |

## 15. Never

- A chip outside the four jobs in §4, more than two in a header, or one that
  repeats nearby text.
- The same fact twice in one view (title and row, score and "Winner" pill,
  `#1` and "1st place").
- A card inside a card; a tinted callout or coloured left border inside a
  card.
- A control with no choice (one filter, one tab, one view).
- Raw hex, Tailwind neutrals, `text-[Npx]`, a font size below 12px, a
  tracking other than `tracking-label` on uppercase text.
- Uppercase user content; `font-mono` on UI labels.
- A "finished/completed" status pill on a list of mostly finished items.
- Colour as decoration: gradient text, decorative glows, the role spectrum as
  a background.
- Emoji or glyphs as icons; `<div onClick>`; a native `<select>`.
- Hover that scales or shifts layout; entrance animations; perpetual loops
  on anything that is not live.
- A spinner where a skeleton fits; `empty` shown for a failed load.
- Hand-rolling a primitive listed in §6.

## 16. Before you open a PR

- [ ] Every chip on the screen maps to one of the four jobs in §4.
- [ ] No fact appears twice in one view.
- [ ] Every control offers a real choice.
- [ ] Tokens only; type roles only; `npm run lint:design` passes.
- [ ] Skeleton matches the layout; `empty`, `error`, `filtered-empty` all
      render.
- [ ] Checked at 390 / 768 / 1024 / 1440; no horizontal page scroll.
- [ ] Everything interactive has hover, visible focus and an accessible name.
- [ ] Reused the §6 primitives; nothing hand-rolled that already exists.
