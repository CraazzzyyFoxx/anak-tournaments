# OWT Design Book — «Editorial Tactical»

> Единый источник правды по дизайн-системе фронтенда OWT.
> Интерактивная версия: [`/docs/design-book.html`](../frontend/public/docs/design-book.html).
> Статус: **v2 — токены сверены** с `frontend/src/app/globals.css` (реальные `--aqt-*`, не прототипные `--bg`/`--brand`); правила ниже размечены как **Verified** (подтверждено кодом), **Specified** (только в этой книге, в коде не реализовано) или **Fixed** (баг, найденный и уже исправленный апстрим).

Направление — **Editorial Tactical**: воздушный редакционный лейаут (hairline-разделители, открытые блоки вместо рамок, крупные mixed-case заголовки) + тактический/broadcast голос (едва заметная координатная сетка, mono-лейблы, крупный гротеск на числах). Dark-only.

Три тезиса:

1. **Air over boxes** — группировка воздухом и hairline-линиями; рамочная карточка только для плотных данных.
2. **Numbers are telemetry** — статистика в гротеске + mono, табличные цифры, как broadcast-оверлей.
3. **Meaning over decoration** — цвет и role-spectrum кодируют данные, никогда не украшают. Ведёт одна бирюза.

---

## 1. Токены

Источник правды — `:root` в `frontend/src/app/globals.css`. Ниже — реальные `--aqt-*` (Verified), не отдельная схема, которую предстоит алиасить.

```css
:root {
  /* ground & elevation — 4 ступени, вложенность — оверлеи, не новый серый */
  --aqt-bg:hsl(220 21% 5%); --aqt-bg-2:hsl(220 22% 7%); --aqt-card:hsl(220 22% 8%); --aqt-card-2:hsl(222 24% 11%);
  --aqt-border:hsl(219 19% 15%); --aqt-border-2:hsl(217 17% 21%); --aqt-border-3:hsl(216 16% 26%); /* ровно ТРИ бордера, -3 = active/focus/scrollbar */

  /* text — 4 ступени */
  --aqt-fg:hsl(214 33% 96%); --aqt-fg-muted:hsl(212 13% 65%); --aqt-fg-dim:hsl(213 9% 58%); --aqt-fg-faint:hsl(214 10% 52%);

  /* accent */
  --aqt-teal:hsl(172 70% 49%);                        /* одна бирюза, без дрейфа hue */
  --aqt-warm:hsl(36 88% 65%);                         /* = --aqt-amber, ТОЛЬКО featured-моменты */

  /* roles */
  --aqt-tank:hsl(209 82% 65%); --aqt-damage:hsl(337 81% 66%); --aqt-support:hsl(150 57% 52%);
  --aqt-spectrum:linear-gradient(90deg,var(--aqt-tank),var(--aqt-damage),var(--aqt-support));

  /* results & quality — ОТДЕЛЬНЫЕ токены, не роли и не статусы */
  --aqt-win:hsl(150 57% 52%); --aqt-loss:hsl(349 84% 63%); --aqt-draw:hsl(36 88% 65%);
  --aqt-good:var(--aqt-win); --aqt-mid:var(--aqt-draw); --aqt-bad:var(--aqt-loss);

  /* statuses */
  --aqt-status-live:hsl(349 84% 63%); --aqt-status-upcoming:hsl(36 88% 65%); --aqt-status-finished:hsl(213 9% 47%); --aqt-status-draft:hsl(215 83% 66%);

  /* podium */
  --aqt-gold:hsl(42 63% 60%); --aqt-silver:hsl(212 21% 73%); --aqt-bronze:hsl(26 49% 54%);

  /* shape */
  --aqt-radius-card:12px; --aqt-radius-sm:8px; --aqt-radius-xs:4px; --aqt-radius:14px; /* hero */
}
```

Каждое `--aqt-*` объявлено **один раз** как HSL-триплет (`--aqt-h-*`) и раскрыто дважды — как готовый цвет и как голый триплет для shadcn-слоя (`--primary: var(--aqt-h-teal)`). Так переопределение shadcn-имени внутри скоупа не может превратиться в `hsl(hsl(...))` — см. §0 в `frontend/DESIGN.md`.

### Правила семантики цвета

| Контекст | Токены | Примеры |
|---|---|---|
| Результат | `--aqt-win / --aqt-loss / --aqt-draw` | счёт `3–1`, W-D-L, form-чипы, map-пипсы |
| Качество | `--aqt-good / --aqt-mid / --aqt-bad` | winrate %, дельты ▲/▼, impact-бары, DIFF |
| Роль | `--aqt-tank / --aqt-damage / --aqt-support` | иконки ролей, role-бары, тинты аватарок |
| Статус | `--aqt-status-live / --aqt-status-upcoming / --aqt-status-finished / --aqt-status-draft` | бейджи турниров |

- Порог цвета winrate: **≥60% → good, 50–59% → mid, <50% → bad**.
- Сегодня `--aqt-win`≡`--aqt-support`, `--aqt-loss`≡`--aqt-status-live`, `--aqt-draw`≡`--aqt-warm` по hue (150/349/36) — это осознанно, но токены развязаны: любую группу можно перекрасить, не трогая остальные.
- **Role-spectrum (градиент tank→damage→support) — семантика, не декор**: только как role-distribution bar (состав команды) и фирменный hairline шапки профиля.
- `--aqt-warm` (= `--aqt-amber`) как акцент — только для featured (главный турнир, титулы).

## 2. Типографика

| Роль | Шрифт | Причина |
|---|---|---|
| UI + заголовки | **Inter** (400/500/600/700) | mixed-case, **никогда** condensed-caps |
| Display + крупные числа | **Onest** (500/600/700/800) | кириллица-нативный геометрический гротеск: «Grand Final» и «Гранд-финал» — одна пластика. Space Grotesk отклонён — у него нет кириллицы |
| Данные, лейблы, «тактический голос» | **JetBrains Mono** (400/600/700) | mono-координаты, uppercase-лейблы с разрядкой `.08–.16em`, `tabular-nums` |

```tsx
// app/layout.tsx — шрифты самохостятся (next/font/local), NOT next/font/google:
// next/font/google фетчит с fonts.gstatic.com на этапе сборки, и продакшен-сборка
// однажды упала на ротации хешей. Классы .variable висят на <html>, не на <body> —
// globals.css алиасит их из :root (--aqt-mono/--aqt-display), а custom property
// резолвится там, где объявлена: алиас на :root не видит переменную,
// заданную на уровень ниже (<body>).
import localFont from "next/font/local";

const inter = localFont({ src: "./fonts/inter-variable.woff2", variable: "--font-inter" });
const onest = localFont({ src: "./fonts/onest-variable.woff2", variable: "--font-onest" });
const jetbrainsMono = localFont({ src: "./fonts/jetbrains-mono-variable.woff2", variable: "--font-jetbrains-mono" });

// <html className={cn(inter.variable, onest.variable, jetbrainsMono.variable)}>
```

Шкала: display 52/700 (Onest) · h1 30/600 · h2 22/600 · title 17/600 · body 15/400 · data mono 15 · label mono 11 uppercase. **Пол читаемости — 11px**: 9–10px допустимы только для декоративных mono-координат, которые не обязаны читаться.

## 3. Роли, дивизионы, аватарки

### Role-маркеры — где какой вид

| Поверхность | Вид |
|---|---|
| **Role split** (единственное место) | иконка + mono-лейбл |
| Таблицы и строки (ростеры, hero-таблицы, лидерборды) | **только иконка**, имя роли в `title`/`aria-label` |
| Мета-строки (шапка «Tank main», подзаголовок турнира) | только текст |

Иконки — стандартные проектные `TankIcon/DamageIcon/SupportIcon` (`PlayerRoleIcon`), viewBox `0 0 40 40`. Не переизобретать.

### Дивизионы

Только иконкой (`DivisionIcon`/`PlayerDivisionIcon` + `lib/division-grid.ts`), имя дивизиона — в `alt`/`title`. Текстом дивизион не пишем нигде на display-поверхностях; список имён допустим только в форме выбора ранга (это ввод, не display).

### Hero-аватарки (`HeroImage` / `HeroStrip`)

| Контекст | Размер |
|---|---|
| Стандартный стек (строки матчей, ростеры, teammates) | **30px** |
| Компактные detail-строки (раскрытия матчей, dossier-раны) | 24px |
| Inline в таблицах (top heroes) | 26px |
| Одиночная аватарка (sidebar-строки) | 32px |

Стек схлопывается в `+N`; наложение −9px; у аватарок игроков (не героев) — маркер `data-players`, чтобы hero-popover их не трогал.

## 4. Доступность — обязательный пол

- **Никогда color-only**: W/L-квадраты несут буквы, trend-точки — кольцо у подиума и полую форму у нижнего бакета, result-чипы — буквы W/L/D.
- **Каждый hover-поповер** (hero stats, MVP-разбор) открывается также по **focus** и **tap**: триггер `tabindex="0"` + `aria-label`, тап вне закрывает, скролл прячет.
- `:focus-visible` — бирюзовый outline 2px на всём интерактиве; `prefers-reduced-motion` глушит все анимации; табы — `role=tab/tabpanel`; модалки — focus-trap + возврат фокуса + Esc.
- Контраст: `--aqt-fg-faint` (52% L) — минимум для текста на `--aqt-bg` (текстовый ramp — 4 ступени 96/65/58/52%, все различимы и упорядочены).

## 5. Честность данных

- **Нет SR/MMR** — в системе их не существует, не выдумывать ни в статистике, ни в ачивках.
- **Encounter ⊃ Matches**: встреча = серия против оппонента (счёт `3–1`), внутри — матчи-карты; статистика (герои/KDA/MVP) живёт per-match; encounter показывает агрегаты (median MVP, avg KDA, стек героев). Не подписывать encounter именем одной карты.
- **Mix-турниры**: у игрока нет постоянной команды — команда осмысленна только в контексте турнира. Никаких «pre-filled» команд в профиле.
- **Per-workspace**: цифры профиля живут в контексте одного сообщества; агрегированные списки сообществ как подпись к цифрам не показываем.
- **Low-sample gate**: перцентили и vs-avg скрываются при **n < 10 игр** — em dash + `title` с правилом + бейдж `LOW SAMPLE`. «Top 2%» на 3 играх — шум.
- **Нет «сезонов»** — только турниры; фрейминг по турнирам/периодам.
- Один термин на метрику: **Closeness** (не Proximity), глоссарий-`title` при первом употреблении.

## 6. Ключевые паттерны

- **Scouting report** — вердикт-предложение в шапке профиля вместо голых цифр; данные генерируются по правилам с порогами, при малой выборке — не показывается.
- **Перцентильный язык** «Top X%» + **горизонтальный перцентиль-бар** под значением (fuller = better). Вертикальный тик отклонён: кодирование, требующее подписи, — провалившееся кодирование.
- **Lobby leaderboard**: каждый per-stat KPI-тайл — кнопка, открывающая модалку со всеми игроками лобби по этой статистике: чипы-статы, медали топ-3, твоя строка подсвечена (`ранг + top X%`), бар vs лидера; инверсные статы (Deaths) ранжируются по возрастанию с пометкой «lower is better».
- **Master-detail** для списков турниров (Event dossier + компактный список) — вместо таблиц с аккордеонами.
- **Digest-блоки**: каждый блок Overview, превьюящий другую вкладку, несёт «View all →», переключающий на неё.
- **Empty states** двух видов: страничный (приглашение к действию) и filter-zero внутри списков (причина + inline «Reset filters»). Отфильтрованный список никогда не пустеет молча.
- **Даты**: относительные `2d ago` + абсолютная дата в `title`. Голое `2D` запрещено — коллизия с буквой Draw.
- **Deep links**: экран, вкладка, фильтры, поиск и выбранный турнир живут в URL (`searchParams` в Next). Состояние, кинутое ссылкой в Discord, открывается ровно таким же.
- **Share card**: Player card рендерится в PNG 1200×630 (OG) на canvas — сетка, spectrum-полоса, Onest-цифры, form-чипы, URL профиля; clipboard + download-фолбэк.
- **MVP-ordinal**: везде единый вид — `1st` золотом, остальные `--aqt-fg-faint`, hover/tap-разбор по картам.
- Модалки в реальном коде — shadcn `Dialog`; компоненты — `components/ui/` (не самодельные оверлеи; portals вне `.cRoot` не видят токены).

## 7. Лейаут

- Ширина контента: `max-width:1400px` (1180 — узко) — **Specified**, в коде не реализовано. Реальный контейнер сайта — `1720px` (`screen-3xl`, `frontend/tailwind.config.ts`, применяется в `(site)/layout.tsx`) с `px-4/md:px-6/xl:px-10` гаттерами — **Verified**. 1400px остаётся целью для будущего сужения читаемой колонки, не описанием текущей вёрстки.
- Overview профиля — две флекс-колонки (`main flex:1` + `sidebar 380px`), карточки пакуются плотно без grid-щелей; на мобиле колонкам нужен `align-items:stretch`.
- Числовые колонки таблиц: `th.num { text-align:right }` обязан бить `table.tbl th` по специфичности.
- Wide-контент (таблицы, brackets) — горизонтальный скролл внутри своего контейнера (`.tblw`), тело страницы не скроллится вбок.

## 8. Changelog решений (прототип v22 → v48)

| Версия | Решение |
|---|---|
| v22–25 | Табы профиля, scouting report, перцентильный язык, mobile-фиксы (`min-width:0` на grid-детях), a11y-проход |
| v27–35 | Подстраница Tournaments: реальные поля API, без выдуманных MVP/дат; отказ от аккордеонов после 5 итераций |
| v40–42 | **Master-detail** «Event dossier»; ростер-таблица: роль иконкой, дивизион иконкой, Avg MVP |
| v43 | Типо-шкала +1px для всего ≤14.5px (жалоба «мелко») |
| v44 | Герои матча = стек 1–3+N (в OW играют несколькими героями); индикатор LOG; модалка всех оппонентов |
| v45 | `th.num` фикс выравнивания; нормализация вложенных отступов |
| **v46** | **Onest** вместо Space Grotesk (кириллица); токены `--win/--loss/--draw` + `--good/--mid/--bad`; буквы в map-results; кольца/полости на trend-точках; Achievements-грид с рабочими фильтрами; фасетные фильтры Matches + кликабельный «By stage»; шрифты в артефакте — data-URI |
| **v47** | Правило role-маркеров (икон+текст только в Role split); аватарки 24→30px; горизонтальные перцентиль-бары; Closeness; `2d ago`; «View all →»; приглушённые провайдер-чипы |
| **v48** | Lobby leaderboard из KPI-тайлов; touch/keyboard-поповеры; low-sample gate + filter-zero empty state; deep links в hash; Share → PNG |

## 9. Verified upstream — найдено и уже исправлено

- **`:root`-vs-`<body>` font trap.** До недавнего прохода стек не рендерился: `globals.css` алиасил переменные `next/font` из `:root`, а `layout.tsx` вешал `.variable`-классы на `<body>`. Custom property резолвится там, где объявлена, поэтому на `:root` переменной не было — а провалившийся `var()` отравляет всё значение целиком, так что литеральный фолбэк рядом тоже не срабатывал. Все 73 обращения к `--aqt-mono`/`--aqt-display` в `globals.css` тихо рендерились в Inter. Исправлено переносом классов на `<html>` (`app/layout.tsx:109-116`).
- **Uppercase на display-блоках.** `globals.css` когда-то форсил `text-transform:uppercase` на 52px display-блоках — прямое нарушение §2 «никогда condensed-caps». Сейчас оба блока в mixed-case; `uppercase` в коде остаётся только на mono-лейблах (правильное использование).

## 10. Что осталось до кода (Phase 0+)

- Spacing-scale токены; консолидация ~10 metric-tile примитивов в один компонент.
- `title` → `aria-label`/`alt` на дивизионах (в реальной сборке `DivisionIcon` уже с alt).
- Формализовать «verdict» и «Top X%» как компоненты дизайн-системы с правилами генерации и локализацией (RU-шаблоны пишутся, не переводятся).
- Skeleton-состояния в эстетике системы (mono-координаты + hairline-каркас).
- Сузить читаемую колонку до 1400px (сейчас 1720px по всей ширине) — если редактура решит, что это всё ещё нужно.
