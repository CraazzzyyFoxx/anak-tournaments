# Realtime Shared Library — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the transactional-staging and debounce/jitter logic that bracket (`tournament/realtime_commit.py`, `useTournamentRealtime.ts`) and pregame (`encounter/realtime_commit.py`) each hand-roll today into two shared primitives — a backend staging factory and a frontend coalesced-refetch hook — then migrate bracket, streams, logs, and both subscriptions consumers onto the frontend primitive. Zero behavior change for all four topics: same payloads, same debounce/jitter timings, same invalidation targets. Additionally: a bracket-only retention job for `realtime.workspace_event`, and a connection-status indicator on the bracket page and stream section, reusing the pattern already shipped for draft (`DraftPageHero.tsx`).

**Architecture:** Additive-then-cutover. New shared modules are built and unit-tested standalone first (Tasks 1, 6, 12); each existing consumer is then refactored onto them one at a time (Tasks 2-3, 7-11), each independently testable and revertable. No topic's wire payload changes. No new patch-mode consumer ships in this wave (`useRealtimePatchedQuery`, Task 12, is built for the already-approved pregame/draft tracks; nothing in Tasks 2-11 uses it).

**Tech Stack:** Python 3.13 / SQLAlchemy 2 async / APScheduler / FastStream RPC over RabbitMQ / PostgreSQL 16. Frontend Next.js 16 App Router, React, TypeScript, TanStack Query. Tests: `pytest` (backend), `vitest` (frontend).

**Design and rationale:** `docs/plans/2026-08-24-realtime-shared-library.md`. That document carries 11 numbered decisions and the record of three adversarial reviews plus arbitration (APPROVED). **Read §4 and the three Review Log sections (§6-§8) before starting** — several steps below exist specifically to satisfy an objection raised there (e.g. the reconnect-refetch routing through the jitter window, not bypassing it — §7 objection #1/D9).

**Scope:** This wave = bracket, streams, logs, subscriptions (×2 consumers), retention, connection indicator. Pregame's own patch-mode migration is a separately-approved track, referenced here only because it shares `useRealtimePatchedQuery` (Task 12).

---

## Before you start

**Read these, in this order:**
1. `docs/plans/2026-08-24-realtime-shared-library.md` §4.2-§4.6, §5 (Decision Log) — what is being built and why.
2. `backend/tournament-service/src/services/tournament/realtime_commit.py` — the module Tasks 1-2 generalize.
3. `backend/tournament-service/src/services/encounter/realtime_commit.py` — its near-duplicate sibling, Task 3.
4. `frontend/src/hooks/useTournamentRealtime.ts` + `frontend/src/hooks/tournamentRealtime.helpers.ts` — the hook and coalescers Tasks 5-7 generalize.
5. `frontend/src/hooks/useTournamentStreamRealtime.ts`, `frontend/src/app/admin/tournaments/[id]/components/TournamentLogsTab.tsx:189-212`, `frontend/src/app/admin/subscriptions/page.tsx`, `frontend/src/app/admin/tournaments/[id]/TournamentHubShell.tsx:149-165` — the four consumers Tasks 8-11 migrate.
6. `frontend/src/components/draft/DraftPageHero.tsx:29-60` — the connection-indicator pattern Task 13 reuses.

**Commands you will run constantly:**
```bash
# backend, from backend/tournament-service
uv run python -m pytest tests/test_realtime_commit.py tests/test_encounter_realtime_commit.py -q
uv run python -m pytest tests/ -q

# frontend, from frontend/
npx vitest run <path>
npx tsc --noEmit
npx eslint <paths>
```

**Commit convention.** `type(scope): lowercase imperative summary`. Types in use: `feat`, `fix`, `ref`, `refactor`, `chore`.

---

## Backend

### Task 1: `register_realtime_update` staging factory

**Files:**
- Create: `backend/shared/services/realtime_transaction.py`
- Test: `backend/shared/tests/test_realtime_transaction.py` (new)

**Why:** `tournament/realtime_commit.py` and `encounter/realtime_commit.py` each independently implement: stage `(key, reason)` pairs into `session.info` (dedup via a mutable container), build `WorkspaceEvent` rows in a `before_flush` listener, publish them to Redis as fire-and-forget `after_commit` tasks anchored against GC, and clear staged state on `after_rollback`. This factory is that shape, parameterized by a caller-supplied event builder — see design doc §4.2 for the full rationale, including why the signature is **synchronous with a pre-built payload**, not an async callback (Skeptic objections #1-2: an async callback inside a sync `before_flush` listener reintroduces the exact sync/async conflict the pregame track already had to work around).

**Step 1: Write the module**

```python
"""Shared transactional realtime-event staging: dedupe-then-publish over the
SQLAlchemy session lifecycle (before_flush persists, after_commit publishes).

Generalizes the near-identical pattern in
`tournament-service/src/services/tournament/realtime_commit.py` and
`tournament-service/src/services/encounter/realtime_commit.py` — see
docs/plans/2026-08-24-realtime-shared-library.md §4.2.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from loguru import logger
from sqlalchemy import event
from sqlalchemy.orm import Session

from shared.models.platform.realtime import WorkspaceEvent
from shared.schemas.realtime import WorkspaceEventEnvelope
from shared.services.realtime_publisher import event_to_envelope, publish_event_to_redis_url
from src.core import config

__all__ = ("register_realtime_update",)

_SESSION_KEY = "shared_realtime_staged_updates"
_SESSION_EVENTS_KEY = "shared_realtime_staged_event_objects"

# Anchored so a fire-and-forget create_task can't be GC'd mid-publish — same
# remedy as both modules being generalized.
_background_tasks: set[asyncio.Task[Any]] = set()


def _spawn(loop: asyncio.AbstractEventLoop, coro: Any) -> None:
    task = loop.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def register_realtime_update(
    session: Any,
    *,
    key: tuple[Any, ...],
    build_event: Callable[[], WorkspaceEvent],
) -> None:
    """Stage a realtime update, deduped by `key` within this transaction.

    `build_event` is called lazily, at `before_flush` time (not here) — the
    caller may still be mutating rows this event's own fields will read. If
    `build_event`'s payload must reflect a snapshot, that snapshot is fetched
    by the CALLER, synchronously, before this function is invoked (`await`
    happens in the caller's own async request-handling code, never inside a
    SQLAlchemy sync listener) — see design §4.2's docstring on
    `register_realtime_update` for the last-write-wins-on-repeat-key contract
    and why `build_event`'s payload must be a full snapshot, never a delta.

    Repeat calls with the same `key` in one transaction overwrite the staged
    builder — the last one registered wins, matching both modules' existing
    dedup behavior.
    """
    sync_session = getattr(session, "sync_session", None)
    info = getattr(sync_session or session, "info", None)
    if info is None:
        return
    builders: dict[tuple[Any, ...], Callable[[], WorkspaceEvent]] = info.setdefault(_SESSION_KEY, {})
    builders[key] = build_event


def _pop_registered_updates(session: Any) -> dict[tuple[Any, ...], Callable[[], WorkspaceEvent]]:
    sync_session = getattr(session, "sync_session", None)
    info = getattr(sync_session or session, "info", None)
    if info is None:
        return {}
    return info.pop(_SESSION_KEY, {})


@event.listens_for(Session, "before_flush")
def _stage_before_flush(session: Session, _flush_context: Any, _instances: Any) -> None:
    builders = _pop_registered_updates(session)
    if not builders:
        return
    events = [build() for build in builders.values()]
    session.add_all(events)
    session.info.setdefault(_SESSION_EVENTS_KEY, []).extend(events)


@event.listens_for(Session, "after_commit")
def _publish_after_commit(session: Session) -> None:
    events: list[WorkspaceEvent] = session.info.pop(_SESSION_EVENTS_KEY, [])
    if not events:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("Cannot publish realtime updates without a running event loop")
        return
    for event_obj in events:
        if event_obj.occurred_at is None:
            event_obj.occurred_at = datetime.now(UTC)
        envelope = event_to_envelope(event_obj)
        _spawn(loop, _publish_one(event_obj.topic, envelope))


async def _publish_one(topic: str, envelope: WorkspaceEventEnvelope) -> None:
    try:
        await publish_event_to_redis_url(str(config.settings.redis_url), topic=topic, envelope=envelope)
    except Exception:
        logger.exception("Failed to publish persisted realtime event", topic=topic)


@event.listens_for(Session, "after_rollback")
def _clear_after_rollback(session: Session) -> None:
    _pop_registered_updates(session)
    session.info.pop(_SESSION_EVENTS_KEY, None)
```

Note the deliberate difference from both existing modules: `build_event` is a **zero-arg closure**, not `Callable[[key_tuple], WorkspaceEvent]` — the caller closes over whatever it needs (tournament_id, reason, an already-fetched snapshot dict) when it registers, so this module never needs to know either domain's key shape.

**Step 2: Tests** — cover: dedup (two `register_realtime_update` calls, same `key`, different `build_event` — only the second's event is ever built/published); one event per distinct key persisted in `before_flush`; publish fires in `after_commit` only, never before; `after_rollback` clears staged state without publishing; a `build_event` raising inside `before_flush` doesn't silently swallow (let it propagate — matches today's behavior, neither existing module catches here).

**Step 3: Run and commit**
```bash
cd backend/shared && uv run python -m pytest tests/test_realtime_transaction.py -q
git add backend/shared/services/realtime_transaction.py backend/shared/tests/test_realtime_transaction.py
git commit -m "feat(realtime): add shared transactional staging factory"
```

---

### Task 2: Refactor `tournament/realtime_commit.py` onto the factory

**Files:** Modify `backend/tournament-service/src/services/tournament/realtime_commit.py`

**Why:** Behavior-preserving — same merge-to-strongest-reason semantics (`_merge_updates`), same payload shape, same topic. Only the staging/publish plumbing moves to the shared factory.

**Steps:**
1. Keep `register_tournament_realtime_update(session, tournament_id, reason)`'s public signature and its `_normalize_reason`/`_merge_updates` logic untouched (callers across the codebase are unaffected).
2. Inside it, instead of adding `(tournament_id, reason)` to a `session.info` set, call:
   ```python
   register_realtime_update(
       session,
       key=(int(tournament_id), "tournament"),
       build_event=lambda: _build_realtime_event(int(tournament_id), _resolve_merged_reason(session, tournament_id)),
   )
   ```
   Since the factory dedups by `key` alone (last write wins) but this module needs to merge MULTIPLE reasons registered for the same tournament into the single strongest one (not just take the last), keep `_merge_updates`'s reason-accumulation in a **local** `session.info["tournament_realtime_reasons"]` dict (`tournament_id -> set[reason]`) that `register_tournament_realtime_update` updates on every call, and have the `build_event` closure read+clear that dict when it actually runs (at `before_flush`, lazily, exactly the property that made `build_event` a zero-arg closure worth having in Task 1).
3. Delete `_stage_registered_updates_before_flush`, `_publish_registered_updates_after_commit`, `_clear_registered_updates_after_rollback`, `_background_tasks`/`_spawn`, `_publish_persisted_event`, `pop_registered_tournament_realtime_updates` — all now live in the shared factory.
4. Keep `publish_tournament_realtime_updates` (the fallback path used elsewhere) and `_build_realtime_event` as-is.

**Tests:** Existing `tests/test_realtime_commit.py` (or wherever bracket's realtime tests live) must pass unchanged — this is the behavior-parity gate. Add one new case: two `register_tournament_realtime_update` calls in one transaction with `bracket_changed` then `structure_changed` still publish exactly one event with `reason="structure_changed"` (merge semantics preserved through the refactor).

**Commit:**
```bash
git add backend/tournament-service/src/services/tournament/realtime_commit.py
git commit -m "refactor(tournament): stage realtime updates via shared factory"
```

---

### Task 3: Refactor `encounter/realtime_commit.py` onto the factory

**Files:** Modify `backend/tournament-service/src/services/encounter/realtime_commit.py`

Same shape as Task 2, simpler: this module doesn't merge reasons (each `(encounter_id, kind)` pair is independent, no severity chain), so `register_map_veto_realtime_update` becomes a thin wrapper:
```python
def register_map_veto_realtime_update(session: Any, encounter_id: int, *, kind: str = "map") -> None:
    register_realtime_update(
        session,
        key=(int(encounter_id), kind),
        build_event=lambda: _build_realtime_event(int(encounter_id), kind),
    )
```
Delete the module's own `before_flush`/`after_commit`/`after_rollback` listeners and background-task plumbing, same as Task 2. **Do not** touch this module's pregame-track-specific async-snapshot work if it has already landed from the separately-approved pregame migration — check `git log` on this file first; if `register_map_veto_realtime_update` is already `async` (pregame track landed first), thread the awaited snapshot into `build_event`'s closure instead of the lambda above (`build_event=lambda: _build_realtime_event(int(encounter_id), kind, snapshot=snapshot)`), matching the pattern Task 1's docstring describes.

**Tests + commit:** same shape as Task 2, with `test_pick_ban_session.py`/`test_pregame_loop.py` (or wherever the existing coverage lives, per `PickBanEntry`'s test list in the earlier codegraph blast-radius) as the parity gate.

---

### Task 4: Bracket-only retention job

**Files:** Modify `backend/tournament-service/serve.py`

**Why:** Design §4.2/D2/D10 — bracket-only, single unbounded `DELETE`, no batching, no partitioning (see design doc for why: pregame/draft sessions have no upper bound on duration, so they're excluded; the cited in-repo precedent for a comparable table used one plain `DELETE`, not a batch loop).

**Steps:**
1. Add a module-level function near the other job functions in `serve.py`:
   ```python
   async def purge_stale_bracket_events() -> None:
       async with db.session_scope() as session:
           await session.execute(
               text(
                   "DELETE FROM realtime.workspace_event "
                   "WHERE topic LIKE 'tournament:%:bracket' AND occurred_at < now() - interval '7 days'"
               )
           )
           await session.commit()
   ```
   (Adjust the session-acquisition helper to match whatever `drain_outbox`/`auto_transition_tournaments` already use in this file — do not invent a new one.)
2. Register it next to the other jobs:
   ```python
   scheduler.add_job(purge_stale_bracket_events, "interval", days=1, id="bracket_workspace_event_purge")
   ```
3. `LIKE 'tournament:%:bracket'` matches `realtime_topics.bracket(tournament_id)`'s exact format (`f"tournament:{id}:bracket"`) — verify against `backend/shared/services/realtime_topics.py:20-21` before committing; if the topic format ever changes this LIKE pattern must move with it (leave a comment saying so).

**Tests:** A test seeding rows on `tournament:1:bracket` (old + recent `occurred_at`) and `tournament:1:draft`/`encounter:1:map-veto` (old) asserts only the old bracket row is deleted — proves the scope boundary (D10) is enforced, not just documented.

**Commit:**
```bash
git add backend/tournament-service/serve.py
git commit -m "feat(tournament): purge stale bracket realtime events past 7 days"
```

---

## Frontend

### Task 5: Move coalescers to a neutral module

**Files:**
- Create: `frontend/src/lib/realtime-coalesce.ts`
- Modify: `frontend/src/hooks/tournamentRealtime.helpers.ts` (remove `createLeadingCoalescer`/`createTrailingCoalescer`/`CoalescerClock`/`Coalescer`, re-export from the new module for now — see step 3)

**Why:** These are already consumed by `useTournamentStreamRealtime.ts` (streams), not just tournament code — the file naming has been inaccurate since that hook was written. Design §4.3.

**Steps:**
1. Cut `CoalescerClock`, `Coalescer`, `createLeadingCoalescer`, `createTrailingCoalescer` (verbatim) into `frontend/src/lib/realtime-coalesce.ts`.
2. Update `tournamentRealtime.helpers.ts`'s imports of these to `@/lib/realtime-coalesce`.
3. Re-export them from `tournamentRealtime.helpers.ts` too (`export { createLeadingCoalescer, createTrailingCoalescer, type Coalescer, type CoalescerClock } from "@/lib/realtime-coalesce";`) so Task 7 (which still imports several OTHER things from this file) doesn't need two import lines mid-refactor — drop this re-export once Task 7 lands and no consumer imports coalescers from the old path.

**Tests:** `tournamentRealtime.helpers.test.ts` (if it exists) keeps passing unchanged — pure move, no logic change.

**Commit:**
```bash
git add frontend/src/lib/realtime-coalesce.ts frontend/src/hooks/tournamentRealtime.helpers.ts
git commit -m "refactor(realtime): move coalescer primitives to a neutral module"
```

---

### Task 6: `useRealtimeCoalescedRefetch` — the thin-signal primitive

**Files:**
- Create: `frontend/src/hooks/useRealtimeCoalescedRefetch.ts`
- Test: `frontend/src/hooks/useRealtimeCoalescedRefetch.test.ts` (new)

**Why:** Generalizes the mechanical shape shared by all four consumers being migrated — subscribe, accumulate a pending signal via a caller-supplied reducer, flush through a per-mount-jittered trailing coalescer, optionally run a leading "catch-up" coalescer on (re)subscribe, and (design §7 D9 / §4.3) **always route the reconnect safety-net refetch through the same jittered window**, never bypass it.

Read design §4.3 and §7 objection #1 before writing this — the reconnect-refetch MUST NOT fire immediately on `reconnecting → connected`; it schedules through the same coalescer as a normal event would.

**Step 1: Write the hook**

```ts
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import {
  type Coalescer,
  createLeadingCoalescer,
  createTrailingCoalescer,
} from "@/lib/realtime-coalesce";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { useRealtimeStore } from "@/stores/realtime.store";
import type { RealtimeEventEnvelope } from "@/types/realtime.types";

export interface RealtimeCoalescedRefetchOptions<TData> {
  /**
   * Called on every matching event. Decide whether/what to accumulate into
   * `pending` (a ref this callback may freely mutate — same shape every
   * existing consumer already used: a pending reason, a pending live_count,
   * or nothing at all), then call `schedule()` if a flush should happen.
   * Return without calling `schedule()` to ignore the event.
   */
  onEvent: (event: RealtimeEventEnvelope<TData>, schedule: () => void) => void;
  /** Runs at flush time — the actual refetch/invalidate. */
  onFlush: () => void;
  /** 0 = no coalescing, flush immediately (matches today's hub-subscriptions consumer). */
  minDelayMs: number;
  /** Upper bound of the per-mount random offset added to minDelayMs. Omit or 0 for no jitter. */
  jitterMs?: number;
  /** Leading-edge coalescer window for the (re)subscribe/reconnect signal. Omit to skip catch-up entirely. */
  catchUpMs?: number;
}

export function useRealtimeCoalescedRefetch<TData = Record<string, unknown>>(
  topic: string | null | undefined,
  options: RealtimeCoalescedRefetchOptions<TData>,
): void {
  const { onEvent, onFlush, minDelayMs, jitterMs = 0, catchUpMs } = options;

  const stateRef = useRef({ onEvent, onFlush });
  useEffect(() => {
    stateRef.current = { onEvent, onFlush };
  });

  const catchUp = useRef<Coalescer | null>(null);
  useEffect(() => {
    if (catchUpMs == null) return;
    const coalescer = createLeadingCoalescer(() => stateRef.current.onFlush(), catchUpMs);
    catchUp.current = coalescer;
    return () => {
      coalescer.cancel();
      catchUp.current = null;
    };
  }, [topic, catchUpMs]);

  const trailing = useRef<Coalescer | null>(null);
  useEffect(() => {
    const delay = minDelayMs + (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0);
    const coalescer = createTrailingCoalescer(() => stateRef.current.onFlush(), delay);
    trailing.current = coalescer;
    return () => {
      coalescer.cancel();
      trailing.current = null;
    };
  }, [topic, minDelayMs, jitterMs]);

  useRealtimeTopic<TData>(
    topic,
    (event) => {
      stateRef.current.onEvent(event, () => trailing.current?.schedule());
    },
    [],
    () => {
      catchUp.current?.schedule();
    },
  );

  // Reconnect safety-net (design §4.3, §7/D9): schedule a flush through the
  // SAME jittered trailing coalescer on reconnecting -> connected, never an
  // immediate bypass — an immediate refetch here would reproduce, at the
  // moment of a mass-reconnect after a gateway restart, exactly the
  // synchronized-herd pattern the jitter exists to prevent.
  const connectionState = useRealtimeStore((s) => s.connectionState);
  const prevConnectionState = useRef(connectionState);
  useEffect(() => {
    if (prevConnectionState.current === "reconnecting" && connectionState === "connected") {
      trailing.current?.schedule();
    }
    prevConnectionState.current = connectionState;
  }, [connectionState]);
}
```

**Step 2: Tests.** Use fake timers (`vi.useFakeTimers()`, matching whatever the existing `tournamentRealtime.helpers.test.ts` or `useRealtimeTopic` tests already do). Cover: `minDelayMs: 0, jitterMs: 0` flushes synchronously-on-next-tick with no observable delay (hub-subscriptions' pass-through mode); jitter draws once per mount, not per event; multiple `onEvent` calls within the window collapse into one `onFlush`; `catchUpMs` omitted means no leading coalescer is created at all (verify no timer scheduled); the reconnect transition schedules through `trailing`, not a bare call to `onFlush` — assert by advancing fake timers by less than `minDelayMs+jitterMs` after the transition and confirming `onFlush` has NOT fired yet.

**Commit:**
```bash
git add frontend/src/hooks/useRealtimeCoalescedRefetch.ts frontend/src/hooks/useRealtimeCoalescedRefetch.test.ts
git commit -m "feat(realtime): add shared coalesced-refetch hook"
```

---

### Task 7: Refactor `useTournamentRealtime` (bracket) onto the shared hook

**Files:** Modify `frontend/src/hooks/useTournamentRealtime.ts`

**Why:** Bracket's logic is the most complex consumer (severity-ranked reason merge + a disjoint registration_changed side-signal + an `onStructureChanged` callback) — do this one first among the consumers since if the hook's `onEvent`/`onFlush` split can express bracket's logic, it can express everything simpler.

**Steps:**
1. Keep `pendingReasonRef`, `pendingRegistrationChangeRef`, and `strongerTournamentReason` exactly as they are — this is domain logic, not mechanical plumbing, and stays in this file.
2. Replace the hand-rolled `catchUp`/`updatesRef`/two `useEffect`s that build coalescers with one call:
   ```ts
   useRealtimeCoalescedRefetch<TournamentRealtimePayload>(topic, {
     minDelayMs: REALTIME_REFETCH_MIN_DELAY_MS,
     jitterMs: REALTIME_REFETCH_JITTER_MS,
     catchUpMs: CATCH_UP_COALESCE_MS,
     onEvent: (event, schedule) => {
       if (!tournamentId || event.event_type !== "tournament.updated" || event.data.tournament_id !== tournamentId) {
         return;
       }
       const reason = event.data.reason;
       if (reason === "registration_changed") {
         pendingRegistrationChangeRef.current = true;
         schedule();
         return;
       }
       if (reason !== "bracket_changed" && reason !== "results_changed" && reason !== "structure_changed") {
         return;
       }
       pendingReasonRef.current = strongerTournamentReason(pendingReasonRef.current, reason);
       schedule();
     },
     onFlush: () => {
       const reason = pendingReasonRef.current;
       const hasRegistrationChange = pendingRegistrationChangeRef.current;
       pendingReasonRef.current = null;
       pendingRegistrationChangeRef.current = false;
       if (!tournamentId || (!reason && !hasRegistrationChange)) return;
       if (reason) {
         applyTournamentRealtimeUpdate(queryClient, tournamentId, workspaceId, reason, undefined, resolvedDetailRef);
         onUpdate?.(reason);
         if (reason === "structure_changed") onStructuredChanged?.();
       }
       if (hasRegistrationChange && reason !== "structure_changed") {
         applyTournamentRealtimeUpdate(queryClient, tournamentId, workspaceId, "registration_changed", undefined, resolvedDetailRef);
         onUpdate?.("registration_changed");
       }
     },
   });
   ```
   Note `onFlush` reads `tournamentId`/`workspaceId`/`onUpdate`/`onStructureChanged`/`queryClient`/`resolvedDetailRef` directly from the hook's closure, not a `stateRef` — `useRealtimeCoalescedRefetch` already wraps `onEvent`/`onFlush` in its OWN `stateRef` internally (Task 6), so this hook no longer needs to build one itself.
3. Delete `catchUp`, `updatesRef`, `stateRef`, and the two `useEffect`s that built them, plus the now-unused `Coalescer`/`createLeadingCoalescer`/`createTrailingCoalescer` imports.
4. `applyTournamentRealtimeCatchUp` is still called — but now as `onFlush`'s catch-up path via `catchUpMs`. Wire it: since `useRealtimeCoalescedRefetch`'s catch-up coalescer calls `onFlush` (not a separate catch-up callback), and bracket's ORIGINAL catch-up flow called `applyTournamentRealtimeCatchUp` (a *different*, broader invalidation than a normal `applyTournamentRealtimeUpdate`), split `onFlush` so the very first call after mount/reconnect (no pending reason yet, i.e. `pendingReasonRef.current === null && !pendingRegistrationChangeRef.current`) still needs to run the catch-up plan, not silently no-op. Concretely, give `useRealtimeCoalescedRefetch` a **separate** `onCatchUp` callback distinct from `onFlush` (small addition to Task 6's hook: `catchUpMs` triggers `onCatchUp ?? onFlush`, not always `onFlush`) — revise Task 6 before doing this step if you reach this point and the split isn't there yet.

**Tests:** `useTournamentRealtime.test.ts` (or wherever its coverage lives) must pass with ZERO changes to its assertions — timings (`[250,2750)`ms), catch-up-on-resubscribe behavior, and the registration_changed-skipped-under-structure_changed rule are all behavior, not implementation, and must be provably unchanged.

**Commit:**
```bash
git add frontend/src/hooks/useTournamentRealtime.ts
git commit -m "refactor(bracket): migrate useTournamentRealtime onto shared coalesced-refetch hook"
```

---

### Task 8: Refactor `useTournamentStreamRealtime` (streams) onto the shared hook

**Files:** Modify `frontend/src/hooks/useTournamentStreamRealtime.ts`

Same shape as Task 7, simpler (single reason, no severity chain): `onEvent` stores `event.data.live_count` into a `pendingLiveCountRef` and schedules; `onFlush` invalidates `tournamentQueryKeys.streams(id)` and calls `onUpdate?.(pendingLiveCountRef.current)`. Same `REALTIME_REFETCH_MIN_DELAY_MS`/`REALTIME_REFETCH_JITTER_MS`/`CATCH_UP_COALESCE_MS` constants, unchanged values. Delete the hook's own coalescer-building effects.

**Tests + commit:** same shape as Task 7.

---

### Task 9: Refactor `TournamentLogsTab`'s realtime subscription onto the shared hook

**Files:** Modify `frontend/src/app/admin/tournaments/[id]/components/TournamentLogsTab.tsx:205-212`

Replace the `useDebounce(refreshAll, REALTIME_REFRESH_DEBOUNCE_MS)` + `useRealtimeTopic` pair with:
```ts
useRealtimeCoalescedRefetch(enabled && workspaceId != null ? `workspace:${workspaceId}:logs` : null, {
  minDelayMs: REALTIME_REFRESH_DEBOUNCE_MS,
  onEvent: (_event, schedule) => schedule(),
  onFlush: refreshAll,
});
```
No `jitterMs`, no `catchUpMs` — this consumer never had either. Remove the now-unused `use-debounce` import if nothing else on this component uses it (check first — `useDebounce` may be used elsewhere in the file).

**Tests + commit:** existing tab tests must pass with the same 500ms debounce behavior observable.

---

### Task 10: Refactor admin subscriptions page onto the shared hook

**Files:** Modify `frontend/src/app/admin/subscriptions/page.tsx:76-84`

Same shape as Task 9: `minDelayMs: REALTIME_REFRESH_DEBOUNCE_MS` (500), `onEvent: (_e, schedule) => schedule()`, `onFlush: refetchAll`. Remove the `use-debounce` import/usage this replaces.

---

### Task 11: Refactor `TournamentHubShell`'s subscriptions consumer onto the shared hook

**Files:** Modify `frontend/src/app/admin/tournaments/[id]/TournamentHubShell.tsx:154-165`

**Why this one is different:** today this consumer has **no debounce at all** — every event immediately invalidates `registrationsList` and calls `scheduleReadinessInvalidate()` (which has its own separate 400ms debounce, unrelated to realtime). Preserve that exactly: `minDelayMs: 0, jitterMs: 0` (no coalescing — Task 6's degenerate case, verified by that task's own test).

```ts
useRealtimeCoalescedRefetch(
  isValidTournamentId && tournamentWorkspaceId != null ? `workspace:${tournamentWorkspaceId}:subscriptions` : null,
  {
    minDelayMs: 0,
    onEvent: (_event, schedule) => schedule(),
    onFlush: () => {
      if (tournamentWorkspaceId == null) return;
      void queryClient.invalidateQueries({
        queryKey: tournamentQueryKeys.registrationsList(tournamentWorkspaceId, tournamentId),
      });
      scheduleReadinessInvalidate();
    },
  },
);
```

**Tests + commit:** confirm no new debounce was introduced here — a single event must still invalidate on the same tick (or the very next microtask via the coalescer's zero-delay timer — verify against Task 6's own zero-delay test case for exact tick semantics before asserting "unchanged" in a test here).

---

### Task 12: `useRealtimePatchedQuery` — the patch primitive

**Files:**
- Create: `frontend/src/hooks/useRealtimePatchedQuery.ts`
- Test: `frontend/src/hooks/useRealtimePatchedQuery.test.ts` (new)

**Why:** No consumer in Tasks 2-11 uses this (design §4.4/D5/D8 — all four topics stay thin-signal this wave). It exists for the already-approved pregame track and to generalize what `useDraftData.ts`'s `useDraftRealtime` does inline today (~110 lines, bespoke). Build and test it standalone; wiring it into pregame/draft is out of scope for this plan (separate track).

```ts
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { applyResourcePatch } from "@/services/realtime-patch";
import { useRealtimeStore } from "@/stores/realtime.store";
import type { QueryKey } from "@tanstack/react-query";

export function useRealtimePatchedQuery<TData = Record<string, unknown>>(
  topic: string | null | undefined,
  options: { resource: string; queryKey: QueryKey },
): void {
  const queryClient = useQueryClient();
  const { resource, queryKey } = options;

  useRealtimeTopic<TData>(topic, (event) => {
    const outcome = applyResourcePatch(queryClient, { resource, queryKey, event });
    if (outcome !== "applied") {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [resource, JSON.stringify(queryKey)]);

  // Reconnect safety-net, same rationale as useRealtimeCoalescedRefetch
  // (design §4.3/§7 D9): unconditional refetch on reconnect, defense-in-depth
  // against a retention-pruned replay gap silently under-reporting itself
  // (ErrGapTooLarge is inferred from row count, not cursor distance — see
  // design §7 objections #1/#6).
  const connectionState = useRealtimeStore((s) => s.connectionState);
  const prev = useRef(connectionState);
  useEffect(() => {
    if (prev.current === "reconnecting" && connectionState === "connected") {
      void queryClient.invalidateQueries({ queryKey });
    }
    prev.current = connectionState;
  }, [connectionState, queryClient, JSON.stringify(queryKey)]);
}
```

Note: unlike `useRealtimeCoalescedRefetch`'s reconnect handling, this one does NOT route through a jitter window before invalidating — there is no coalescer here to route through (patch consumers are, by construction, low-fan-out enough that this wasn't flagged in review; if a future high-fan-out patch consumer needs jitter here too, that's a design amendment, not a silent addition).

**Tests:** `applied` outcome patches the cache and does not call `invalidateQueries`; `uncached`/`unregistered` outcomes fall back to `invalidateQueries`; the reconnect transition invalidates unconditionally.

**Commit:**
```bash
git add frontend/src/hooks/useRealtimePatchedQuery.ts frontend/src/hooks/useRealtimePatchedQuery.test.ts
git commit -m "feat(realtime): add shared patched-query hook"
```

---

### Task 13: Connection-status indicator on bracket + streams

**Files:**
- Modify: `frontend/src/app/(site)/tournaments/[slug]/bracket/TournamentBracketPage.tsx`
- Check: `frontend/src/app/(site)/tournaments/[slug]/bracket/../_components/UpdatingBadge.tsx` — read this first; it may already cover part of this need (an "updating" affordance tied to `isFetching`) and could be the wrong place to also bolt on a *connection* (not fetch-state) indicator. Confirm before adding a second, possibly-redundant affordance.

**Why:** Design §4.6/D11 (User Advocate review) — draft/pregame already show `connectionState` via `DraftPageHero.tsx`'s `t('connection.${connectionState}')` pattern; bracket/streams share the same `useRealtimeStore` and show nothing, which is a cross-surface trust inconsistency, not a missing feature.

**Steps:**
1. Read `useRealtimeStore` usage in `DraftPageHero.tsx:60` (`const connected = connectionState === "connected"`) and however that boolean drives the icon/copy in the JSX below it (lines 62-190 — re-read the elided middle if needed).
2. Reuse the exact same i18n keys (`connection.idle`/`connection.connecting`/`connection.connected`/`connection.reconnecting` under whatever namespace `DraftPageHero` uses — `t = useTranslations("draftRedesign")`, so check whether these specific keys live in a shared namespace or are draft-specific; if draft-specific, add a namespace-neutral copy under `common` rather than importing the `draftRedesign` namespace into the bracket page).
3. Add a small `ConnectionIndicator` component (new, `frontend/src/components/realtime/ConnectionIndicator.tsx`) taking `connectionState: RealtimeConnectionState` and rendering the icon+label, extracted from `DraftPageHero`'s inline JSX so both consumers share one implementation instead of copy-pasting it a second time.
4. Wire `useRealtimeStore((s) => s.connectionState)` into `TournamentBracketPage.tsx`'s header area and render `<ConnectionIndicator connectionState={connectionState} />` there; do the same for whatever component renders the stream section (`useTournamentStreamsQuery`'s consumer, per the existing import in `TournamentBracketPage.tsx:30`).
5. Retrofit `DraftPageHero.tsx` to use the new shared `ConnectionIndicator` too, so there is exactly one implementation, not two that can drift.

**Tests:** a rendering test for `ConnectionIndicator` (all 4 states render distinct, non-empty text); a bracket-page test asserting the indicator is present and reflects `useRealtimeStore`'s state (mock the store).

**Commit:**
```bash
git add frontend/src/components/realtime/ConnectionIndicator.tsx frontend/src/components/draft/DraftPageHero.tsx frontend/src/app/\(site\)/tournaments/\[slug\]/bracket/TournamentBracketPage.tsx
git commit -m "feat(realtime): show connection status on bracket and streams"
```

---

## Verification pass (after all tasks)

1. `cd backend && for svc in tournament-service; do (cd $svc && uv run python -m pytest tests/ -q); done`
2. `cd frontend && npx vitest run && npx tsc --noEmit`
3. Manual smoke: open a bracket page in two tabs, report a match result, confirm both tabs refresh within the existing jitter window (not instantly, not never) — same as before this work, just on the new hook.
4. Confirm `git grep -n "createLeadingCoalescer\|createTrailingCoalescer" frontend/src` shows only `lib/realtime-coalesce.ts` as the definition site and `hooks/useRealtimeCoalescedRefetch.ts`/`hooks/tournamentRealtime.helpers.ts` (transitional re-export) as consumers — no remaining direct hand-rolled coalescer construction in any of the four migrated hooks/components.
