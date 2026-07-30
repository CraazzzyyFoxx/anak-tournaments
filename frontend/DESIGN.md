# AQT: Design Approach

This document describes the UI/UX principles used in AQT (Anak tournament statistics) and acts as the reference when adding new pages and components.

Anchor pages that define the product's visual language:

- `frontend/src/app/(site)/(home)/page.tsx` - Dashboard home: modular analytics, stable grids, predictable states.
- `frontend/src/app/(site)/users/[slug]/page.tsx` - User profile: a richer hero header.
- `frontend/src/app/(site)/tournaments/page.tsx` - List page: hero + filters + one scrollable table.

## TL;DR

- Data-first UI: every screen answers a concrete question.
- Card-first layout: `Card` is the default container for blocks.
- States over effects: skeleton-first loading, clear error/empty states, minimal layout shift.
- Dark theme by default; colors come from tokens (CSS variables), not ad-hoc hex values.
- Liquid Glass is used selectively (profiles), not as a global style.

## Why this approach

AQT is an analytics product. Users typically want to:

- understand the overall picture quickly (home dashboard)
- drill down from metrics into details (charts/tables -> tournaments/matches)
- evaluate a specific player (user profile)

Design priorities follow those goals:

- readability of numbers, tables, and charts
- predictable navigation and layout
- minimal decoration where it would compete with data

## Foundations: tokens, theme, typography

### Theme and tokens

- Tokens live in `frontend/src/app/globals.css` (CSS variables for background/foreground/card/border/etc).
- Tailwind maps to those tokens in `frontend/tailwind.config.ts`.
- Dark theme is enabled by default (class `dark` on body) in `frontend/src/app/layout.tsx`.

Principle: components should rely on semantic tokens (`bg-background`, `bg-card`, `text-muted-foreground`, `border-border`, ...) instead of inventing new colors.

Two token families coexist and must not be confused:

- shadcn tokens (`--background`, `--card`, `--border`, ...) hold bare **HSL
  triplets**, because Tailwind wraps them as `hsl(var(--card))`.
- `--aqt-*` tokens hold **complete colors** (`hsl(220 22% 8%)`), used directly.

Never redefine a shadcn token name inside a scoped block. A rule like
`.my-scope { --card: var(--aqt-card) }` makes `hsl(var(--card))` resolve to
`hsl(hsl(...))`, which is invalid — every shadcn surface inside that scope
silently renders transparent with a `currentColor` border. Scoped aliases must
use their own prefix (`--tn-card`, `--u-fg`, ...).

Never use raw hex, `white/N`, `slate-*` or `zinc-*`: workspace theming
(`WorkspaceThemeSync`) cannot reach them, so white-label tenants render
half-themed. Arbitrary Tailwind color values need the `color:` hint —
`text-[color:var(--aqt-fg)]`, never `text-[var(--aqt-fg)]`, which is ambiguous
with `font-size` in Tailwind v4.

### Typography

- Base font is Inter (via next/font) in `frontend/src/app/layout.tsx`.
- Use `tabular-nums` for metrics where stable alignment matters.
  Examples: `frontend/src/components/StatisticsCard.tsx`, `frontend/src/app/(site)/users/components/header/UserHeader.tsx`.

## Core building blocks

### Card as the standard container

Cards are the default pattern for content blocks:

- consistent radius/border/shadow
- consistent structure: header -> content -> footer

Implementation: `frontend/src/components/ui/card.tsx`.

Important: `Card` sets `data-ui="card"`. This is used for theming (notably Liquid Glass). Do not remove or rename this attribute.

### Shared primitives — use these, do not re-roll them

Every one of these replaced three to six hand-rolled copies. Reach for them
before writing markup:

| Need | Use |
| --- | --- |
| Filter chip | `components/ui/filter-chip.tsx` — `<FilterChip active count>` inside `<FilterChipGroup label>` |
| Search input | `components/ui/search-field.tsx` — `label` is required (a placeholder is not a label) |
| Pagination | `components/ui/data-pagination.tsx` — windowed, `aria-current`, real chevrons |
| Empty / error / not-found | `components/ui/page-state-card.tsx` |
| Data table | `components/ui/data-table.tsx` — header scope, scroll region, skeletons, keyboard rows |
| Placement medal | `components/ui/place-badge.tsx` — `--aqt-medal-*` tokens |
| Platform totals | `components/stats/PlatformStatsGrid.tsx` |
| Filter/sort/page in the URL | `hooks/useQueryParams.ts` |

### Tabs, Button, and other primitives

- Tabs: `frontend/src/components/ui/tabs.tsx` (Radix) with visible `focus-visible` rings.
- Buttons: `frontend/src/components/ui/button.tsx` (CVA) with focus/disabled states.

Principle: any new primitive must preserve:

- visible focus states
- reasonable touch targets (typically 36px+ height, 44px+ for primary actions on mobile)
- predictable hover/active behavior

## Layout and responsive behavior

### Global container

The app container is defined in `frontend/src/app/layout.tsx`:

- max width: `max-w-screen-3xl`
- horizontal padding: `px-4 md:px-6 xl:px-10`

Principle: AQT is "wide analytics". Tables and charts should not feel cramped.

### Grids

The home page (`frontend/src/app/(site)/(home)/page.tsx`) uses simple, stable grids:

- stats: `lg:grid-cols-4`
- charts: `lg:grid-cols-2`
- tables/cards: `xl:grid-cols-4` + `col-span-*` where needed

Principle: grids must remain stable during loading and error states.

### Breakpoints

Custom breakpoints (including `xs`) are defined in `frontend/tailwind.config.ts`.

Principle: verify 375px / 768px / 1024px / 1440px. Avoid horizontal scrolling.

## Navigation and context retention

### Sticky header

Header is sticky:

- `frontend/src/components/Header.tsx` uses `sticky top-0 z-50`

Principle: navigation and search stay accessible without hiding content.

### Sticky profile tabs

User profile tab list is sticky:

- `frontend/src/app/users/components/UserTabsClient.tsx` uses `sticky top-14 z-40`

Principle: tab switching should not jump the layout. The active tab syncs to URL query params (`?tab=`), so links are shareable.

## States: loading, errors, empty data

### Skeleton-first

Prefer skeletons that preserve layout over centered spinners.

- Dashboard skeletons (home, `/statistics`, `/workspace/[slug]`): `frontend/src/components/skeletons/dashboard-skeletons.tsx`.
- User profile skeletons: `frontend/src/app/users/[slug]/page.tsx`.

Goal: reduce perceived latency and prevent content jumping.

### Errors, empty and not-found

There is exactly one surface for these: `frontend/src/components/ui/page-state-card.tsx`.

```tsx
<PageStateCard state="error" onAction={refetch} />
<PageStateCard state="filtered-empty" onAction={clearFilters} />
<PageStateCard state="empty" />
```

Rules:

- A query that can fail MUST destructure `isError` and render the `error` state.
  Rendering the empty state on failure tells the user "there is nothing here"
  when the truth is "we could not load it" — never do this.
- Distinguish `empty` (nothing exists) from `filtered-empty` (filters exclude
  everything). The latter always offers a way out.
- Copy defaults come from the `common.pageState.*` messages; override only when
  a page can say something more specific.

## Liquid Glass

Only two class names survive: `liquid-glass-panel` and `liquid-glass-surface`
(`frontend/src/app/globals.css`). They are thin surface aliases — a border, a
radius and a card background. There is no blur, no context provider and no
per-user aura.

The previous system (a React context writing `--lg-a/--lg-b/--lg-c`, plus an
"aura reporter" that sampled avatar colors) was removed: no CSS rule ever read
those variables, so every inline `style={{ "--lg-a": ... }}` was inert markup.
Do not reintroduce them.


## Content: numbers, density, readability

### Numbers

- Format numbers and dates through next-intl (`useFormatter()`, or
  `getFormatter()` on the server). Never construct `Intl.NumberFormat("en-US")`
  or call `toLocaleDateString("en-US")`: the app's default locale is `ru`, and a
  pinned formatter puts an English date next to a Russian one in the same table
  row. `formatDateRange` in `lib/utils.ts` takes `locale` as a **required**
  argument for exactly this reason.
- Use `tabular-nums` for metrics.

### Truncation

- Long names/handles should use `truncate` and keep the full value in `title`.
  Example: `frontend/src/app/(site)/users/components/header/UserHeader.tsx`.

### Density

- Default density is "analytics comfortable": readable, not marketing-spacious.
- Tables can be denser, but do not sacrifice touch targets.

## Accessibility baseline (required)

We treat accessibility as a default constraint:

- visible focus rings on interactive elements
- `aria-label` for icon-only controls
- meaningful `alt` text for images (avatars/logos)
- adequate touch targets for primary actions

References:

- Focus patterns in `frontend/src/components/ui/tabs.tsx` and `frontend/src/components/ui/button.tsx`.
- `sr-only` usage in `frontend/src/components/Header.tsx`.

## Performance and UX smoothness

- Suspense + skeletons instead of blocking loading states.
- Use `cache()` for repeated server-side requests within a render.
  Example: `frontend/src/app/users/[slug]/page.tsx` (getUserAndProfile).
- Use `next/image` for images.
- Keep client components only where interaction is required.

## How to build a new page

Suggested process:

1. Define 1-2 key questions the page answers.
2. Split the page into independent blocks (usually Cards).
3. For each block: loading (skeleton), error (message Card), empty (explicit state).
4. Verify responsive layout: 375px/768px/1024px/1440px.
5. Verify keyboard navigation: tab order and visible focus.

## Anti-patterns to avoid

- Emoji or bare glyphs (`←`, `→`, `↑`, `✓`, `×`, `‹`) used as icons: screen
  readers read them literally. Use `lucide-react` with `aria-hidden`.
- `<div onClick>` / `<span role="button">` for navigation or actions. A `<tr>`
  is not a link; put a real `<a href>` in the row. Note that a `<tr>` is also
  not a valid containing block for an absolutely positioned overlay link — the
  overlay escapes its scroll container and scrolls the whole document sideways.
- Hover effects that shift layout (scale/size changes instead of color/opacity).
- Mixing inconsistent container widths/paddings within one page.
- Rendering content without skeletons, causing layout jumps.
- Clickable surfaces without cursor/hover/focus affordances.

## PR checklist

- No emoji icons; use a consistent icon set.
- Everything interactive has hover + visible focus.
- Loading uses skeletons; layout stays stable.
- Errors do not break the grid; messaging is clear.
- No horizontal scroll at 375px: measure `document.documentElement.scrollWidth`
  against `innerWidth`, do not eyeball it. A wide table needs its own
  `overflow-x: auto` region (labelled, `tabIndex={0}`) — clipping it with
  `overflow: hidden` hides columns instead of making them reachable.
- Touch targets are at least 24x24.
- Every interactive element has an accessible name. Verify with the browser's
  accessibility tree, not by reading the JSX.
- Contrast stays readable on dark theme (and on Liquid Glass surfaces).
