# Tournament System Refactor — Roadmap

Статус на 2026-04-18 (итог сессии):
- ✅ Phase A (groups → stages) — done
- ✅ Phase B (minimal) — canonical `_completed_encounters` предикат
- ✅ Phase C (core) — SE/DE/RR/Swiss rewritten, EncounterLink-graph, Grand Final Reset lazy, 26 invariant-тестов
- ✅ Phase D (transactional recalc) — single-transaction DELETE+INSERT
- ✅ Phase E (minimal) — `sort_matches` и `completed_encounters` вынесены в `shared/services/tournament_utils.py`
- ✅ Phase F (minimal) — `invalidateTournamentWorkspace` расширен на все cache keys (public + admin), `StageManager` переведён на общий helper

Остальное — отдельными PR (detail ниже).

---

## Что уже сделано (этот PR)

### Bug fix: «сетка ≠ encounters в админке»
- **Корень**: `parser-service/src/services/encounter/service.py::create` писал только `tournament_group_id`, оставляя `stage_id`/`stage_item_id = NULL`. Публичная сетка (`TournamentBracketPage.tsx`) фильтровала по `stage_id` + `stage_item_id` и такие encounters не видела, админка показывала все.
- **Фикс**:
  - `shared/services/stage_refs.py` — единый резолвер `StageRefs` из `tournament_group_id`.
  - `service.create`/`service.update` в parser — теперь всегда проставляют stage refs.
  - Challonge-sync (`_create_encounters_from_challonge`) — self-heal existing encounters.
  - `create_group` в parser-tournament-service — сразу создаёт `Stage + StageItem` для каждой новой `TournamentGroup`, чтобы новые группы не были orphans.
  - `app-service/src/services/encounter/flows.py::to_pydantic` — tolerant fallback: если `stage_id IS NULL` но есть `tournament_group_id`, резолвит на лету (без мутации модели).
  - Backfill-миграция `phasea0001` — одноразовая пропайпка существующих orphan данных.

### Phase A — groups → stages (почти целиком)
- Миграция `phasea0001_tournament_phase_a_backfill.py`:
  - Backfill всех orphan-групп (Stage + StageItem + linkage).
  - Backfill `encounter.stage_id`/`stage_item_id` из `tournament_group_id`.
  - Backfill `standing.stage_id`/`stage_item_id`.
  - `Standing.group_id` → nullable.
  - Новый `uq_standing_tournament_stage_item_team` (COALESCE на `stage_item_id`).
  - `ix_encounter_stage_item_round` индекс для публичной сетки.
- Модель `Standing`:
  - `group_id: int | None` + `ondelete="CASCADE"` сохранено.
  - Старый `UniqueConstraint("tournament_id", "group_id", "team_id")` удалён из ORM; реальный unique живёт как COALESCE-индекс в БД.
- `_resolve_compat_group_id` в parser-standings-service теперь возвращает `int | None` и логирует (не кидает), когда compat-группы нет.

### Phase B (minimal)
- `_completed_encounters` — единственный источник правды: `status == COMPLETED` OR `result_status == CONFIRMED`. Правило «ненулевой счёт = сыграно» убрано, оно маскировало рассинхроны state-machine.

### Phase C — bracket engine
- Новая модель `EncounterLink(source_encounter_id, target_encounter_id, role, target_slot)` + миграция `phasec0001_encounter_links.py`.
- Новые enum типы `encounterlinkrole` и `encounterlinkslot` в schema `tournament`.
- `shared/services/bracket/types.py` — `Pairing.local_id` + `BracketSkeleton.advancement_edges`.
- `single_elimination.py` — полная переработка:
  - Удалён мёртвый `round1_winners`.
  - R2+ количество матчей правильно считается из числа реальных + bye-advance позиций.
  - Каждый матч R2+ получает advancement edges (winner → target slot).
- `double_elimination.py` — переписан:
  - Явные UB advancement edges (winner of UB Rk → UB R(k+1)).
  - Loser of UB Rk → LB dropout round (cross-drop pattern).
  - LB reduction rounds с winner edges.
  - GF получает home = UB-champion, away = LB-champion.
  - `include_reset=False` по умолчанию (Grand Final Reset материализуется lazy).
- `swiss.py` — Monrad **top-half vs bottom-half** (вместо 1v2/3v4), трекинг `bye_history`, антирематч.
- `round_robin.py` — добавлен `local_id`, без advancement edges (standings-only).
- `shared/services/bracket/advancement.py` — `persist_advancement_edges` и `advance_winner`.
- `admin/stage.py::_create_encounters_from_skeleton` — async, после `session.flush()` строит `local_id → encounter.id` мэппинг и сохраняет `EncounterLink`.
- `admin/encounter.py::update_encounter` — после сохранения изменений зовёт `advance_winner` перед коммитом → и encounter, и его слоты в последующих матчах обновляются **в одной транзакции**.

### Phase D (transactional recalc)
- `recalculate_for_tournament` больше не делает `COMMIT; SELECT; INSERT; COMMIT` — всё в одной транзакции (`delete_by_tournament(..., commit=False)`, потом `calculate_for_tournament` коммитит). Больше нет окна, когда standings пустой.

---

## Что осталось (следующие PR)

### Phase D (full) — RabbitMQ-based recalculation
Сейчас пересчёт всё ещё идёт inline в HTTP-handler. Для больших турниров это десятки секунд.

Checklist:
- [x] Создать exchange `tournament.recalc` в RabbitMQ topology (по аналогии с `mix_balance_service.balance`).
- [x] Parser-service или новый worker-service: consumer на routing key `tournament.recalc.<tournament_id>`.
- [x] `admin/encounter.py::{create,update,delete}_encounter` вместо `await standings_service.recalculate_for_tournament(...)` публикуют сообщение через FastStream producer.
- [x] Debouncing: если для того же `tournament_id` есть pending message — dedupe (используем `x-deduplication-header` или Redis-set «pending tournaments»).
- [x] В app-service при получении WebSocket-сообщения от consumer инвалидировать `cashews` кэш + пушить `tournament:recalculated` событие на фронт.
- [x] Frontend: подписаться на WS и инвалидировать `queryKey: ["standings", tournamentId]`.
- [x] Тесты: `test_recalculation_debounce.py`, `test_recalculation_idempotency.py`.

### Phase C — остатки
- [x] ~~**DE Grand Final Reset** lazy~~ — сделано в `advance_winner::_maybe_create_grand_final_reset` (если LB-champion выиграл GF → создаём reset-match).
- [x] ~~**Invariant tests**~~ — 26 юнит-тестов в `parser-service/tests/test_bracket_generators.py` покрывают SE/DE/RR/Swiss и engine dispatch.
- [ ] **LB reseeding в DE** — стандартный DE требует пересева LB после каждого dropout. Сейчас оставлено как простой pair-up (достаточно для 8/16 команд, но для 32+ неточно).
- [ ] **Property-based tests** через Hypothesis (усиление поверх существующих юнит-тестов):
  - SE: N-1 матчей для любого N ≥ 2.
  - RR: каждая пара сыграна ровно раз для любого N.
  - DE: champion однозначно определим.
  - Swiss: нет двух раундов рематча, byes ≤ 1 на команду.

### Phase E — консолидация слоёв
Сейчас `tournament/stage/encounter/standing` услуги дублируются между `app-service` и `parser-service`.

Checklist:
- [x] ~~`sort_matches` и `_completed_encounters`~~ — вынесены в `shared/services/tournament_utils.py`, оба сервиса делегируют.
- [ ] Вынести остальное `shared/services/tournament/`: `get_tournament`, `list_stages`, `get_standings`, `get_encounters_by_tournament`. Оба сервиса импортируют оттуда.
- [ ] Вынести `shared/schemas/tournament/` с каноничными Pydantic-схемами (`TournamentRead`, `StageRead`, `StageItemRead`, `EncounterRead`, `StandingRead`). Удалить дубли в `app-service/src/schemas` и `parser-service/src/schemas`. **Высокий риск**: затрагивает десятки импортов в обоих сервисах — делать отдельным PR с прогоном всех тестов.
- [ ] `app-service/src/services/encounter/service.py::encounter_entities` и `parser-service/src/services/encounter/service.py::encounter_entities` → объединить.
- [ ] Admin CRUD на stages/encounters/standings — в идеале переехать в `app-service`, а `parser-service` оставить только для parsing logs + Challonge sync.

### Phase F — Frontend
Checklist:
- [x] ~~Единая invalidation-стратегия~~ — `invalidateTournamentWorkspace` расширена всеми public-кэшами, `StageManager` переведён на общий helper.
- [x] ~~`Standings.group_id`/`group` — optional в TS-типах~~, `TournamentStandingsPage` уже фильтрует по `stage.stage_type`, не по `is_groups`.
- [ ] `TournamentBracketPage.tsx` — сейчас рендерит по `round`-числу. После Phase C можно рисовать полноценный граф матчей через `EncounterLink` (показывать стрелки «winner → match X», visual-connected bracket).
  - Нужен API endpoint: `GET /tournaments/{id}/encounter-links`.
  - `EncounterRead` можно расширить `outgoing_links: [EncounterLinkRead]` через параметр `entities`.
  - `BracketView` — layout engine для графа (dagre или ELK).
- [ ] Admin — новый UI для `EncounterLink`: при открытии encounter dialog показывать, куда в следующих матчах попадёт победитель/проигравший.
- [ ] `StandingsTable` prop `is_groups` → заменить на `variant: "group" | "playoff"` для ясности.

### Phase G (новая, не было в оригинальном плане) — удаление TournamentGroup
После того как Phase E/F стабилизируют систему, сделать финальную миграцию:
- [ ] DROP `encounter.tournament_group_id` FK + column.
- [ ] DROP `standing.group_id` FK + column.
- [ ] DROP `challonge_team.group_id` FK + column.
- [ ] DROP `TournamentGroup.is_groups`, `TournamentGroup.challonge_*`.
- [ ] DROP TABLE `tournament.group`.
- [ ] Удалить `_ensure_stage_item_compat_group`, `_resolve_compat_group_id`.
- [ ] Удалить `shared/services/stage_refs.py::resolve_stage_refs_from_group` (там останется только `resolve_stage_refs_from_inputs`).
- [ ] Удалить `encounter_is_lower_bracket`/`encounter_is_upper_bracket` fallback-ветки с `tournament_group` (они сейчас страхуют legacy-данные).

---

## Верификация фиксов для «сетка ≠ encounters»

До деплоя:
1. Проверить в staging после применения миграций: `SELECT COUNT(*) FROM tournament.encounter WHERE stage_id IS NULL;` → должно быть 0.
2. `SELECT COUNT(*) FROM tournament.encounter WHERE stage_item_id IS NULL AND stage_id IS NOT NULL;` → тоже 0.
3. Посмотреть любой турнир в админке и в публичной сетке — количество матчей должно совпадать.
4. Попробовать Challonge sync — новый encounter должен сразу иметь заполненные stage refs.
5. Попробовать отредактировать encounter в админке — публичная сетка обновляется синхронно (одним PATCH'ем).

После деплоя:
1. Мониторить логи на `WARN: No compat TournamentGroup for tournament=...` — это норма для новых турниров, которые никогда не имели legacy TournamentGroup.
2. Мониторить `ERROR: EncounterLink ... points to missing target encounter` — не должно быть. Если появится — баг в advancement logic.

---

## Порядок применения миграций

```
alembic upgrade phasea0001  # Backfill orphan groups + encounters + standings
alembic upgrade phasec0001  # EncounterLink table
```

Миграции обратимы через `downgrade`, но:
- `phasec0001 downgrade` — полностью удаляет все EncounterLink. Если вы уже запустили турниры с advancement links, их восстановить из БД нельзя. Делать backup перед downgrade.
- `phasea0001 downgrade` — UNIQUE constraint восстанавливается, но если в БД есть Standings без `group_id` (новые), downgrade упадёт. Этого не произойдёт, пока downgrade запускают сразу после upgrade — но через сутки работы новой системы откатиться уже нельзя.

---

## Риск-лист

| Риск | Вероятность | Mitigation |
|---|---|---|
| Backfill миграция падает на больших БД (>1M encounter rows) | Средняя | Запускать в maintenance window. Если более 1M rows — разбить по tournament_id батчами. |
| Advancement edges не создаются для старых (до Phase C) турниров | Высокая | Это ожидаемо — старые турниры без `EncounterLink` работают как раньше (админ проставляет home/away руками). |
| RabbitMQ topology ломается при rolling deploy | Средняя | Consumer-pattern должен быть idempotent (message dedup по `encounter_id`). |
| Frontend кэш (`cashews` TTL 5 min) показывает stale данные после редактирования | Низкая | В `/tournaments/{id}/standings` сейчас стоит кэш, но после Phase D WS-инвалидация решит это. |
