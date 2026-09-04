# Публичная страница турнира: план реализации редизайна

Исполнителю (агенту-оркестратору с сабагентами). Документ самодостаточен, но опирается на:

- `wireframes.html` (рядом) — 11 секций каркасов с нумерованными заметками. Ссылки вида «§3 ⑤» — секция и номер заметки оттуда. **Открыть в браузере до начала работы.**
- `frontend/DESIGN.md`, `docs/design-book.md` — визуальный язык и правила токенов. Обязательны до P0.
- `docs/admin-redesign/03-implementation-plan.md` — формат DoD и конвенции тестов, которым этот план следует.

Область: `frontend/src/app/(site)/tournaments/[slug]/**` и то, что оно импортирует. Админка — только один WU (P7). Backend — не трогать (§6: gaps нет, всё нужное уже есть в API).

## 0. Как работать с планом

**Порядок.** P0 → P1 → (P2 ∥ P3 ∥ P4 ∥ P5 ∥ P6 ∥ P7) → P8. P0 и P1 делает оркестратор сам (они задают контракты). P2–P7 — независимые сабагенты, каждый владеет своим набором файлов (перечислен в WU). P8 — оркестратор.

**Definition of done для WU** — все пункты:

1. Экран отдаёт то, что нарисовано в соответствующей секции wireframes, включая все нумерованные заметки этой секции. Отклонение от каркаса — только с причиной в комментарии к коду.
2. Состояние (вид, фильтр, сортировка, раскрытие) — в URL через `useQueryParams` (`frontend/src/hooks/useQueryParams.ts`); ключи — из §1.2 этого плана, не выдуманные.
3. Только существующие примитивы `components/ui/*` и общие компоненты P1. Никаких новых ad-hoc табов, чипов, сегментов.
4. Все строки — через `next-intl` (`frontend/src/i18n/messages/{ru,en}.json`), обе локали; `messages.parity.test.ts` зелёный.
5. `rtk npm run typecheck` чистый по затронутым файлам; `rtk vitest run <затронутые файлы>` зелёный. **Полный прогон и `next build` — только в P8, не в сабагентах.**
6. Behavior-тест `*.behavior.test.tsx` рядом с экраном: URL↔состояние, один ключевой сценарий, пустое/ошибочное состояние через `TournamentPageState`. Образцы: `_views/TournamentParticipantsPage.behavior.test.tsx`, `_views/TournamentMapsPage.behavior.test.tsx`.
7. Удалён код, который WU заменил. Никаких `@deprecated`-реэкспортов, никаких оставленных «старых» вью.
8. Никаких `console.log`, `TODO`, заглушек. Если данных нет — честное пустое состояние, а не плейсхолдер.

**Что не трогать.** `bracket/TournamentBracketPage.tsx` и всё дерево сетки (§4 — KEEP; разрешены только два параметра из §4 ②). `_views/_components/VirtualParticipantsList.tsx` как таблица (§6 режим A — KEEP; разрешено только гейтирование колонок из P5). `TournamentBroadcastDock`, `TournamentStreamPage`, `pregame/**`, `draft/**`. Сервисы `frontend/src/services/*` — только добавлять методы. Backend.

**Команды.** Всегда через `rtk`: `rtk npm run typecheck`, `rtk vitest run <path>`, `rtk next build`. Из каталога `frontend/`.

**Данные, которые уже есть (не искать и не изобретать):**

| Что | Где |
|---|---|
| Фазы турнира | `Tournament.phase_schedule: {status, starts_at, ends_at}[]` — уже в overview-запросе layout'а. Модель для UI — `_views/tournamentSchedule.model.ts`. |
| Мап-пул | Производный от pick-ban конфигов. Логика сборки — `collectPoolIds`, `buildStageViews`, `keepPlayableLevels` в `_views/TournamentMapsPage.tsx`; каталог карт — `mapService`, конфиги — `pickBanService`. |
| Время матча | `Encounter.scheduled_at` — уже в модели, в публичной схеме и в admin-схеме обновления (`backend/tournament-service/src/schemas/admin/encounter.py`). Админский UI его **не показывает** — это и есть P7. |
| Live-матч | `EncounterStatus`/`started_at`, realtime через `useTournamentRealtime`; live-стримы матча — `bracket/bracketLiveStreams.ts`. |
| Карточка матча | Рендер узла в `components/BracketView.tsx` (~стр. 480–560: команды, счёт, `timeLabel`, Bo). |
| Строка матча | `components/EncountersTable.tsx`. |
| Статус турнира | `lib/tournament-status.ts` (`getTournamentStatusMeta`, `isTournamentStatusEnded`, `areStreamsVisible`). |
| Замки вкладок | `_components/tournament-section-nav.ts` (`buildTournamentSectionNav`, `resolveNavLockReason`). |
| Sticky-хедер сайта | `components/Header.tsx` — `sticky top-0 z-50 h-14`. Рейл липнет под ним: `top: 3.5rem`. |

## 1. Зафиксированные решения

### 1.1 Роуты и редиректы (`frontend/next.config.mjs` → `redirects()`, `permanent: true`)

| Роут | Раздел | Было → 308 |
|---|---|---|
| `/tournaments/[slug]` | **Обзор** (§3) — рендер, не redirect | `page.tsx` сейчас редиректит на bracket/participants/teams — убрать |
| `/tournaments/[slug]/bracket?stage=N&view=bracket\|standings&match=ID` | Сетка (§4) | `/standings` → `/bracket?view=standings` |
| `/tournaments/[slug]/teams?view=list\|cards` | Команды (§5) | — |
| `/tournaments/[slug]/participants?view=pool\|table` | Участники (§6) | — |
| `/tournaments/[slug]/matches?view=round\|time` | Матчи (§7) | — |
| `/tournaments/[slug]/stats?tab=heroes\|maps` | Статистика (§8) | `/heroes` → `/stats?tab=heroes`; `/maps` → `/stats?tab=maps` |
| `/tournaments/[slug]/stream` | без изменений | — |
| удалить | — | `/schedule` → `/tournaments/[slug]#phases` |
| legacy `?tab=` в `page.tsx` | — | обновить таблицу соответствий: `standings` → bracket view, `heroes` → stats, остальные как есть |

`/standings` и `/schedule` могут прийти с `?stage=` — редирект сохраняет query (`has`/`destination` с `:stage`).

### 1.2 Контракт URL-параметров

| Параметр | Где | Значения / дефолт |
|---|---|---|
| `view` | teams, participants, matches, bracket | teams: `list` (default) \| `cards`; participants: `pool` (default для `team_formation ∈ {balancer, draft}`) \| `table`; matches: `round` (default) \| `time` (доступен только когда есть хоть один `scheduled_at`); bracket: `bracket` \| `standings` |
| `tab` | stats | `heroes` (default) \| `maps` |
| `stage` | bracket, matches | id стадии; matches: отсутствует = все |
| `match` | bracket | id encounter — прокрутка + подсветка узла |
| `team` | matches | id команды — фильтр |
| `map` | matches | id карты — фильтр (ведёт из stats?tab=maps) |
| `group` | teams | id/ключ группы; отсутствует = все |
| `sort` | teams | `placement` (default для completed) \| `group` \| `sr` \| `name` |
| `q` | teams, participants | поиск |

Порядок вкладок в рейле — функция фазы (§2 ⑤), не URL.

### 1.3 Общие компоненты (контракт P1 — сабагенты P2–P7 их **используют**, не переписывают)

Размещение: `frontend/src/app/(site)/tournaments/[slug]/_components/`.

```ts
// PhaseTimeline.tsx
type PhaseTimelineProps = {
  schedule: Tournament["phase_schedule"];
  status: TournamentStatus;          // текущая фаза → маркер "сейчас"
  orientation: "horizontal" | "vertical";
  now?: Date;                        // для детерминированных тестов
};

// NextPhaseChip.tsx — "→ чек-ин · сб 14:00 · через 1 д 6 ч"; null, если следующей фазы нет
type NextPhaseChipProps = { schedule: Tournament["phase_schedule"]; status: TournamentStatus; href: string; now?: Date };

// MapPool.tsx — данные готовит хук useTournamentMapPool(tournamentId) (вынести из TournamentMapsPage)
type MapPoolProps = {
  pool: MapPoolView;                 // { byGamemode: { gamemode: Gamemode; maps: MapRead[] }[]; total: number }
  variant: "tiles" | "summary" | "table";   // §3 ④ / §3B "Мап-пул · 12" / §8
  playedCounts?: Record<number, { played: number; avgDurationSec: number | null }>; // только для table
};

// MatchCard.tsx — live/ближайшие (§7 ③); один на Обзор и Матчи
type MatchCardProps = { encounter: Encounter; stageLabel: string; roundLabel: string; live?: boolean; streamsCount?: number; href: string };

// MatchRow.tsx — сыгранные, с раскрытием карт (§7 ⑤)
type MatchRowProps = { encounter: Encounter; leading: string /* "21:00 · R5" | "M10 · Bo5" | "B" */; trailing: string; expandable: boolean; bracketHref: string };

// Podium.tsx (§3 ⑧)
type PodiumProps = { first: TeamRef & { roster: string[] }; second: TeamRef & { note: string }; third?: TeamRef & { note: string } };

// SectionToolbar.tsx — одна полоса: слева чипы, справа поиск/сортировка/сегмент; children-слоты
// ViewSegment.tsx — сегмент "Список / Карточки", пишет ?view= через useQueryParams
```

Все компоненты — `"use client"` только если нужны хуки; иначе серверные. Иконки lucide с `aria-hidden`. Сегменты — `role="tablist"`/`role="tab"` или `<a>` с `aria-current`.

### 1.4 Правила на всех экранах

- Live-состояние — единственный цветовой акцент (teal). Победитель в паре — вес шрифта, не цвет фона.
- Моно-подпись над блоком (`ROUND 2 · BO5`, `ЧЕК-ИН · СБ 14:00`) — класс `aqt-mono` + `text-[11px] uppercase tracking-[.06em]`.
- Empty / error / filtered-empty / refresh-error — только `TournamentPageState` через `getPublicPageQueryPresentation` (как во всех текущих `_views`).
- Раскрытие строк — `<details>`/`<summary>`, не useState на каждую строку.
- ≤ 640px: переключателей видов нет — дефолтный вид.

## 2. Фазы и work units

### P0 — Оболочка (§2). Оркестратор.

**WU-0.1 Заголовок = обложка + состояние.** `_components/TournamentClientLayout.tsx`, `components/site/PageHero.tsx`. **Сделано.**
- Обложка: `coverUrl={tournament.cover_image_url}` в `PageHero`. В `PageHero` — `COVER_BAND_PX = 80`: картинка ровно этой высоты сверху, растворяется в `--aqt-bg`, тот же `80px` идёт в `paddingTop` контента (одно число на оба, иначе заголовок садится на арт). Полоса рисуется НАД сеткой и свечением. Нет обложки → рамка как раньше, ничего не резервируется. §2 ⑦.
- Логотип: `logo_url`, 44px, внутри `title` слева от имени (`title` уже `ReactNode`, новый проп не нужен). §2 ③.
- Убрать `aside` с четырьмя `HeroStat`. `meta` — только состояние: статус · `NextPhaseChip` · лига · счётчик («72 / 120 игроков» в регистрации, «20 команд · 116 игроков» после). §2 ②.
- Убрать из шапки `FORMAT`, team formation и `lede` — они дубль карточки «Формат», которая теперь есть во всех трёх вариантах Обзора (WU-2.x, §3 ⑨). Описание читается там целиком, а не одной обрезанной строкой.
- `aside` — только действия: `TournamentRegisterButton` (не-ended) и «Драфт →» (`team_formation === "draft"` и статус ≠ registration). `TournamentLinkChips` из шапки убрать: чипы с `--aqt-overlay-2` лежали бы на картинке. §2 ④.
- Геометрию секондари-кнопки вынести в `_components/tournamentActionClass.ts` (`TOURNAMENT_ACTION_CLASS`) — до этого одна и та же строка классов была скопирована в `TournamentLinkChips` и `TournamentRegisterButton`, «Драфт →» стал бы третьей копией.
- Подсказку в админке (`admin/tournaments/[id]/settings/general`) поправить: полоса 80px, верх и низ 3:1-картинки обрезаются.
- Замеры (Chrome headless, реальный рендер): 1280 → шапка 211px с обложкой / 147px без; 375 → 333px / 267px, `scrollWidth === clientWidth === 375`. Обложка стоит +66px первого экрана и только когда организатор её загрузил.

**WU-0.2 Рейл.** `_components/TournamentSectionNav.tsx`, `_components/tournament-section-nav.ts` (+ `.test.ts`).
- Секции: `overview | bracket | teams | matches | stats | stream | participants | draft`. `schedule`, `maps`, `heroes`, `standings` удалить из `TournamentSectionId` и из `tournamentSections`. `draft` из рейла убрать (он в шапке).
- Порядок — функция фазы (§2 ⑤): `competitionStarted ? [overview, bracket, teams, matches, stats, stream, participants] : [overview, participants, teams, bracket, matches, stats]`. Замки — те же причины; `stats` наследует правила `heroes`.
- `sticky top-14 z-40` + фон. Левый слот: короткое имя турнира, видимо только когда h1 шапки вне viewport (`IntersectionObserver`, один boolean в состоянии; SSR — скрыто). Правый слот: `NextPhaseChip` + `TournamentRegisterButton` (sm) в том же условии. §2 ⑥. **Никакого отдельного компактного заголовка.**
- `observeTournamentRail`/скролл-стрелки — как есть.

**WU-0.3 Дефолт.** `page.tsx`: убрать `getDefaultTournamentPath`-редирект; страница рендерит Обзор (P2 заполнит; до P2 — рендерит `TournamentShellSkeleton`-подобную заглушку **только в рамках P0-ветки оркестратора**, к моменту мерджа P2 её нет). Таблицу `?tab=` обновить по §1.1.

**WU-0.4 Редиректы.** `next.config.mjs`: строки из §1.1. Удалить каталоги `schedule/`, `maps/`, `heroes/`, `standings/` вместе с их `page.tsx` **в P8** (до этого сабагенты P6 ещё используют вью из `_views`).

Тесты: `tournament-section-nav.test.ts` — порядок по фазе, отсутствие удалённых секций, `draft` не в рейле. `tournamentOverview.behavior.test.tsx` — корневой роут не редиректит.

### P1 — Общие компоненты (§1.3). Оркестратор.

**WU-1.1 `PhaseTimeline` + `NextPhaseChip`.** Источник логики — `_views/tournamentSchedule.model.ts` (уже считает порядок фаз и текущую). `TournamentSchedulePage.tsx` после этого удаляется в P8. Тесты: модель — расширить `tournamentSchedule.model.test.ts` (следующая фаза, «осталось N»), компонент — один behavior-тест на оба orientation.

**WU-1.2 `useTournamentMapPool` + `MapPool`.** Вынести `collectPoolIds`/`buildStageViews`/`keepPlayableLevels` из `TournamentMapsPage.tsx` в `_hooks/useTournamentMapPool.ts`; агрегировать до `byGamemode` (пул на уровне турнира = объединение всех кандидатов всех конфигов; если пулы стадий различаются — `MapPool` получает `stages?: { title; pool }[]` и рисует вкладки стадий внутри карточки). `TournamentMapsPage.behavior.test.tsx` → переписать на хук+компонент.

**WU-1.3 `MatchCard` + `MatchRow`.** Извлечь разметку узла из `BracketView.tsx` **копированием в новый компонент**, не рефакторингом BracketView (KEEP). `MatchRow` — из `EncountersTable.tsx` строки; раскрытие карт — `<details>`, содержимое: карты encounter'а (счёт, длительность, режим), ссылки «лог» и «пре-гейм» (те же href, что иконки в сетке).

**WU-1.4 `Podium`, `SectionToolbar`, `ViewSegment`.** Тривиальные; `ViewSegment` пишет через `useQueryParams`, на ≤ 640px возвращает `null`.

После P1 оркестратор коммитит и **фиксирует пропсы** — сабагенты P2–P7 стартуют от этого коммита.

### P2 — Обзор (§3). Сабагент A.

Файлы: `page.tsx` (рендер), новый `_views/TournamentOverviewPage.tsx` + `.behavior.test.tsx`, `_components/TournamentSkeletons.tsx` (добавить `TournamentOverviewSkeleton`).

- Три ветки по `status`: регистрация (`draft|registration|check_in`) → §3A; `live|playoffs` → §3B; `completed|archived` → §3C. Одна компонента, три композиции; никаких трёх файлов.
- §3A: `PhaseTimeline horizontal` первым блоком (`id="phases"`); прогресс регистрации по ролям — из `registrations_count` и ролей регистраций (запрос участников уже есть у `TournamentParticipantsPage` — переиспользовать его query key, не заводить второй); для `team_formation === "registration"` — «команд N / M». Формат — `formatLabel` + `roster_shape`. `MapPool tiles` (`id="map-pool"`). Ссылки — `TournamentLinkChips`.
- §3B: live-encounters (по статусу/`started_at`) → `MatchCard` ×N; нет live → «Ближайшие» (если есть `scheduled_at` в будущем) → иначе «Последние результаты» ×4 `MatchRow`. Мини-сетка: **не** рендерить `BracketView`; показать 3–4 колонки текущего и соседних раундов активной стадии компактными `MatchCard`-мини (пропс `size="sm"` в MatchCard). Клик → `/bracket?stage=&match=`. Для round_robin/swiss активной стадии — компактная таблица группы из данных standings (запрос — тот, что у `TournamentStandingsPage`).
- §3C: `Podium` (первый/второй — финал; третий — победитель lower-финала при double elim, иначе третий по standings); сетка последней стадии как в §3B; топ-5 героев — `heroService.getHeroPlaytime` с тем же query key, что в `TournamentHeroPlaytimePage`; «Мап-пул · N» summary; цифры.
- Правая колонка в §3B/§3C: `PhaseTimeline vertical`, стрим-постер (только если `streams.official.length > 0`; без автоплея — Dock уже есть), `MapPool summary`, «Цифры».
- **Справочный хвост — во всех трёх ветках** (§3 ⑨⑩), потому что шапка его больше не несёт: карточка «Формат» (`formatLabel` + стадии + team formation с глифами `roster_shape` + полное `description`) и последней — «Ссылки» (`TournamentLinkChips`). В §3A «Формат» остаётся в левой колонке под прогрессом регистрации (иначе левая колонка — одна карточка), в §3B/§3C — в правой перед «Ссылками». Признак «рисовать ли заголовок карточки ссылок» — `visibleTournamentLinks(links).length > 0`, экспортируемый из `TournamentLinkChips`: реестр чипов один, и турнир с одной только стрим-ссылкой карточку не получает. В §3A правая колонка теперь появляется и ради одних ссылок (`hasAside`), не только ради мап-пула.
- Тест: три ветки по статусу, `#phases` присутствует в регистрации, при отсутствии live рендерится fallback; «Формат» и «Ссылки» присутствуют во всех трёх статусах; ссылки без мап-пула дают правую колонку; стрим-ссылка карточку не создаёт.

### P3 — Матчи (§7). Сабагент B.

Файлы: `_views/TournamentEncountersPage.tsx` (переписать) + `.behavior.test.tsx` (новый), `matches/page.tsx` (пробросить searchParams).

- Тулбар: чипы стадий (`?stage=`), `ViewSegment` `round|time` — сегмент `time` **отсутствует**, если ни у одного encounter нет `scheduled_at`; фильтр команды `?team=` (чип с ×); `?map=` — фильтр по карте в сыгранных (приходит из P6).
- `view=round` (default): группы по стадии → раунду, порядок от финала к первому раунду (§7 ⑥); заголовок группы — `day`-стиль (`ПЛЕЙ-ОФФ · GRAND FINAL`); строки `MatchRow` с `leading` = «M10 · Bo5» для плей-офф, буква группы для round robin.
- `view=time`: секции `СЕЙЧАС` (live → `MatchCard` в 2 колонки), `ДАЛЬШЕ СЕГОДНЯ · <дата>` (будущие `scheduled_at` сегодня → `MatchRow` с `vs`), затем дни по убыванию с сыгранными. Название стадии в заголовке дня — из `phase_schedule`, если день ∈ фазе (§7 ④).
- Убрать бар «%» и «TBD» (§7 ⑥). Если это `closeness` балансера — показывать в раскрытии строки с подписью «прогноз», не в строке.
- Тест: без `scheduled_at` сегмента `time` нет; с `scheduled_at` — есть и группирует по дням; `?team=` фильтрует.

### P4 — Команды (§5). Сабагент C.

Файлы: `_views/TournamentTeamsPage.tsx` (переписать) + `.behavior.test.tsx` (новый), `teams/page.tsx`.

- Один `SectionToolbar`: чипы групп (`?group=`), поиск по команде **и игроку** (`?q=`), сортировка (`?sort=`), `ViewSegment` `list|cards` + `localStorage("owt:teams-view")` как вторичный источник дефолта (URL главнее).
- `view=list`: строка = seed · лого · имя (+группа/«чемпион») · AVG SR · 5 глифов ролей из `roster_shape` (title = battletag) · W–L · шеврон; раскрытие — `<details>` с таблицей состава (роль, battletag, ранг/дивизион, топ-3 героя, пометка Main/Flex/New role текстом), кнопки «Матчи команды →» (`/matches?team=`) и «Профиль команды» (существующий роут команды, если есть; иначе кнопки нет). §5 ②③④.
- `view=cards`: **существующая** карточка команды из текущего `TournamentTeamsPage` без визуальных изменений, но подчинённая общим фильтрам/сортировке/поиску; при `?q=` совпавший игрок подсвечен (`<mark>`), несовпавшие команды скрыты. §5 ⑤.
- W–L — из encounters команды (запрос уже есть для матчей; если его нет в этой вью — взять `encounterService` тем же key, что P3; при отсутствии данных колонка «—», не заглушка).
- Тест: `?view=` переключает, `?q=` по игроку оставляет только его команду в обоих видах, `?sort=sr` сортирует.

### P5 — Участники, режим «пул» (§6). Сабагент D.

Файлы: `_views/TournamentParticipantsPage.tsx`, `_views/_components/participants-url-state.ts` (+тест), новый `_views/_components/ParticipantsPool.tsx` + `.behavior.test.tsx`, `_views/_components/VirtualParticipantsList.tsx` — **только** гейтирование колонок.

- `team_formation ∈ {balancer, draft}` → `ViewSegment` `pool|table`, default `pool`; иначе сегмента нет, таблица как сейчас (KEEP).
- `pool`: три колонки по ролям из `roster_shape` (танк/дпс/саппорт — по слотам, не хардкод), внутри — сортировка по SR/дивизиону убыв.; строка: battletag · «D3 · 3540» · топ-3 героя; флекс (несколько ролей) — в каждой своей колонке с `↔` и `title`. §6 ②③. Поиск `?q=`, фильтр дивизиона (существующий из `participants-url-state`). Отозванные — `<details>` «Отозвали заявку (N)» внизу. §6 ④.
- `table` (и режим A): публично скрыть колонки `balancer`, `check_in`, `notes`, `smurf`, `subscription` — они остаются в `ColumnPicker` только когда у пользователя есть право (`usePermissions`, как в админке). Это гейт в конфиге колонок, не в компоненте таблицы.
- После старта соревнования — баннер над разделом «Команды сформированы → Команды» (`PageStateCard`-подобный, ссылка на `/teams`).
- Тест: `team_formation: "draft"` → default `pool`, три колонки, флекс в двух; `"registration"` → сегмента нет; админские колонки не рендерятся без права.

### P6 — Статистика (§8). Сабагент E.

Файлы: новый `stats/page.tsx`, новый `_views/TournamentStatsPage.tsx` + `.behavior.test.tsx`; `_views/TournamentHeroPlaytimePage.tsx` становится вкладкой `heroes` (перенос содержимого, файл удалить); `_views/TournamentMapsPage.tsx` — удалить (его логика ушла в `useTournamentMapPool` в P1).

- Под-вкладки `?tab=heroes|maps` (`tabs sub`), не рейл.
- `heroes` — текущий список с барами + фильтр ролей, без изменений, плюс роль в подписи.
- `maps` — `MapPool variant="table"` с `playedCounts`: сыграно / ср. длительность / атака-защита (только для режимов с атакой). Источник числа сыгранных — карты encounters турнира (тот же запрос, что раскрытие в P3; если агрегата нет в API — считать на клиенте из загруженных encounters; если и их карт нет — колонки «—»). Строки — весь пул, включая 0. «матчи →» → `/matches?map=ID`. §8 ②.
- Замок вкладки в рейле — как у бывшего `heroes` (до старта — locked).
- Тест: `?tab=` переключает; несыгранная карта пула присутствует с 0.

### P7 — Расписание матчей: админский ввод (§7 DATA). Сабагент F. Независим от P0–P6.

Файлы: `frontend/src/app/admin/tournaments/[id]/bracket/components/StageEditor.tsx` (или `StageSettingsSections.tsx` — где секции настроек стадии), `frontend/src/components/tournaments/EncounterEditDialog.tsx`, `frontend/src/services/encounter.service.ts` (добавить метод, если нет `updateEncounter` с `scheduled_at`), тесты рядом.

- **Без backend-изменений**: `scheduled_at` уже в `EncounterUpdate` admin-схеме.
- В редакторе стадии — секция «Расписание раундов»: таблица `раунд → datetime-local`; «Применить» — для каждого encounter раунда без индивидуального override `PATCH scheduled_at`. Override = `scheduled_at` отличается от времени раунда на момент применения; хранить не надо — сравнение на лету, при повторном применении спрашивать «перезаписать N индивидуальных времён?» (`ConfirmDialog`).
- В `EncounterEditDialog` — поле «Время начала» (`datetime-local`, nullable). Это и есть точечный override.
- Показать время в админской таблице encounters (`matches/encounters/page.tsx`) — одна колонка.
- Тест: применение расписания раунда шлёт PATCH на каждый encounter раунда; поле в диалоге сохраняется.

`ponytail:` матчи, сгенерированные после «Применить», времени не получат — организатор жмёт «Применить» ещё раз. Backend-хук на генерацию сетки — когда это начнёт мешать.

### P8 — Мобильный, чистка, сборка (§9, §10). Оркестратор, после мерджа P2–P7.

- Удалить: `schedule/`, `maps/`, `heroes/`, `standings/` каталоги; `_views/TournamentSchedulePage.tsx`, `TournamentStandingsPage.tsx` (standings рендерится внутри bracket — проверить, что `bracket?view=standings` работает без него; если он и есть та реализация — переместить в `bracket/`), их тесты; удалённые i18n-ключи из обеих локалей.
- Мобильный: `≤ 640px` — `ViewSegment` скрыт; рейл горизонтально скроллится (уже есть); Сетка — колонка `MatchCard` одного раунда + селектор раунда (§9 ②) — **единственное** разрешённое изменение в `bracket/`: обёртка, которая на `< 768px` рендерит список вместо `BracketView`, сам `BracketView` не трогать.
- Проверка в браузере на 375 / 768 / 1280 / 1440 для каждого раздела в трёх статусах (есть турниры в БД в каждом статусе? если нет — завести через админку): `document.documentElement.scrollWidth <= innerWidth`, accessibility tree без безымянных интерактивов, одна sticky-полоса под хедером сайта.
- `rtk npm run typecheck`, `rtk vitest run` (весь), `rtk next build`.
- Записать в Graphiti одним фактом: решение «рейл sticky, заголовок нет — потому что хедер сайта уже sticky» и причину.

## 3. Параллелизация для сабагентов

| Сабагент | WU | Владеет файлами | Читает, не меняет |
|---|---|---|---|
| A | P2 | `page.tsx`, `_views/TournamentOverviewPage*`, `TournamentSkeletons.tsx` (только добавление) | всё из P1, `_views/TournamentStandingsPage.tsx`, `TournamentHeroPlaytimePage.tsx` (query keys) |
| B | P3 | `_views/TournamentEncountersPage*`, `matches/page.tsx` | P1, `bracket/bracketLiveStreams.ts` |
| C | P4 | `_views/TournamentTeamsPage*`, `teams/page.tsx` | P1 |
| D | P5 | `_views/TournamentParticipantsPage*`, `_views/_components/ParticipantsPool*`, `participants-url-state*`, `VirtualParticipantsList.tsx` (гейт колонок) | P1 |
| E | P6 | `stats/**`, `_views/TournamentStatsPage*`, удаление `TournamentHeroPlaytimePage.tsx`, `TournamentMapsPage*` | P1, `_hooks/useTournamentMapPool.ts` |
| F | P7 | `admin/tournaments/[id]/bracket/components/*`, `components/tournaments/EncounterEditDialog*`, `services/encounter.service.ts` (добавление), `admin/tournaments/[id]/matches/encounters/page.tsx` | — |

Общие файлы, которые трогают несколько сабагентов: **`i18n/messages/{ru,en}.json`** — каждый добавляет ключи только в своём неймспейсе (`tournamentDetail.overview.*`, `.matches.*`, `.teams.*`, `.participantsPool.*`, `.stats.*`, `admin.roundSchedule.*`); конфликты при мердже тривиальны. `TournamentSkeletons.tsx` — только A добавляет. Всё остальное — непересекающееся.

Сабагенты **не** запускают полный typecheck/vitest/build — только по своим файлам. Не коммитят — оркестратор мерджит и коммитит по WU.

## 4. Backend gaps

Нет. `phase_schedule`, pick-ban конфиги (мап-пул), `Encounter.scheduled_at` (чтение и admin-запись) — всё есть. Единственный кандидат на будущее — проставление `scheduled_at` при генерации сетки из расписания раундов (см. `ponytail:` в P7).

## 5. Решения по умолчанию (не спрашивать)

- Мап-пул на уровне турнира = объединение кандидатов всех конфигов; при различающихся пулах стадий — вкладки стадий внутри `MapPool`.
- «3 место» при double elimination — проигравший lower-финала; при single elimination — не показывать третью тумбу; при group-only — третий по standings.
- Часовой пояс фаз: отображение в локальном поясе браузера с подписью TZ; переключатель «МСК / мой» — `useState`, без сохранения.
- Дефолт `view` для teams — `list`; для participants в TF-турнире — `pool`; для matches — `round`.
- Если в БД нет турнира в нужном статусе для проверки — фикстуры behavior-тестов считаются достаточным доказательством для этого статуса; сказать об этом в отчёте.
