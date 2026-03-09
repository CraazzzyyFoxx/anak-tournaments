# AQT: Design Approach

This document describes the UI/UX principles used in AQT (Anak tournament statistics) and acts as the reference when adding new pages and components.

Anchor pages that define the product's visual language:

- `frontend/src/app/page.tsx` - Dashboard home: modular analytics, stable grids, predictable states.
- `frontend/src/app/users/[slug]/page.tsx` - User profile: a richer hero header and "Liquid Glass" as an accent.

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

### Typography

- Base font is Inter (via next/font) in `frontend/src/app/layout.tsx`.
- Use `tabular-nums` for metrics where stable alignment matters.
  Examples: `frontend/src/components/StatisticsCard.tsx`, `frontend/src/app/users/components/UserHeader.tsx`.

## Core building blocks

### Card as the standard container

Cards are the default pattern for content blocks:

- consistent radius/border/shadow
- consistent structure: header -> content -> footer

Implementation: `frontend/src/components/ui/card.tsx`.

Important: `Card` sets `data-ui="card"`. This is used for theming (notably Liquid Glass). Do not remove or rename this attribute.

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

The home page (`frontend/src/app/page.tsx`) uses simple, stable grids:

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

- Home skeletons: `frontend/src/app/home-skeletons.tsx`.
- User profile skeletons: `frontend/src/app/users/[slug]/page.tsx`.

Goal: reduce perceived latency and prevent content jumping.

### Errors

On request failure, render a Card with a short message, without breaking grids.
Example pattern: try/catch fallbacks in `frontend/src/app/page.tsx`.

### Empty data

Tables/lists should explicitly render "No data" (or equivalent).
Example: `frontend/src/components/ChampionsTable.tsx`.

## Liquid Glass: where and how to use it

Liquid Glass is an accent style for user-centric views (profiles). It is not the default look of the entire app.

### How it works

- Context + CSS variables: `frontend/src/app/users/components/UserLiquidGlassProvider.tsx`.
- Theming hooks via `data-ui` selectors: `frontend/src/app/globals.css` (utilities under `.liquid-glass ...`).
- Profile header panel: `liquid-glass-panel` in `frontend/src/app/users/components/UserHeader.tsx`.
- Aura personalization: `frontend/src/app/users/components/UserAuraReporter.tsx` extracts dominant colors (avatar + division icon) and sets `--lg-a/--lg-b/--lg-c`.

### Usage rules

- Use on profile-like pages where identity and "presence" matters.
- Do not apply everywhere (home and list pages should remain clean and metric-focused).
- Blur/shadows must not reduce text contrast or legibility.

## Content: numbers, density, readability

### Numbers

- Format large numbers using `Intl.NumberFormat`.
  Example: `frontend/src/components/StatisticsCard.tsx`.
- Use `tabular-nums` for metrics.

### Truncation

- Long names/handles should use `truncate` and keep the full value in `title`.
  Example: `frontend/src/app/users/components/UserHeader.tsx`.

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

- Emoji used as UI icons.
- Hover effects that shift layout (scale/size changes instead of color/opacity).
- Mixing inconsistent container widths/paddings within one page.
- Rendering content without skeletons, causing layout jumps.
- Clickable surfaces without cursor/hover/focus affordances.

## PR checklist

- No emoji icons; use a consistent icon set.
- Everything interactive has hover + visible focus.
- Loading uses skeletons; layout stays stable.
- Errors do not break the grid; messaging is clear.
- No horizontal scroll on mobile; touch targets are reasonable.
- Contrast stays readable on dark theme (and on Liquid Glass surfaces).
