# Админ-панель: план реализации редизайна

Исполнителю (агенту или человеку). Документ самодостаточен, но опирается на:

- `01-ia.md` — утверждённая IA, карта переезда роутов, 7 шаблонов, разборка сложных экранов, §9 референс Divisions.
- `02-wireframes.html` — 20 каркасов с аннотациями (F0–F18). Номера кадров ниже — оттуда.
- `inventory/*.md` — что есть сейчас, по файлам и строкам.
- `docs/design-book.md`, `frontend/DESIGN.md` — визуальный язык Editorial Tactical и правила токенов. Обязательны к прочтению до P0.
- `Divisions Admin (offline).html` (корень репо) — hi-fi референс редактора дивизионов.

## 0. Как работать с планом

**Порядок.** Фазы P0 → P1 → (P2 ∥ P3 ∥ P4 ∥ P5) → P6. Внутри фазы work units (WU) помечены зависимостями; всё без пометки `after:` параллелится. P2–P5 независимы друг от друга после P0+P1.

**Definition of done для WU** — все пункты, без исключений:

1. Новый роут отдаёт экран; старый роут — HTTP-редирект из `frontend/next.config.mjs` `redirects()` (не `redirect()` в page — см. комментарий там же).
2. Экран — экземпляр одного шаблона T1–T7 и собран только из kit-компонентов P0 + существующих `components/ui/*`. Никаких новых ad-hoc табов/тулбаров/шитов.
3. Состояние (таб, вид, фильтры, `id` инспектора) — в URL через `useQueryParams` (`frontend/src/hooks/useQueryParams.ts`).
4. `rtk npm run typecheck` чистый; `rtk npm run lint:design` чистый (правила R1–R7 в `frontend/scripts/check-design-compliance.mjs`); `rtk vitest run <files>` для затронутых тестов.
5. Behavior-тест `*.behavior.test.tsx` рядом с экраном на: гейт прав, URL↔состояние, один ключевой сценарий действия. Конвенция и примеры: `frontend/src/app/admin/players/page.behavior.test.tsx`, `frontend/src/components/admin/AdminDataTable.filters.behavior.test.tsx`.
6. Проверка в браузере на 375 / 768 / 1280 / 1440: `document.documentElement.scrollWidth <= innerWidth`, все интерактивные элементы имеют accessible name (смотреть accessibility tree, не JSX).
7. Удалён старый код, который заменил WU (компоненты, роуты, тесты старых роутов). Никаких `@deprecated`-реэкспортов.

**Что не трогать.** Backend, кроме явно перечисленных gaps (§7). Public site `(site)/*`. Query-keys и сервисы (`frontend/src/services/*`) — только добавлять методы. Логику прав (`usePermissions`, `lib/admin-permissions.ts`) — переезжает как есть. Новые npm-зависимости — не нужны (dnd-kit, cmdk, radix, tanstack уже есть).

**Команды.** Всегда через `rtk`: `rtk npm run typecheck`, `rtk vitest run path`, `rtk npm run lint:design`, `rtk next build` в конце фазы.

## 1. Зафиксированные решения

### 1.1 Карта роутов (финальная)

| Новый роут | Шаблон | Старые роуты → 308 |
|---|---|---|
| `/admin` | T1 | — |
| `/admin/tournaments` | T2 | — |
| `/admin/tournaments/new` | T6 | — |
| `/admin/tournaments/[id]/overview` | T3 | `/admin/tournaments/[id]` → overview (уже есть) |
| `/admin/tournaments/[id]/registration/{entries,form,feed,rank-autofill}` | T3+T2 | `/registration` → `/registration/entries` |
| `/admin/tournaments/[id]/teams/{roster,draft}` | T3+T2 / T6+T7 | `/teams` → `/teams/roster`; `/draft` → `/teams/draft` |
| `/admin/tournaments/[id]/bracket?stage=` | T4 | `/stages` → `/bracket` |
| `/admin/tournaments/[id]/matches/{encounters,standings,reports,parsed,logs}` | T2 | `/matches/results` → `/matches/encounters`; `/matches/maps` → `/matches/parsed`; `/matches/report-form` → `/settings/report-form` |
| `/admin/tournaments/[id]/settings/{general,rules,schedule,roster,pre-game,report-form,links,challonge,discord,preview,danger}` | T5 | `/settings` → `/settings/general`; `/pickBan` → `/settings/pre-game`; `/links` → `/settings/links` |
| `/admin/people`, `/admin/people/[id]` | T2 / T3 | `/admin/users` → `/admin/people`; `/admin/players` → `/admin/people` |
| `/admin/teams`, `/admin/teams/[id]` | T2 / T3 | — |
| `/admin/matches?view=` | T2 | `/admin/encounters` → `?view=encounters`; `/admin/match-reports` → `?view=reports`; `/admin/matches` (parsed) → `?view=parsed`; `/admin/standings` → `?view=standings` |
| `/admin/achievements`, `/admin/achievements/[id]` | T2 / T3 | — |
| `/admin/settings/{general,branding,visibility,domain,discord,divisions,statuses,sub-roles,subscriptions}` | T5 | `/admin/divisions` → `/settings/divisions`; `/admin/balancer` → `/settings/statuses`; `/admin/sub-roles` → `/settings/sub-roles`; `/admin/settings` (старый) → `/admin/collectors/rank?tab=settings` |
| `/admin/settings/divisions/v/[versionId]` | T4 (полноэкранный) | — |
| `/admin/settings/divisions/import` | T6 | — |
| `/admin/members` | T2 | `/admin/workspaces/members` → `/admin/members` |
| `/admin/content/{heroes,maps,gamemodes,unresolved}` | T2 | `/admin/heroes` и т.д.; `/admin/aliases` → `/content/unresolved` |
| `/admin/collectors/{rank,subscriptions,streams}?tab=status\|history\|settings` | T2/T5 | `/admin/rank` → `/collectors/rank` и т.д. |
| `/admin/access/{accounts,roles,permissions,api-keys,oauth,sessions}` | T2/T4 | `/admin/access` → `/access/accounts`; `/access/users` → `/access/accounts` |
| `/admin/workspaces`, `/admin/workspaces/[id]/{те же секции, что /admin/settings}` | T2 / T5 | — |
| `/admin/audit` | T2 | — |
| удалить | — | `/admin/pickup` → `/balancer/pickup` (308 в next.config) |

Все редиректы `permanent: true`, кроме тех, где путь может ещё измениться в этом же плане (нет таких — IA утверждена).

### 1.2 Контракт URL-параметров

| Параметр | Где | Значение |
|---|---|---|
| `view` | T2-браузеры с несколькими видами (`/admin/matches`) | ключ вида; дефолт — первый |
| `tab` | Collectors, любой T3, чьи табы не роуты (People/[id], Team/[id], Achievement/[id]) | ключ таба |
| `id` | любой T2 | открытая строка в Inspector; отсутствует — Inspector закрыт |
| `stage` | Bracket (T4), scope-чип в Matches | id стадии |
| `scope` | Pre-game phase | `tournament` \| `stage:N` \| `round:N` \| `encounter:N` |
| `tournament`, `status`, `role`, … | фильтры T2 | как сейчас `TOURNAMENT_QUERY_PARAM` в `components/admin/tournament-filter.tsx`; расширяем на все чипы |
| `page`, `q`, `sort` | T2 | уже пишет `AdminDataTable` |

Табы хаба турнира и под-табы — сегменты пути, не параметры (SEO не важен, важна `Link`-навигация и `layout.tsx` на уровень).

### 1.3 Правила на всех экранах

- Детали строки: ≤ 6 редактируемых полей → `EntityFormDialog`; просмотр → `AdminInspector`; редактируемая шарабельная сущность → роут. Дефолт T2 — Inspector.
- Действия строки — только `createKebabColumn` (P0-4). `createRowActionsColumn` и `createEntityActionsColumn` удаляются в P6.
- Фильтры — только `AdminFilterBar` (P0-2). `TournamentFilterSelect` и header-funnel `AdminColumnFilter` удаляются в P6 (движок фильтров `AdminTableFilters` внутри таблицы остаётся — FilterBar пишет в него через `filters`/`onFiltersChange`).
- Табы — только `AdminTabs` (P0-1). ToggleGroup-табы, pill-nav в `access/layout.tsx`, ручной `<nav>` в `matches/layout.tsx` — удаляются.
- ≤ 3 диалогов на экран. Подтверждения — один `ConfirmDialog` с `intent`.
- Empty / error / filtered-empty — `components/ui/page-state-card.tsx`. `isError` обязательно обрабатывается.
- Toast — `lib/notify`. Иконки — lucide с `aria-hidden`.

## 2. Визуальный слой (этап 2 из исходной задачи)

Кит P0 реализует Editorial Tactical один раз; страницы стили не пишут. Правила из `docs/design-book.md`, применённые к админке:

| Аспект | Правило | Реализация |
|---|---|---|
| Поверхности | 4 ступени `--aqt-bg → --aqt-bg-2 → --aqt-card → --aqt-card-2`; вложенность — бордер/оверлей, не новый серый | Shell: `bg-background`; sidebar `bg-sidebar`; карточки `bg-card`; Inspector `bg-card` + `border-l border-border` |
| Бордеры | ровно три: `--aqt-border` (hairline), `-2` (hover), `-3` (active/focus) | Кит использует `border-border`, `border-border/…` не изобретаем |
| Текст | `--aqt-fg / fg-muted / fg-dim / fg-faint`; пол 11px | `EYEBROW_CLASS` из `components/admin/tone.ts` для всех мелких uppercase-лейблов |
| Акцент | одна бирюза `--aqt-teal` = `primary`; `--aqt-warm` только featured | Активный таб, активный пункт nav, primary-кнопка, focus ring. Статусы — `TONE_CLASS` (success/warning/danger/info), не бирюза |
| Типографика | Inter UI, Onest display/числа, JetBrains Mono данные | `font-display` для `EntityHubHeader` h1 и больших чисел `StatTile`; `font-mono tabular-nums` для id/счётов/дат в таблицах; Mono uppercase `tracking-wider` для эйбоу |
| Air over boxes | группировка hairline и воздухом; рамочная Card только для плотных данных | T1/T3-заголовки без карточек; таблицы и Inspector — карточки |
| Motion | одна входная анимация (Inspector slide-in 160ms), hover только цвет | `prefers-reduced-motion` глушит; запрещено `hover:scale` (R7) |
| Иконки | lucide 16/20px, `aria-hidden`, всегда с текстом кроме kebab (у него `aria-label`) | |
| Пустые/ошибки | `PageStateCard`, три состояния | |

Проверяется `rtk npm run lint:design` + визуальный smoke (скриншот каждого шаблона на 1280 в PR).

## 3. P0 — Kit (фундамент)

Каталог: `frontend/src/components/admin/kit/`. Каждый компонент — файл + `*.behavior.test.tsx`. Ничего из кита не зависит от доменных сервисов.

### P0-1 `AdminTabs` — routed tabs и sub-tabs

`kit/AdminTabs.tsx`

```ts
export interface AdminTabItem { key: string; label: string; href: string; badge?: number; hidden?: boolean }
export function AdminTabs(props: { items: AdminTabItem[]; activeKey: string; level?: 1 | 2; ariaLabel: string })
```

- `<nav aria-label>` + `<ul>` из `next/link` с `aria-current="page"`; `level=2` — вторая строка меньшего размера под первой (как F4).
- Не Radix Tabs (roving tabindex ломает вложенность — см. комментарий в `tournaments/[id]/matches/layout.tsx`). Стрелки ←→ между табами — реализовать вручную.
- На узком экране — горизонтальный скролл без переноса (F18), активный таб `scrollIntoView` при монтировании.
- Badge — число очереди (`tabular-nums`), не аннотация.

Тест: `aria-current` на активном; скрытые не рендерятся; стрелки переводят фокус.

### P0-2 `AdminFilterBar` + `useAdminFilters`

`kit/AdminFilterBar.tsx`, `kit/useAdminFilters.ts`

```ts
export type FilterDef =
  | { key: string; label: string; kind: "single"; options: { value: string; label: string; count?: number }[] }
  | { key: string; label: string; kind: "multi"; options: … }
  | { key: string; label: string; kind: "toggle" }           // булев чип
  | { key: string; label: string; kind: "entity"; search: (q: string) => Promise<{ value: string; label: string }[]> }; // турнир, команда, игрок — через существующие *Combobox

export function useAdminFilters(defs: FilterDef[]): { values: Record<string,string|string[]|boolean>; set(key, v): void; clear(): void; toTableFilters(): AdminTableFilters; filterKey: string }
export function AdminFilterBar(props: { defs: FilterDef[]; filters: ReturnType<typeof useAdminFilters>; search?: { placeholder: string; value: string; onChange(v): void }; pinned?: { key: string; label: string }[]; presets?: { label: string; values: Record<string,unknown> }[]; trailing?: ReactNode })
```

- Активные чипы с `×`; неактивные — `+ Filter` popover (cmdk Command) со списком `defs`.
- `pinned` — чип без `×` (tournament внутри хаба, F8).
- `presets` — «Saved» чипы (F2 ·3), хранение в localStorage под ключом экрана; фаза 1 без backend.
- Всё состояние — URL через `useQueryParams({ resetOnChange: ["page","id"] })`.
- Внутри переиспользовать `components/ui/filter-chip.tsx` (`FilterChip`, `FilterChipGroup`) — визуал уже есть; `AdminFilterChips` удаляется в P6.

Тест: чип → URL; reload восстанавливает; `clear` снимает всё и сбрасывает page.

### P0-3 `AdminInspector`

`kit/AdminInspector.tsx`

```ts
export function AdminInspector(props: { openId: string | null; onClose(): void; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; onPrev?(): void; onNext?(): void; openHref?: string })
```

- На `≥ lg` — правая панель 360–400px внутри контента (grid `1fr 380px`, таблица сжимается — F2, не оверлей); на `< lg` — `components/ui/sheet.tsx` на весь экран.
- `openId` читает/пишет `?id=` вызывающий экран через `useQueryParams`; компонент только рендерит.
- Клавиши: `Esc` закрыть, `↑/↓` — `onPrev/onNext` (переход по строкам текущей страницы).
- `openHref` → кнопка «Open page» (когда у сущности есть роут).
- Focus-trap только в sheet-режиме; в panel-режиме фокус переходит в заголовок при открытии, возвращается в строку при закрытии.

Тест: `Esc` вызывает `onClose`; `openHref` рендерит ссылку; sheet-режим при узком viewport (mock `matchMedia`).

### P0-4 `createKebabColumn` + `ConfirmDialog(intent)`

`kit/kebab-column.tsx`

```ts
export function createKebabColumn<T>(items: (row: T) => Array<{ label: string; icon?: LucideIcon; onSelect(): void; destructive?: boolean; hidden?: boolean; href?: string }>): ColumnDef<T>
```

- `DropdownMenu` (radix) c триггером-кнопкой `aria-label="Actions for {rowLabel}"`; всегда видим (`opacity` не трогаем).
- В `AdminDataTable.tsx` удалить hover-only логику для колонки `actions` (`opacity-0 group-hover:opacity-100`).

`kit/ConfirmDialog.tsx` — расширение `DeleteConfirmDialog`:

```ts
export function ConfirmDialog(props: { open; onOpenChange; intent: { title: string; description: ReactNode; confirmLabel: string; tone: "danger" | "warning" | "neutral"; cascade?: string[]; requireTyped?: string }; onConfirm(): Promise<void> | void; pending?: boolean })
```

- Один экземпляр на экран, `intent` меняется — заменяет 6 экземпляров `DeleteConfirmDialog` в `StageManager`.
- `DeleteConfirmDialog` остаётся тонкой обёрткой над `ConfirmDialog` до P6, затем удаляется (вызовы мигрируются WU-ами).

### P0-5 `AdminSectionNav` + `SaveBar` (T5)

`kit/AdminSectionNav.tsx`, `kit/SaveBar.tsx`

```ts
export function AdminSectionNav(props: { groups: { label?: string; items: { key: string; label: string; href: string; tone?: "danger"; hidden?: boolean }[] }[]; activeKey: string })
export function SaveBar(props: { dirty: boolean; summary: ReactNode; onDiscard(): void; onSave(): void; saving?: boolean; primaryLabel?: string; secondary?: ReactNode })
```

- Nav — `<nav>` слева 200px, на `< md` — `Select` сверху.
- `SaveBar` — `position: sticky; bottom: 0`, появляется при `dirty`; `beforeunload` guard и перехват `next/link` навигации — вынести из `EntityFormDialog.tsx` в `kit/useUnsavedGuard.ts` и использовать в обоих.

### P0-6 `WizardShell` (T6)

`kit/WizardShell.tsx`

```ts
export function WizardShell(props: { steps: { key: string; label: string; state: "done" | "current" | "todo" | "skipped" }[]; children: ReactNode; footer: { back?(): void; next?: { label: string; onClick(): void; disabled?: boolean }; secondary?: ReactNode }; aside?: ReactNode })
```

- Step rail слева (`<ol>` с `aria-current="step"`), контент, футер. `aside` — слот под rail (Past sessions в F5, «Import from Challonge instead» в F16).
- Шаг `skipped` рендерится приглушённым и без номера (Conflicts, когда не нужен).

### P0-7 `EntityHubHeader` + `PhaseStrip` (T3/T7)

`kit/EntityHubHeader.tsx`: `{ title; status?: { label; tone }; meta: ReactNode[] (через ·); actions?: ReactNode; backHref?: string }` — заменяет `TournamentWorkspaceHeader` и заголовки Team/Person/Achievement.

`kit/PhaseStrip.tsx`: `{ phases: { key; label; state: "done"|"current"|"todo" }[] }` — F3 степпер и F5/F6 фазы драфта. Чисто индикатор, без действий.

### P0-8 `MasterDetail` (T4)

`kit/MasterDetail.tsx`: `{ list: ReactNode; detail: ReactNode; listWidth?: number; emptyDetail?: ReactNode }` — grid `${listWidth}px 1fr`; на `< md` — показывает либо список, либо detail с кнопкой «‹ Back» (по наличию выбранного id в URL).

### P0-9 `NextActionHero`

`kit/NextActionHero.tsx`: `{ eyebrow; title: ReactNode; href; cta: string }` — F1 ·2, F3 ·3. Данные — первый незакрытый пункт `buildChecklist` (уже есть, `components/admin/dashboard/*` и `overview/LifecycleChecklist.tsx`).

### P0-10 Правки `AdminDataTable`

- Убрать hover-only на колонке `actions`.
- Пропс `inspectorId?: string | null` — подсветка выбранной строки (`aria-selected`).
- Пропс `toolbar?: ReactNode` (рендерится над таблицей, вместо `actions` справа от search) — сюда встаёт `AdminFilterBar`; встроенный search таблицы скрывается, когда передан `toolbar` с собственным search (`searchPlaceholder` не задан).
- Header-funnel (`AdminColumnFilter`) — оставить работоспособным до P6, но не использовать в новых экранах.
- Мобильный режим (`< md`): рендер строк карточками — `renderMobileCard?: (row) => ReactNode`; если не передан — первые 3 видимые колонки в карточку автоматически (F18 ·1).

### P0-11 Сайдбар-обновление (визуал)

`components/admin/AdminSidebar.tsx`: группы через `EYEBROW_CLASS`, badge-счётчики у пунктов (`item.badge?: () => number | undefined` — функция, чтобы читать из React Query: unresolved names, disputed reports), группа PLATFORM скрывается целиком, когда пуста. Данные групп — из P1-1.

Acceptance P0: все 11 компонентов с тестами; `rtk vitest run frontend/src/components/admin/kit`; демонстрационная страница не нужна — первый потребитель каждого компонента появляется в P1/P2.

## 4. P1 — Shell и навигация

### P1-1 `admin-navigation.ts` — новые группы

Переписать `adminNavigationGroups` по §3.1 `01-ia.md` (13 пунктов, группы `""`, `DATA`, `WORKSPACE`, `PLATFORM`). Поля `permissions/superuserOnly/workspaceAdminVisible/globalOnly` перенести с исходных пунктов:

| Пункт | Права (из текущего) |
|---|---|
| People | `user.read` (было Player identities) |
| Matches | `match.read` |
| Settings (workspace) | `workspaceAdminVisible: true` |
| Members | `workspaceAdminVisible: true` |
| Game content | `superuserOnly` |
| Collectors | `permissions: ["rank.read","subscription.read","stream.read"]` — `canAccessAdminRoute` уже трактует список как OR (`permissions.some`, `hooks/usePermissions.ts:171`), нового поля не нужно. `globalOnly` для streams остаётся на префиксе `/admin/collectors/streams` в `adminRoutePermissions`, не на пункте меню |
| Access | `accessAdminPermissions`, `workspaceAdminVisible` |

Обновить `adminRoutePermissions` под новые префиксы (таблица §1.1); старые префиксы удалить. `aliases` для палитры перенести (все прежние алиасы должны резолвиться в новые пункты — тест уже требует уникальности).

Тесты: `admin-navigation.test.ts`, `admin-navigation.owner.behavior.test.tsx` — переписать ожидания под новые группы; добавить кейс «PLATFORM пуст → группа отсутствует».

### P1-2 Редиректы

`frontend/next.config.mjs` `redirects()` — добавить все строки из §1.1. Хаб: с `:id`. Проверка: `rtk next build` + curl `-I` каждого старого пути на dev-сервере → 308 и правильный `Location`.

### P1-3 Breadcrumb registry

`AdminLayoutClient.tsx` `getBreadcrumbEntityRef` захардкожен на tournaments/teams. Вынести в `components/admin/breadcrumb-registry.ts`:

```ts
export const BREADCRUMB_ENTITIES: Record<string /*segment*/, (id: number) => readonly unknown[] /*queryKey*/> = { tournaments: …, teams: …, people: …, achievements: …, workspaces: … }
```

Имя читается из кеша (`skipToken`), как сейчас. Сегменты видов (`overview`, `entries`, …) — label через словарь `SEGMENT_LABELS`, не kebab→Title.

### P1-4 Shell layout

- Контент: оставить full-bleed (решение: админка — «wide analytics»), но добавить `max-w-[1720px] mx-auto` (= `screen-3xl`) на `#admin-content`, чтобы на 2560 не растягивать таблицы.
- Skip-link, `AuditTrailProvider` — без изменений.
- Заголовок страницы (`AdminPageHeader`) остаётся у страниц.

### P1-5 Command palette

`AdminCommandPalette.tsx` — источник групп меняется автоматически (P1-1). Добавить раздел «Views»: для пунктов с `views` (Matches, Content, Collectors, Access) палитра предлагает `Matches › Standings` и т.п. Данные видов — `AdminNavItem.views?: { key; label; href }[]`. Сущностный поиск — не в этом плане.

## 5. P2 — Хаб турнира

Все WU — `frontend/src/app/admin/tournaments/[id]/**`. Shell `TournamentHubShell.tsx` — единственная точка монтирования realtime (не менять).

### P2-1 Табы и guards

`tab-guards.ts`:

```ts
export const TAB_KEYS = ["overview","registration","teams","bracket","matches","settings"] as const;
export const REGISTRATION_SUB_TABS = ["entries","form","feed","rank-autofill"] as const;   // default entries
export const TEAMS_SUB_TABS = ["roster","draft"] as const;                                   // default roster; draft only if teamFormation==="draft"
export const MATCHES_SUB_TABS = ["encounters","standings","reports","parsed","logs"] as const; // default encounters
export const SETTINGS_SECTIONS = ["general","rules","schedule","roster","pre-game","report-form","links","challonge","discord","preview","danger"] as const;
```

`allowedTab`: `settings` → `canUpdateTournament`; `registration` → `canTeamRead`; остальное true. `allowedSettingsSection`: `pre-game` → `canUpdateEncounter`; `links` → `canReadTournamentLink`; `danger` → `canDeleteTournament`; остальные → `canUpdateTournament`. Старые ключи `draft/pickBan/links/logs/stages` удаляются (редиректы — P1-2).

`TournamentHubShell.tsx`: `TAB_BAR` → `AdminTabs level=1`; `TournamentWorkspaceHeader` → `EntityHubHeader` (status pill = текущая фаза из `PhaseStepper` данных; actions: Open analytics, `TournamentStatusControl` как dropdown).

Тесты: `tab-guards.test.ts` (новый, чистые предикаты); `TournamentHubShell` behavior: неразрешённый таб → replace на overview.

### P2-2 Overview

`overview/page.tsx`: `NextActionHero` (первый открытый пункт `buildChecklist`) → `PhaseStrip` (из `PhaseStepper.tsx`, контрол статуса убрать — он в header) → `LifecycleChecklist` (завершённые фазы свёрнуты, `Collapsible`) → 4 `StatTile` (Stages, Challonge, Discord, Log queue с `Progress`). Draft-live баннер остаётся, ссылка → `/teams/draft`.

### P2-3 Registration с под-табами

`registration/layout.tsx` (новый): `AdminTabs level=2` по `REGISTRATION_SUB_TABS`, guard как в `matches/layout.tsx` сегодня (переиспользовать логику, затем P2-5 удалит старый). `registration/page.tsx` → редирект в `entries`; `registration/entries/page.tsx` = текущий `registration/page.tsx`, где `RegistrationsTable` получает `toolbar={<AdminFilterBar …/>}` (чипы: admission, role, division, subscription verdict, include withdrawn), Inspector с анкетой/историей приглашений, bulk-полоса (F4 ·3) через `bulkActions` таблицы — рендерить `SaveBar`-подобной полосой снизу (`kit/BulkBar.tsx`, тот же стиль). `form/feed/rank-autofill` — без изменений содержимого.

### P2-4 Teams: roster + draft

`teams/layout.tsx` (новый): `AdminTabs level=2` roster/draft (draft скрыт при balancer). `teams/roster/page.tsx` = текущий `teams/page.tsx` (`TournamentTeamsTab.tsx`): Challonge-sync `Dialog` → `WizardShell` в `Dialog` (2 шага: выбрать участников → подтвердить), deep-link `?challongeSync=1` сохранить. `teams/draft/page.tsx` = текущий `draft/page.tsx`, сверху `PhaseStrip` Setup·Ready·Live·Done по `session.status`; `DraftSetupWizard.tsx` → `WizardShell` (6 шагов сохраняются; `DraftHistoryPanel` в `aside`); `AdminControlRoom.tsx` — раскладка F6: hero (`EntityHubHeader`-подобная полоса статуса: on-the-clock, таймер от `clock_expires_at`, presence, Pause/Cancel), `grid 7fr 3fr`, на `< lg` правая колонка — `Accordion` под основной.

### P2-5 Matches под-табы

`matches/layout.tsx`: `<nav>` → `AdminTabs level=2` по `MATCHES_SUB_TABS`, бейджи: reports (disputed count), logs (queue count) — из существующих count-запросов. `TournamentMatchesTab.tsx` (1234 строки) разделить:
- `matches/encounters/page.tsx` — таблица encounters: `AdminFilterBar` с pinned tournament + чип `stage` (общий параметр `?stage=` для всех под-табов), Inspector (F2 ·5: teams, status, reports summary, parsed maps, действия Edit / Upload log / Resolve result / Audit trail). Create/Edit — существующий `EntityFormDialog`; delete — `ConfirmDialog`; `TournamentLogUploadDialog` — из Inspector.
- `matches/standings/page.tsx` — таблица standings, тот же `?stage=`, действия Recalculate / Sync Challonge в `trailing` FilterBar, edit через `EntityFormDialog`.
- `reports` → `EncounterReportsBrowser`, `parsed` → `ParsedMatchesBrowser` — оба переводятся на `AdminFilterBar`+`AdminInspector` (`ParsedMatchSheet` становится содержимым Inspector; `ResolveResultDialog` открывается из Inspector). Эти же компоненты монтирует `/admin/matches` (P3-1) — правки делаются один раз.
- `logs` — `TournamentLogsTab.tsx`: ToggleGroup → `AdminFilterBar` (single-чип status с count), остальное без изменений.

### P2-6 Bracket (master-detail)

`bracket/page.tsx` + `bracket/components/`: `StageManager.tsx` (2450 строк) разбить на:
- `StageList.tsx` — левый список (`MasterDetail.list`): карточка стадии (номер, имя, формат, статус), «+ Add stage» (`EntityFormDialog`), reorder dnd-kit (уже зависимость). Выбор → `?stage=`.
- `StageEditor.tsx` — правая часть: `EntityHubHeader`-мини (имя, формат, «Regenerate», kebab с delete/seed/merge/force-activate/deactivate) + `AdminTabs level=2` секций General · Seeding · Tiebreakers · Best-of · Items (state в `?section=`), каждая секция — форма из существующего кода Advanced-Collapsible; `SaveBar` при dirty; один `ConfirmDialog` с `intent` для 6 операций.
- `BracketPreview.tsx` — read-only проекция (существующая математика проекции выносится в `bracket/projection.ts` с unit-тестом — это первый повод покрыть её тестами).
Items → ссылка «Edit matches in Matches › Encounters?stage=N».

### P2-7 Settings (T5)

`settings/layout.tsx` (новый): `AdminSectionNav` по `SETTINGS_SECTIONS` с группами (F9 ·1); `settings/page.tsx` → редирект general. `TournamentSettingsTab.tsx` (714 строк) режется на секции-страницы, каждая — форма + `SaveBar` (общий хук `useTournamentSettingsForm` с diff-payload, чтобы секции не сохраняли чужие поля):
- `general` (identity), `rules` (format/scoring), `schedule`, `roster` (roster shape),
- `pre-game` = `PickBanConfigsTab.tsx` → `MasterDetail`: слева дерево скоупов (`kit`-независимый `ScopeTree.tsx`, маркеры inherited/overridden из `findInheritedConfig`), справа `PhaseStrip`-подобные 3 секции Pool · Sequence · Sides (`?step=`), `SaveBar` «Editing scope: …», «Reset to inherited». Catalogue-пикеры (Command popover) остаются, но один компонент `CataloguePicker` для карт и героев.
- `report-form` = `MatchReportFormBuilder`, `links` = `TournamentLinksTab` (таблица + `EntityFormDialog` — без изменений, кроме kebab), `challonge` + `discord` = `TournamentIntegrationsPanel` разделённый на две секции, `preview` = `TournamentPreviewAllowlist`, `danger` = Delete tournament (`ConfirmDialog requireTyped=name`).
- Audit trail — кнопка в `EntityHubHeader.actions` хаба (открывает глобальный `AuditTrailSheet`), не секция.

### P2-8 New tournament wizard

`tournaments/new/page.tsx` → `WizardShell` (те же 5 шагов; «Import from Challonge» — `aside`-ссылка, предзаполняет Basics/Schedule). Логика `ensureDraft`/resume — без изменений.

## 6. P3 — Data browsers

### P3-1 `/admin/matches?view=`

`app/admin/matches/page.tsx` — один экран: `AdminPageHeader` + `AdminTabs level=1` по видам `encounters|standings|reports|parsed|logs` (href = `?view=`), тело — те же компоненты, что в P2-5, с `tournamentId=null` и чипом `tournament` (не pinned). Удалить `app/admin/{encounters,match-reports,standings}/page.tsx` и старый `matches/page.tsx`; `encounters/page.tsx` (928 строк) — его таблица/формы становятся `components/admin/EncountersBrowser.tsx`, монтируемым и здесь, и в хабе. Дубли create/edit форм → одна `EncounterForm` с `mode`.

### P3-2 People

- `app/admin/people/page.tsx` (T2): identities (`userService`), колонки Person · Identities · Participations (count — если нет в API, см. §7) · Account (linked auth); чипы `has-account`, `unlinked`, `tournament`; Inspector: профиль + social accounts read-only + «Open page». Create identity — `EntityFormDialog` (существующий из `users/page.tsx`), merge — `UserMergeDialog` из kebab.
- `app/admin/people/[id]/page.tsx` (T3, `?tab=`): `EntityHubHeader`; табы Identity (`PlayerProfileDialog` содержимое inline + `SocialAccountsEditor`) · Participations (таблица бывшего `players/page.tsx`, фильтр по user, edit через существующую форму) · Account (read-only сводка `rbacService.getUser` + ссылка `/admin/access/accounts?q=`) · Achievements (holders API из achievements) · блок Rank & subscription (`rank-player.tsx`, `subscription-player.tsx` → переиспользовать, кнопка re-fetch).
- Удалить `app/admin/users/page.tsx`, `app/admin/players/page.tsx` (форму player перенести в `components/admin/players/PlayerForm.tsx`).

### P3-3 Teams

`teams/page.tsx` — FilterBar+kebab+Inspector (сводка ростера, «Open page»). `teams/[id]/page.tsx` — `EntityHubHeader`; `TeamRosterEditor` без изменений.

### P3-4 Achievements

`achievements/page.tsx` (1465 строк) → T2: FilterBar (category, scope, grain, tournament), Inspector read-only + Evaluate/Override (два доменных диалога остаются), kebab: Open page / Duplicate / Delete (`ConfirmDialog`). Create — `EntityFormDialog` только с метаданными → редирект на `[id]`. Удалить edit-диалог правил из списка.
`achievements/[id]/page.tsx` → T3 `?tab=`: Details · Conditions · Holders · History. Conditions: переключатель Simple/Canvas; `ConditionSimpleEditor.tsx` (новый): плоский список AND-условий, конвертируется в дерево `ConditionFlowEditor`; Canvas — существующий `ConditionFlowEditor`; переключение в Simple доступно только если дерево — один AND-узел с листьями (иначе disabled с подсказкой). Holders — `AdminDataTable paging="infinite"` вместо ручного `useInfiniteQuery`. Общие константы `CATEGORIES/SCOPES/GRAINS` и icon-maps → `components/admin/achievements/constants.ts`.

### P3-5 Members

`app/admin/members/page.tsx` = `workspaces/members/page.tsx` с FilterBar (`role`) и kebab; inline-редактирование роли в ячейке оставить (единственное сознательное исключение: 2 поля, частая операция).

## 7. P4 — Workspace Settings (T5) и Divisions

### P4-1 Settings hub

`app/admin/settings/layout.tsx`: `AdminSectionNav` (F11 ·1) — группы WORKSPACE (general, branding, visibility, domain, discord), COMPETITIVE (divisions, statuses, sub-roles), ENTITLEMENTS (subscriptions). Скоуп — `useWorkspaceStore().currentWorkspaceId`. Секции general/branding/visibility/domain/discord — из `workspaces/[id]/page.tsx` (784 строки): один хук `useWorkspaceSettingsForm(workspaceId)` с `formFromWorkspace/diffPayload/buildPayload` (сегодня три списка полей — свести к одному `FIELD_DEFS`), каждая секция — своя страница + `SaveBar`. Domain — inline-степпер (add → DNS records → verify poll 15s → verified), `ConfirmDialog` на remove.

`app/admin/workspaces/[id]/layout.tsx` монтирует тот же `AdminSectionNav` и те же секции с `workspaceId` из роута (суперюзер). Реализация секций — `components/admin/workspace-settings/*Section.tsx` с пропом `workspaceId`; обе оболочки — тонкие.

### P4-2 Statuses и Sub-roles

`settings/statuses` = `balancer/page.tsx` (912 строк): две ручные таблицы → `AdminDataTable rows=` client-mode с `groupRows` (system / custom), icon/color-пикеры остаются как есть. `settings/sub-roles` = `sub-roles/page.tsx` без изменений (эталон плоского экрана).
`settings/subscriptions` = `subscriptions/_components/subscription-workspace.tsx` (Providers) как секция.

### P4-3 Divisions — обзор (F11)

`settings/divisions/page.tsx`:
- Данные: `workspaceService.getDivisionGrids(ws)` → если гридов > 1 — `Select` грида над полосой; `getDivisionGridVersions(ws, gridId)`.
- `VersionStrip.tsx`: карточка на версию (`version`, `label`, `status` pill через `TONE_CLASS`: archived neutral, published info, active success, draft warning; `tiers.length` divisions; tournaments count — §7 gap G2; дата). Draft → «Open editor →» на `/settings/divisions/v/[id]`. Кнопки: «+ New draft from vN» (`cloneDivisionGridVersion`), «Load standard OW ladder» (существующий `standardOwGrid` → `createDivisionGridVersion`), «Import from workspace…» → `/settings/divisions/import`, Import/Export JSON (`importDivisionGridPortable`/`exportDivisionGridPortable`).
- Активная версия read-only таблица; «Who reads which version» — из readiness `sources` активной версии (`getDivisionGridVersionReadiness`) — там есть `version_label`, `status`; список турниров по версии — gap G2.

### P4-4 Divisions — редактор черновика (F12)

`settings/divisions/v/[versionId]/page.tsx` — полноэкранный (layout без `AdminSectionNav`: положить в `settings/divisions/v/layout.tsx`, который не рендерит nav). Только для `status === "draft"`; published/active открываются read-only с баннером «Create draft from this version».

Состояние: `useDraftReducer` (`divisions/editor/draftReducer.ts`, чистая функция + unit-тесты):

```ts
type Band = { id?: number; slug: string; name: string; number: number; icon_url: string | null; owFrom: number; owTo: number } // индексы рангов в OW_LADDER (45)
type DraftState = { bands: Band[]; history: Band[][]; base: Band[] /* родительская версия для дифа */ }
type Action = { type: "splitAt"; rank: number } | { type: "moveBoundary"; bandIndex: number; edge: "floor"|"ceiling"; delta: -1|1 } | { type: "merge"; bandIndex: number; into: "up"|"down" } | { type: "rename"; bandIndex: number; name: string } | { type: "setIcon"; … } | { type: "undo" } | { type: "splitWidest" }
```

Инварианты (проверяются тестом на каждом action): `bands` покрывают `0..44` без дыр и пересечений; `moveBoundary` двигает общую границу двух соседей; band не может стать пустым (merge вместо этого). Источник ладдера — `lib/division-grid.ts`: `OW_REFERENCE_GRID.tiers` (45 рангов с `rank_min/rank_max`), конвертация band ↔ `ow_rank_min/ow_rank_max` тира — через `lib/division-grid-normalizer.ts`.

Раскладка `grid 230px 1fr 250px` (на `< xl` — `1fr` + правая колонка как таб «Impact» в `AdminTabs level=2`):
- `LadderColumn.tsx`: свой `overflow-y:auto; max-height: calc(100vh - header)`, `position: sticky; top`. Клик по рангу → `splitAt`; ▲▼ у полосы → `moveBoundary`; ×-иконка ранга — нет (мок имел, у нас merge из kebab таблицы). Полоса выделена, если `?band=`.
- Центр: `AdminTabs level=2` Divisions · Changes · Mappings (`?tab=`).
  - Divisions: таблица (client-mode `AdminDataTable rows=bands`): #, Name (`InlineEditText`), OW band (полные имена рангов), Ranks, Players (gap G1 → «—» пока), vs base (`renamed | band moved | new | —`), kebab (Rename, Set icon → `uploadDivisionIcon`, Merge up/down, Delete = merge). Под таблицей — sentence об инварианте + «Split the widest».
  - Changes: диф `base → bands` бок о бок по slug/number: added / removed («merged upward») / moved / renamed.
  - Mappings: для каждой source-версии из `readiness.sources` (после сохранения) — `getDivisionGridMapping(source, draft)`; строки source tier → target tier; AUTO — по пересечению рангов (клиентский расчёт `autoMap(sourceTiers, bands)` с покрытием %); SPLIT → `Select` целевой полосы (`is_primary`); `putDivisionGridMapping` при Save. До первого сохранения черновика Mappings показывает «Save draft to compute mappings».
- Правая колонка: `Impact` (players changing — gap G1; per-tournament reads — из `readiness.sources` + G2), `Ready to publish?` — из `DivisionGridActivationReadiness` + локальных проверок (контигуальность — всегда true по конструкции; имена уникальны; иконки заданы; `incomplete_mapping_version_ids.length === 0`), `Changes in the draft` — человекочитаемый лог из `history` (генератор `describeAction`).
- `SaveBar`: «vN draft · X divisions · Y edits · Z bands differ from vM»; кнопки: Save draft (`updateDivisionGridVersion` tiers), Publish (`publishDivisionGridVersion`, `ConfirmDialog tone=warning` «becomes immutable»), Activate (`activateDivisionGridVersion`, disabled пока `status !== "published"` или `!readiness.is_ready`). Undo/Discard — в header.

Тесты: `draftReducer.test.ts` (инварианты, undo, splitWidest), `autoMap.test.ts`, behavior: publish disabled при незакрытых mappings.

Удалить: `divisions/page.tsx` (1045), `GridLibrary.tsx`, `OwRankRangePicker.tsx`, `ConflictResolver.tsx` и их тесты (`standardOwGrid.behavior.test.tsx` — перенести сценарий на VersionStrip).

### P4-5 Divisions — импорт (F12b)

`settings/divisions/import/page.tsx` → `WizardShell` 3 шага: Source (`getDivisionGridMarketplaceWorkspaces`) → Grid & version (`getDivisionGridMarketplace`, `preflightDivisionGridMarketplace` даёт превью и число конфликтов) → Create draft (`importDivisionGridMarketplace` → job; poll `getDivisionGridImportJob` 1s; по завершении редирект в редактор `?tab=mappings`). `ImportWizard.tsx` удаляется.

## 8. P5 — Platform

### P5-1 Game content

`app/admin/content/layout.tsx`: `AdminPageHeader` + `AdminTabs level=1` heroes/maps/gamemodes/unresolved (badge = count открытых misses). Страницы — существующие `heroes/maps/gamemodes/page.tsx` (shared `useCatalogEntityCrud` + `Catalog*` — оставить, только `createEntityActionsColumn` → `createKebabColumn`) и `aliases/page.tsx` → `unresolved/page.tsx` (Select type → FilterBar single-чип; inline attach остаётся).

### P5-2 Collectors

`app/admin/collectors/layout.tsx`: `AdminTabs level=1` rank/subscriptions/streams с точкой здоровья (из `*-health` запросов); `[collector]/page.tsx` — `AdminTabs level=2` по `?tab=` из слотов `{ status, history?, settings }` (у streams без history). ToggleGroup удалить; `TintedBadge` — единственный бейдж статусов (переписать `subscription-shared`/`stream-*` на него). Player-lookup из rank/subscriptions убрать (переехал в People/[id], P3-2). Providers из subscriptions → P4-2.

### P5-3 Access

`access/layout.tsx`: pill-nav → `AdminTabs level=1` accounts/roles/permissions/api-keys/oauth/sessions; `access/page.tsx` удалить (редирект P1-2). `users/` → `accounts/`.
`kit`-независимый `components/admin/access/PermissionPicker.tsx`:

```ts
export function PermissionPicker(props: { catalog: { key: string /*resource.action*/; resource: string; action: string; description?: string }[]; value: Set<string>; onChange(next: Set<string>): void; mode?: "matrix" | "list"; wildcards?: string[] /* "admin.*" */; readOnly?: boolean })
```
Заменяет матрицу в `roles/page.tsx`, `ScopePicker` в `api-keys/page.tsx`, `UserDenyEditor` (deny = тот же picker с `tone=danger`). Roles → `MasterDetail` (список ролей слева `?role=`, редактор справа с `SaveBar`, F15). API keys: 3 диалога → Create (`EntityFormDialog` + picker), Rename (inline `InlineEditText`), Revoke (`ConfirmDialog`).

### P5-4 Workspaces, Audit

`workspaces/page.tsx` — kebab + Inspector; edit → `/workspaces/[id]/general` (P4-1). `audit/page.tsx` — URL-чипы → `AdminFilterBar` (владелец URL-состояния один — таблица; убрать ручной `history.replaceState`), row → `AdminInspector` с `AuditFieldDiff`.

## 9. P6 — Cleanup

- Удалить: `AdminFilterChips.tsx`, `AdminColumnFilter.tsx` (и header-funnel код в `AdminDataTable`), `row-actions-column.tsx`, `createEntityActionsColumn`, `TournamentFilterSelect` (оставить `TOURNAMENT_QUERY_PARAM`/парсеры в `kit/useAdminFilters`), `DeleteConfirmDialog` (после миграции всех вызовов на `ConfirmDialog`), `TournamentWorkspaceHeader.tsx`, `AdminDetailTable` (если `TeamRosterEditor` переведён; иначе оставить с комментарием), старые страницы (§1.1), их тесты.
- `frontend/DESIGN.md`: раздел «Admin kit» — таблица шаблонов T1–T7 и правила §1.3 (перенос из `01-ia.md`).
- `docs/admin-redesign/`: пометить `01-ia.md` как реализованный, wireframes — исторический артефакт.
- CHANGELOG / release notes: список редиректов для тех, у кого закладки.
- `rtk next build`; полный `rtk vitest run`; `rtk npm run lint:design`; ручной smoke всех 7 шаблонов на 4 ширинах.

## 10. Backend gaps (единственные правки вне фронта)

| # | Нужно | Зачем | Пока нет |
|---|---|---|---|
| G1 | `GET /api/v1/division-grids/versions/{id}/impact?against={versionId}` → `{ total_players, changing: number, per_tier: { tier_slug, players }[] }` — распределение игроков воркспейса по `ow_rank` против двух версий | F12 Impact «122 players changing», колонка Players | В UI «—» с `title` «impact endpoint pending» |
| G2 | В `DivisionGridActivationReadiness.sources[]` (или отдельный `GET …/versions/{id}/consumers`) — список турниров, читающих версию: `{ tournament_id, name }[]` | F11 «Who reads which version», F12 Impact per-tournament | Показывать только `version_label` + count из `used_source_version_ids` |
| G3 | Count участий у identity (`participations_count`) в списке `userService.searchUsers`/list | People колонка Participations | Колонка скрыта до появления поля |
| G4 | Счётчики очередей для бейджей: open alias misses, disputed reports, pending log queue — либо уже есть в `/api/v1/statistics/dashboard` (`DashboardIssues`), тогда переиспользовать | Бейджи сайдбара/табов | Без бейджа |

Каждый gap — отдельный маленький PR в tournament-service, не блокирует фронт.

## 11. Параллелизация и порядок PR

```
PR-0   P0-1…P0-11 (kit)                                  — один PR, ~11 файлов + тесты
PR-1   P1-1…P1-5 (nav, redirects, breadcrumb, shell)     — after PR-0
── далее параллельно, каждый WU = 1 PR ──
PR-2a  P2-1 + P2-2 (guards, shell, overview)             — after PR-1
PR-2b  P2-3 registration          PR-2c  P2-4 teams/draft
PR-2d  P2-5 matches + P3-1 (/admin/matches) — один PR: общие браузеры
PR-2e  P2-6 bracket               PR-2f  P2-7 settings          PR-2g  P2-8 wizard
PR-3a  P3-2 people                PR-3b  P3-3 teams   PR-3c  P3-4 achievements   PR-3d  P3-5 members
PR-4a  P4-1 settings hub (+ workspaces/[id])   PR-4b  P4-2   PR-4c  P4-3+P4-4+P4-5 divisions
PR-5a  P5-1 content   PR-5b  P5-2 collectors   PR-5c  P5-3 access   PR-5d  P5-4
PR-6   P6 cleanup                                        — после всех
```

Конфликты по файлам: `tab-guards.ts`, `TournamentHubShell.tsx` — только PR-2a; `admin-navigation.ts`, `next.config.mjs` — только PR-1 (все редиректы заводятся заранее, старые страницы живут до своего PR — редирект на ещё не существующий роут недопустим, поэтому в PR-1 редиректы добавляются закомментированным блоком, а каждый WU-PR раскомментирует свои строки). `EncounterReportsBrowser`/`ParsedMatchesBrowser` — только PR-2d.

## 12. Риски

| Риск | Митигация |
|---|---|
| `AdminDataTable` (987 строк) ломается при правках тулбара/actions | P0-10 — минимальные добавления пропсов, существующие behavior-тесты `AdminDataTable.*.behavior.test.tsx` прогонять после каждого изменения |
| Realtime-подписки хаба задублируются при переносе табов в `layout.tsx` | Правило без изменений: единственный mount в `TournamentHubShell`; `layout.tsx` под-табов — только nav |
| Редиректы на ещё не существующие роуты | §11: включать редирект в том же PR, что создаёт целевой роут |
| Divisions: `OW_LADDER` фронта расходится с `ow_rank_min/max` бэкенда | `draftReducer` работает индексами ладдера и конвертирует в `ow_rank_*` через существующий `division-grid-normalizer.ts`; round-trip тест «tiers → bands → tiers» на реальной версии |
| Права: новые префиксы `adminRoutePermissions` пропускают старый кейс | Тест-таблица «роут × роль → доступ» в `admin-navigation.test.ts` для всех 40+ роутов §1.1 |
| Мобильная карточка `AdminDataTable` скрывает важные колонки | `renderMobileCard` обязателен для T2-экранов с > 4 колонками; проверка в behavior-тесте на `matchMedia` |

## 13. Deviations

Правки плана по ходу реализации. Формат: дата · WU · что · почему.

### 2026-09-02 · P0-4 · `createKebabColumn` получил второй необязательный аргумент

```ts
createKebabColumn<T>(items, options?: { rowLabel?: (row: T) => string })
```

§3 P0-4 требует у триггера `aria-label="Actions for {rowLabel}"`, но в объявленной
сигнатуре `rowLabel` взять негде: `items` — единственный параметр. Без него у всех
строк один и тот же accessible name. Фолбэк, когда `rowLabel` не передан —
`Actions for row {row.id}` (id стабилен через `getRowId`). Аргумент необязательный,
вызов `createKebabColumn(items)` из плана продолжает компилироваться.

Заодно `KebabAction.onSelect` сделан необязательным: у пункта с `href` обработчика
нет по смыслу (в плане он указан как обязательный рядом с `href?`).

### 2026-09-02 · P0-2 · `useAdminFilters` возвращает ещё и `setMany`

`AdminFilterBar.presets` применяет несколько ключей сразу. Через повторные `set()`
это невозможно: `useQueryParams.setParams` замкнут на `searchParams` того рендера,
в котором создан, поэтому N последовательных вызовов стартуют с одного снапшота и
выживает только последний. `setMany(values)` делает одну запись в URL. `set` остался
без изменений.

### 2026-09-02 · P0-10 · строка инспектора помечается `aria-current`, не `aria-selected`

§3 P0-10 просит `aria-selected` на выбранной строке. Внутри `role="table"` этот
атрибут у роли `row` не поддерживается (только `grid`/`treegrid`), то есть был бы
ARIA-нарушением и находкой axe, а не объявлением состояния. Используется
`aria-current="true"` — примитив «текущий элемент набора», валидный на любом
элементе. Пропс называется как в плане: `inspectorId`.

### 2026-09-02 · P0 · предсуществующие находки `lint:design`

На момент PR-0 `rtk npm run lint:design` уже падал на HEAD двумя R6-находками в
`src/app/balancer/pickup/{PickupPlayerSheet,PickupTeamsPanel}.tsx` (шрифт ниже
11px). Файлы вне области редизайна админки, в PR-0 не правились.

### 2026-09-02 · P1-1 · `AdminNavItem.activePrefix`

Три пункта из тринадцати ведут не на корень своей секции, а на её первую
страницу (`/admin/settings/general`, `/admin/content/heroes`,
`/admin/access/accounts`) — у `/admin/settings` и `/admin/access` корень занят
редиректом, у `/admin/content` его нет вовсе. Подсветка активного пункта по
`href` тогда гаснет на `/admin/settings/divisions`. Добавлено необязательное
поле `activePrefix`, по которому `getActiveAdminNavHref` и матчит.

Заодно `getActiveAdminNavHref(pathname, allHrefs: string[])` принимает теперь
`items` (`{ href, activePrefix? }[]`) — иначе `activePrefix` до неё не доходит.
Единственный вызов — `AdminSidebar`.

### 2026-09-02 · P1-1 · старые префиксы `adminRoutePermissions` остаются до своего WU

§4 P1-1 просит «старые префиксы удалить». Удалить их в PR-1 нельзя: старые
экраны живут до своего WU (§11), а без своей строки они проваливаются в
catch-all `/admin` с гейтом `adminEntryPermissions` — `/admin/heroes` молча
теряет `superuserOnly`. Таблица содержит и новые префиксы, и старые в отдельном
блоке «Screens awaiting their WU»; каждый WU-PR удаляет строку того экрана,
который удаляет сам. Тест `keeps the old prefixes alive while the old screens
exist` фиксирует это как намерение, а не как забытый мусор.

### 2026-09-02 · P1-1 · сайдбар после PR-1 ведёт на ещё не созданные роуты

Следствие §11, не отклонение от него: `admin-navigation.ts` принадлежит только
PR-1, хрефы §1.1 финальные, значит в интервале между PR-1 и PR-3a/4a/5a пункты
People, Settings, Members, Game content, Collectors и Access ведут в 404.
Альтернативы — временные обратные редиректы (shim, запрещён §0) или перенос
флипа хрефа в каждый WU (конфликт по файлу с §11) — хуже. Зафиксировано, чтобы
404 в этом окне не читались как дефект PR-1.

### 2026-09-02 · P1-3 · `BREADCRUMB_ENTITIES` получает `workspaceId`

Сигнатура в §4 P1-3 — `(id: number) => queryKey`. Ключ детали ачивки
workspace-скоупный (`["admin","achievement-rule",workspaceId,ruleId]`), из
одного `id` его не собрать. Функция принимает вторым аргументом
`workspaceId: number | null`, который хлебные крошки берут из
`useWorkspaceStore`. Остальные ключи второй аргумент игнорируют.

### 2026-09-02 · P1 · тест-таблица «роут × роль» лежит в отдельном файле

§12 называет `admin-navigation.test.ts`, но этот файл чистый (без DOM), а
таблица должна гонять настоящий `usePermissions().canAccessAdminRoute` — тот же
вызов, что делает `AdminLayoutClient`, а не его копию в тесте. Таблица живёт в
`admin-navigation.routes.behavior.test.tsx` (happy-dom, 4 профиля × 60 роутов);
структурные проверки остались в `admin-navigation.test.ts`.
