# Инвентаризация фич и вкладок: админка + балансер (UX-аудит)

> Дата: 2026-07-28. Источник: чтение кода `frontend/src/app/admin/**`, `frontend/src/app/balancer/**`, `frontend/src/components/admin/**`, `frontend/src/components/balancer/**`.
> Цель: основа для редизайна IA/UX админки и балансера, wizard создания/сопровождения турнира, упрощение без потери функциональности.

---

## 1. Админка: карта роутов

Навигация: `AdminSidebar` из декларативного `components/admin/admin-navigation.ts` (группы **Overview / Competition / Game Content / Administration**) + Cmd+K `AdminCommandPalette` + авто-breadcrumbs.

| Route | Название | Назначение | Доступ |
|---|---|---|---|
| `/admin` | Dashboard | KPI, активный турнир, лог-очередь, IssuesQueue (deep-links на проблемы), QuickAccess | overview-права |
| `/admin/tournaments` | Tournaments | Список + create (Manual / From Challonge), edit, delete | `tournament.*` |
| `/admin/tournaments/[id]` | Tournament Workspace | 7 вкладок, детали ниже (§2) | `tournament.read` |
| `/admin/teams` (+`/[id]`) | Teams | Список + фильтр `?tournament=`, TeamCreateDialog (имя + капитан); detail — **инлайн-редактор** (имя, капитан, ростер: роль/ранг/сабролью/флаги пишутся по изменению; «Replace» добавляет замену) | `team.*` |
| `/admin/players` | Players | Все игроки (клиентская сборка из ростеров!), CRUD c привязкой к identity | `player.*` |
| `/admin/encounters` | Encounters | Матчи: stage/stage-item, счёт, closeness-звёзды, статус, has_logs | `match.*` |
| `/admin/standings` | Standings | Scope-табы, realtime, edit/delete/recalculate | `standing.*` |
| `/admin/users` | Player Identities | Identity (BattleTag/Discord/Twitch), CSV/Google Sheets импорт, merge, link auth | `user.*` |
| `/admin/rank` | Rank Collection | OverFast health, история задач, ручной re-fetch, глобальный toggle | `user.read` |
| `/admin/divisions` | Divisions | Редактор дивизионных сеток: версии, publish/activate, conflict resolver, marketplace-импорт | `division_grid.*` |
| `/admin/achievements` (+`/[id]`) | Achievements | Правила с condition-tree, evaluate/dry-run/override, export/import/library | `achievement.*` |
| `/admin/heroes`, `/gamemodes`, `/maps` | Game Content | CRUD + Sync from Game, серверная пагинация | superuser |
| `/admin/access/users` | Access Users | RBAC auth-аккаунты, роли, linked players, deny-overrides | global |
| `/admin/access/roles` | Roles | Каталог ролей, permission bundles | `role.read` |
| `/admin/access/permissions` | Permissions | Read-only инвентарь | global |
| `/admin/access/oauth` | OAuth | Просмотр/удаление подключений | global |
| `/admin/access/api-keys` | API Keys | Ключи публичного balancer API | `team.import` |
| `/admin/access/sessions` | Sessions | Read-only сессии | superuser |
| `/admin/workspaces` (+`/[id]`, `/members`) | Workspaces | Создание, branding/domain/timezone, члены+роли | ws-admin |
| `/admin/settings` | Settings | Rank Collection config + Rank Mapping (Tabs с одним табом) | superuser |
| `/admin/balancer` | — **сирота** | Кастомные статусы; НЕТ в сайдбаре, вход только через `/balancer/statuses` (реэкспорт) | `team.import` |

## 2. Турнирный workspace `/admin/tournaments/[id]`

7 вкладок через `useState` — **состояние вкладки не в URL** (нельзя дать ссылку на таб). Ленивые dynamic-импорты, per-tab загрузка, 60с refetch + realtime, 17 permission-флагов.

| Вкладка | Содержимое |
|---|---|
| **Overview** | 4 статус-тайла, **StageManager (монолит 2082 строки)**: CRUD стадий, Activate/Generate, Seed by SR (через `window.confirm`), merge groups, слоты команд, Advanced (ranking preset, tiebreakers, per-stage scoring, swiss bye, best-of); ChallongeSyncPanel (import/export + лог); Discord Sync; Setup Health |
| **Teams** | Превью 8 команд → ссылки на `/admin/teams?tournament=`; team/player CRUD; Sync Challonge Teams; Import JSON из балансера |
| **Play & Results** | Match Control (encounters CRUD, Sync from Challonge) + Standings Control (edit, Calculate/Recalculate) |
| **Logs** | Console: таблица, retry/retry-failed/process-all-S3, мультифайл upload с привязкой к encounter |
| **Draft** | Роутер: live/paused → AdminControlRoom; иначе → **DraftSetupWizard** (6 шагов: Config→Pool→Captains→Order→Review→Ready) — лучший wizard-паттерн в кодовой базе; свои `--aqt-*` токены (чужая дизайн-система) |
| **Map Veto** | Конфиги tournament/stage/stage+round; map pool + ban/pick/decider; пресеты Bo1/Bo3/Bo5; таймер |
| **Settings** | Sticky dirty-бар; General / Schedule&Timeline (phase schedule + auto transitions + late registration) / Rules&Grid / Visibility (+allowlist) / Scoring / Integrations (Challonge) / Danger Zone |

Header: метрики, Edit(→Settings), Mark as Finished (superuser), **TournamentStatusControl** — state machine `registration→draft→check_in→live→playoffs→completed→archived` + force-override. Параллельно живёт legacy-флаг `is_finished` — **двойная модель статуса**.

## 3. Балансер: карта роутов

Отдельное приложение со своим сайдбаром (`BalancerSidebar`): **Tournament switcher** в сайдбаре (`?tournament=` query, переносится между вкладками); workspace — из глобального zustand-store (выбирается «где-то снаружи»).

| Route | Вкладка | Назначение |
|---|---|---|
| `/balancer` | Workspace | Пул игроков (фильтры Ready/Need Fix/Excluded/Rank Δ, bulk, канбан PoolTriageBoard), Run balance (контролы в header через портал), BalancerConfigDrawer (per-tournament, пресеты), варианты, редактор составов (drag), BalanceActionsBar (Save / **Export to Tournament** / JSON / Image), PlayerEditSheet (1339 строк: роли DnD, ранг-слайдеры по grid, история рангов), realtime + presence |
| `/balancer/registrations` | Registrations | Таблица 1313 строк: 14 колонок c пикером, 4 фильтра + группировки, expandable rows, row-actions (approve/reject/check-in/balancer/withdraw/delete), bulk, create/edit через UnifiedRegistrationForm |
| `/balancer/registrations/form` | Form | Конструктор формы: Status (open/auto-approve/open-profile) / Fields (built-in + regex) / Subroles / Custom Fields |
| `/balancer/registrations/rank-autofill` | Rank autofill | Цепочка источников OW→Division history→Analytics (DnD), live-preview, выборочный apply. Единственная i18n-страница |
| `/balancer/registrations/feed` | Google Sheets | Source&Sync / Column Mapping / Value Mapping / Preview |
| `/balancer/statuses` | Statuses | = реэкспорт `/admin/balancer`. Workspace-скоуп среди tournament-скоуп вкладок |
| `/balancer/pool`, `/applications` | — | Legacy-редиректы |

Мёртвый код: `BalancerTournamentSelect.tsx`.

## 4. Сквозные пути пользователя (as-is)

### Путь «турнир от создания до финиша» — минимум 6 вкладок + 3 раздела
1. `/admin/tournaments` → Create (диалог Manual/Challonge)
2. `/admin/tournaments/[id]` Settings → расписание фаз, правила, grid, видимость
3. → **уход в `/balancer/registrations/form`** — настроить форму регистрации (другое приложение, надо заново выбрать турнир в switcher)
4. `/balancer/registrations` → модерация, check-in; `/balancer/registrations/rank-autofill` → ранги
5. `/balancer` → пул → Run → правки → Save → Export to Tournament
6. → обратно в `/admin/tournaments/[id]` Teams (проверка команд) — или Draft-вкладка (wizard, pool_source=balancer_balance)
7. Overview → StageManager: стадии, Activate & Generate
8. Play & Results → encounters/standings; Logs → загрузка логов
9. Map Veto — при необходимости; статусы двигаются через TournamentStatusControl
10. Completed → Mark as Finished (двойная модель)

### Путь оператора балансера
form → (feed) → registrations → rank-autofill → pool/run/edit → save → export → admin Teams/Draft.

## 5. Зависимости данных

- **Workspace — корень**: статусы, саброли, division grid, rank-delta, branding; почти все страницы читают `currentWorkspaceId`.
- Tournament ← workspace (+grid version); Stages ← manual/Challonge; Teams ← balancer export | draft export | ручной CRUD | Challonge sync | Import JSON (**5 путей создания команд**); Players ← team + identity user; Encounters ← stage+teams; Standings ← encounters.
- Ранги: identity battle-tags → Rank Collection (OverFast) → SR → балансировка/autofill.
- Draft-пул ← balancer registrations + saved balance (кросс-раздельная зависимость).
- RBAC: auth users ↔ identity users (linked players); роли ← permissions; members ← workspace.

## 6. Сводные болевые точки

### Информационная архитектура
1. **Разрыв админка ↔ балансер**: одна работа «провести турнир» разрезана на два приложения с разными сайдбарами, разными механизмами выбора турнира (row-click vs switcher) и без перекрёстных ссылок (из админки в балансер ссылок нет вообще).
2. **Вкладки турнира не в URL** — нельзя шарить/бук­маркать; Draft-переход из balancer невозможен диплинком.
3. `/admin/balancer` — страница-сирота (нет в сайдбаре); `/balancer/statuses` — её реэкспорт: одна страница, два адреса, два layout'а.
4. Два «Users»: `/admin/users` (identities) vs `/admin/access/users` (auth) — связаны линковкой, живут врозь, оба зовутся Users.
5. Тройная навигация access-раздела: sidebar + горизонтальные табы + QuickAccess.
6. Rank-настройки разнесены: toggle в `/admin/rank`, config+mapping в `/admin/settings`.
7. Challonge размазан по 4 местам: Settings (slug), Overview (import/export), Teams (маппинг), Matches (sync encounters).
8. Турнирные сущности (teams/players/encounters/standings) — и вкладки workspace, и отдельные верхнеуровневые страницы с ручным `?tournament=`; связь на query-params и Quick Links.

### Редактирование одного объекта из многих мест
9. Турнир редактируется в 3 местах с разными наборами полей (create-диалог, edit-диалог списка, Settings-вкладка; `TournamentFormFields` имеет 4 режима).
10. Регистрация/игрок пула редактируется из 4 UI: таблица registrations, sidebar-пул, канбан-триаж, PlayerEditSheet.
11. Rank autofill доступен тремя путями (страница, кнопка, авто-preview в Sheet).
12. Настройки балансера в 3 местах: per-tournament Drawer, per-workspace диалог в пуле, статусы на отдельной странице.

### Несогласованные паттерны
13. Действия таблиц: DropdownMenu «…» (heroes/maps/achievements) vs inline-иконки (tournaments/teams/standings); edit по double-click — только местами; row-click — то навигация, то ничего.
14. Пагинация: серверная (game content, access) vs фейковая клиентская поверх полного `getAll` (tournaments/teams/players/encounters).
15. `window.confirm` (StageManager) vs `AlertDialog` (везде ещё).
16. Draft-вкладка на собственных `--aqt-*` токенах против shadcn остальных табов.
17. Редакторы: Sheet (игрок) vs Dialog (регистрация) vs Drawer (конфиг) vs full-page (form builder) — без системы.
18. i18n только на rank-autofill; остальное — хардкод английского.
19. Workspaces delete — сырой `fetch` мимо сервисного слоя.

### Прочее
20. CTA «New Tournament» на дашборде не создаёт турнир — ведёт на список.
21. Двойная модель статуса турнира: `is_finished` + 7-статусная машина.
22. Divisions — одностраничная простыня: Library + ImportWizard + ConflictResolver + Editor + VersionHistory всегда развёрнуты.
23. Settings — Tabs с одним табом.
24. Breadcrumb «Details» вместо имени турнира/команды.
25. Монолиты: StageManager 2082, PlayerEditSheet 1339, registrations/page 1313, BalancerMainPageClient 818 строк.

## 7. Существующие паттерны — кандидаты на переиспользование в редизайне

- **DraftSetupWizard** (`admin/tournaments/[id]/components/draft/`) — эталон: линейный степпер с кликабельным «назад», per-step валидация (`setup-model.ts`), ленивое создание серверной сессии, dry-run preview с диффом, confirm-гейты, sticky Back/Continue.
- **Setup Health** (Overview) и **BalancerSetupChecklist** (пустое состояние редактора) — зачатки guided-checklist.
- **IssuesQueue** на дашборде — deep-links на проблемы: паттерн «система сама говорит, что делать дальше».
- **AdminCommandPalette** (Cmd+K) — быстрая навигация, легко расширяется действиями.
- **TournamentStatusControl** — state machine уже есть; wizard сопровождения может ехать по ней.
- **DivisionGridImportWizard**, **BalancerOperationDialog** (степперы операций) — вторичные wizard-паттерны.
- Design-book «Editorial Tactical» (`docs/design-book.md`) + `docs/redesign-plan.md` — готовая токен-система для визуального слоя (публичный сайт; админка/балансер в плане редизайна не покрыты).
