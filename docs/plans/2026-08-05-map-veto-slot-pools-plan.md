# Map Veto Slot Pools — Implementation Plan (Stage One)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a second map-veto mode where a config describes an ordered list of slots — each slot a set of candidate maps plus an optional reserve — so a tournament can specify a different candidate pool per map in the series, with teams banning within a slot until one map survives.

**Architecture:** Additive only. Two new tables (`map_veto_config_slot`, `map_veto_config_slot_map`) plus a `mode` discriminator on `map_veto_config`; flat mode's tables and code paths are untouched. The step engine keeps its existing arithmetic — every slot-mode step consumes exactly one pool entry, so `get_current_step`'s `count(status != AVAILABLE)` stays a valid index — and gains one derived value, `current_slot`, from which three call sites take a slot restriction. Series length still belongs to the bracket (`Encounter.best_of`); slot count is derived from it, never authored.

**Tech Stack:** Python 3.13 / SQLAlchemy 2 async / Alembic / FastStream RPC over RabbitMQ / PostgreSQL 16. Frontend Next.js 16 App Router, React, TypeScript, Tailwind v4, next-intl, TanStack Query. Tests: `pytest` (backend), `vitest` (frontend components/logic), `bun test` (frontend i18n and `src/lib`).

**Design and rationale:** `docs/plans/2026-08-05-map-veto-slot-pools.md`. That document carries 30 numbered decisions and the record of three reviews plus arbitration. **Read §3a, §4.1 and §4.2 before starting.** This plan does not repeat rationale; when a step looks arbitrary, the reason is a numbered decision there.

**Scope:** Stage one only — organizer and captain. The public page (stage two) is deliberately excluded except for one honesty guard in Task 21. See design §3a.

---

## Before you start

**Read these, in this order:**
1. `docs/plans/2026-08-05-map-veto-slot-pools.md` §1, §2, §3a, §4.1-§4.3, §4.7 — what is being built and why.
2. `backend/tournament-service/src/services/encounter/veto_session.py` — config cascade, session lifecycle, sequence generation.
3. `backend/tournament-service/src/services/encounter/map_veto.py` — the step engine.
4. `backend/shared/models/tournament/encounter_map.py` — the four models involved.

**Domain vocabulary you will need:**
- **Flat / pool mode** — today's behaviour: one pool per config, a sequence of ban/pick steps over all remaining maps, at most one trailing `decider`.
- **Slot** — one map of the series. A slot holds >= 2 *candidates*; teams ban alternately until one survives, and the survivor is played. Slot count equals `Encounter.best_of`.
- **Reserve** — a per-slot map the *regulation* says is played if the slot's map draws. The platform displays it and does nothing else with it (Decision 7).
- **`best_of`** — series length, owned by the bracket. Configured on the stage (`Stage.settings_json.best_of`), resolved per encounter into `Encounter.best_of`, possibly overridden per encounter by an admin.
- **Cascade** — a veto config applies at `(tournament)`, `(stage)`, or `(stage, round)`; the most specific wins. Lower-bracket rounds use **negative** `round` values.

**Commands you will run constantly:**
```bash
# backend, from backend/tournament-service
uv run python -m pytest tests/test_veto_session.py -q
uv run python -m pytest tests/ -q                     # full service suite

# frontend, from frontend/
npx vitest run <path>            # component + logic tests
bun test src/i18n src/lib        # i18n and lib tests (different runner)
npx tsc --noEmit                 # typecheck
npx eslint <paths>               # lint
```

**Two runners, disjoint file sets.** `vitest.config.ts`'s `include` is an allow-list: a test file outside it never runs and the suite still reports green. `src/lib` and `src/i18n` hold files for both runners. If you add a test under `src/lib`, register it in `vitest.config.ts` explicitly, as `src/lib/best-of.test.ts` already is.

**Commit convention.** `type(scope): lowercase imperative summary`, with a body explaining what was wrong when it is not obvious. Types in use: `feat`, `fix`, `ref`, `refactor`, `chore`, `docs`. Verify a claim before writing it in a commit message.

---

## Task 1: Fix `parseStageBestOf` dropping negative round keys

Independent of everything else and fixes a live bug shipped in `4e8e1dce`. Do it first: it is small, it is releasable alone, and Task 18 depends on it.

**Why:** the backend accepts negative `by_round` keys (`parse_best_of_config` does `int(key)`), the frontend silently drops them (`/^\d+$/`). With lower-bracket rounds in scope, an organizer setting `by_round["-1"]` gets an admin UI showing one slot count and a server stamping another.

**Files:**
- Modify: `frontend/src/lib/best-of.ts:82`
- Test: `frontend/src/lib/best-of.test.ts`

**Step 1: Write the failing test**

Add to the `describe("parseStageBestOf")` block in `frontend/src/lib/best-of.test.ts`:

```ts
it("keeps negative round keys, which lower-bracket rounds use", () => {
  // Backend `parse_best_of_config` accepts these; dropping them here makes the
  // admin editor and the server disagree on an LB round's series length.
  expect(parseStageBestOf({ best_of: { default: 3, by_round: { "-1": 5, "2": 2 } } })).toEqual({
    default: 3,
    by_round: { "-1": 5, "2": 2 }
  });
});
```

**Step 2: Run it and watch it fail**

```bash
cd frontend && npx vitest run src/lib/best-of.test.ts
```
Expected: FAIL — received `{ default: 3, by_round: { "2": 2 } }`, the `-1` key stripped.

**Step 3: Fix the guard**

In `frontend/src/lib/best-of.ts`, the round-key guard currently reads:

```ts
if (!/^\d+$/.test(key)) continue;
```

Replace with:

```ts
// Lower-bracket rounds are negative (see services/admin/stage.py:826), and the
// backend's `parse_best_of_config` accepts them. Dropping them here would make
// this mirror disagree with the server on an LB round's series length.
if (!/^-?\d+$/.test(key)) continue;
```

**Step 4: Run the test and the suites**

```bash
npx vitest run src/lib/best-of.test.ts   # expect PASS
bun test src/lib                         # expect PASS, same file under the other runner
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add frontend/src/lib/best-of.ts frontend/src/lib/best-of.test.ts
git commit -m "fix(best-of): keep negative by_round keys so LB rounds match the server"
```

---

## Task 2: Add the PG enum types and the slot tables

**Files:**
- Create: `backend/migrations/versions/vetoslot01_add_slot_pools.py`
- Reference for style: `backend/migrations/versions/mapveto0001_add_veto_session_and_config_levels.py`, `backend/migrations/versions/dbarch05_json_normalization.py`

**Read first:** design §4.1, including the migration-mechanics list. Three things in it are non-negotiable and each is a whole-revision or every-insert failure if missed: the type is created with raw `CREATE TYPE` before any column references it; the column declares `create_type=False` so alembic does not try to own the type; and the *model* declares `values_callable` (Task 3) or SQLAlchemy binds member names instead of values.

**Step 1: Find the current head**

```bash
cd backend && uv run alembic heads
```
Note the revision id; it becomes `down_revision`.

**Step 2: Write the migration**

```python
"""Slot-based map pools for map veto.

Adds the `slots` veto mode: a config may describe an ordered list of slots, each
holding candidate maps plus an optional reserve. Flat ("pool") mode is untouched
— `map_veto_config_map` is not modified and existing rows default to
`mode='pool'`, so there is no data migration.

Design: docs/plans/2026-08-05-map-veto-slot-pools.md

Enum types are created with raw CREATE TYPE and referenced with
`create_type=False`, matching mapveto0001. `downgrade` cancels slot-mode veto
sessions BEFORE dropping the tables: a slot-mode `resolved_sequence_json`
carries one decider per slot, which the pre-feature engine rejects, and once the
slot tables are gone a reset cannot rebuild the session (design Decision 20).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "vetoslot01"
down_revision = "<HEAD FROM STEP 1>"
branch_labels = None
depends_on = None

_MODE_ENUM = postgresql.ENUM(name="mapvetomode", schema="tournament", create_type=False)
_ROTATION_ENUM = postgresql.ENUM(name="firstbanrotation", schema="tournament", create_type=False)


def upgrade() -> None:
    op.execute("CREATE TYPE tournament.mapvetomode AS ENUM ('pool', 'slots')")
    op.execute("CREATE TYPE tournament.firstbanrotation AS ENUM ('fixed', 'alternate')")

    op.add_column(
        "map_veto_config",
        sa.Column("mode", _MODE_ENUM, nullable=False, server_default="pool"),
        schema="tournament",
    )
    op.add_column(
        "map_veto_config",
        sa.Column("first_ban_rotation", _ROTATION_ENUM, nullable=False, server_default="fixed"),
        schema="tournament",
    )

    op.create_table(
        "map_veto_config_slot",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("map_veto_config_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("reserve_map_id", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["map_veto_config_id"], ["tournament.map_veto_config.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reserve_map_id"], ["overwatch.map.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("map_veto_config_id", "position", name="uq_map_veto_config_slot_position"),
        sa.CheckConstraint("position >= 1", name="ck_map_veto_config_slot_position_positive"),
        schema="tournament",
    )
    op.create_index(
        "ix_map_veto_config_slot_config_id",
        "map_veto_config_slot",
        ["map_veto_config_id"],
        schema="tournament",
    )

    op.create_table(
        "map_veto_config_slot_map",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("map_veto_config_slot_id", sa.BigInteger(), nullable=False),
        sa.Column("map_id", sa.BigInteger(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["map_veto_config_slot_id"], ["tournament.map_veto_config_slot.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["map_id"], ["overwatch.map.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("map_veto_config_slot_id", "map_id", name="uq_map_veto_config_slot_map"),
        schema="tournament",
    )
    op.create_index(
        "ix_map_veto_config_slot_map_slot_id",
        "map_veto_config_slot_map",
        ["map_veto_config_slot_id"],
        schema="tournament",
    )

    op.add_column(
        "encounter_map_pool", sa.Column("slot", sa.Integer(), nullable=True), schema="tournament"
    )
    op.add_column(
        "encounter_veto_session",
        sa.Column("slot_reserves_json", sa.JSON(), nullable=True),
        schema="tournament",
    )


def downgrade() -> None:
    # Cancel slot-mode sessions first: their resolved sequences carry one decider
    # per slot, which the pre-feature engine rejects, and after the drop below a
    # reset cannot rebuild them. Design Decision 20.
    op.execute(
        """
        UPDATE tournament.encounter_veto_session s
        SET status = 'cancelled'
        FROM tournament.map_veto_config c
        WHERE s.config_id = c.id AND c.mode = 'slots'
        """
    )

    op.drop_column("encounter_veto_session", "slot_reserves_json", schema="tournament")
    op.drop_column("encounter_map_pool", "slot", schema="tournament")
    op.drop_index("ix_map_veto_config_slot_map_slot_id", table_name="map_veto_config_slot_map", schema="tournament")
    op.drop_table("map_veto_config_slot_map", schema="tournament")
    op.drop_index("ix_map_veto_config_slot_config_id", table_name="map_veto_config_slot", schema="tournament")
    op.drop_table("map_veto_config_slot", schema="tournament")
    op.drop_column("map_veto_config", "first_ban_rotation", schema="tournament")
    op.drop_column("map_veto_config", "mode", schema="tournament")

    op.execute("DROP TYPE IF EXISTS tournament.firstbanrotation")
    op.execute("DROP TYPE IF EXISTS tournament.mapvetomode")
```

**Step 3: Verify it applies and reverses**

```bash
cd backend
uv run alembic upgrade head
uv run alembic downgrade -1
uv run alembic upgrade head
```
Expected: all three succeed. If the DB is unreachable, say so and stop — do not guess. The suites skip DB-integration tests when the database is down, so a green suite does not prove the migration ran.

**Step 4: Commit**

```bash
git add backend/migrations/versions/vetoslot01_add_slot_pools.py
git commit -m "feat(veto): add slot-pool tables, mode and rotation enums"
```

---

## Task 3: Add the models

**Files:**
- Modify: `backend/shared/models/tournament/encounter_map.py`
- Modify: `backend/shared/core/enums.py`
- Test: `backend/shared/tests/test_map_veto_config_map_model.py` (extend; metadata-only, no DB)

**Step 1: Add the enums**

In `backend/shared/core/enums.py`, beside `MapPoolEntryStatus`:

```python
class MapVetoMode(StrEnum):
    POOL = "pool"
    SLOTS = "slots"


class FirstBanRotation(StrEnum):
    FIXED = "fixed"
    ALTERNATE = "alternate"
```

**Step 2: Write the failing metadata test**

Append to `backend/shared/tests/test_map_veto_config_map_model.py`:

```python
def test_slot_tables_exist_with_cascades_and_uniques():
    from shared.models.tournament.encounter_map import MapVetoConfigSlot, MapVetoConfigSlotMap

    assert MapVetoConfigSlot.__table__.schema == "tournament"
    assert {"map_veto_config_id", "position", "reserve_map_id"} <= set(
        MapVetoConfigSlot.__table__.columns.keys()
    )
    config_fk = next(iter(MapVetoConfigSlot.__table__.columns["map_veto_config_id"].foreign_keys))
    assert config_fk.ondelete == "CASCADE"
    reserve_fk = next(iter(MapVetoConfigSlot.__table__.columns["reserve_map_id"].foreign_keys))
    assert reserve_fk.ondelete == "SET NULL"

    slot_fk = next(iter(MapVetoConfigSlotMap.__table__.columns["map_veto_config_slot_id"].foreign_keys))
    assert slot_fk.ondelete == "CASCADE"


def test_flat_pool_table_is_untouched():
    """Flat mode must not feel this feature (design Decision 2)."""
    from shared.models.tournament.encounter_map import MapVetoConfigMap

    uniques = {
        c.name: [col.name for col in c.columns]
        for c in MapVetoConfigMap.__table__.constraints
        if c.name == "uq_map_veto_config_map_config_map"
    }
    assert uniques["uq_map_veto_config_map_config_map"] == ["map_veto_config_id", "map_id"]


def test_config_mode_and_rotation_are_enums_with_value_binding():
    """`values_callable` is mandatory: without it SQLAlchemy binds member NAMES
    ('POOL'), which the PG type rejects on every insert."""
    from shared.models.tournament.encounter_map import MapVetoConfig

    for name in ("mode", "first_ban_rotation"):
        col_type = MapVetoConfig.__table__.columns[name].type
        assert col_type.enums, f"{name} is not an enum"
        assert all(value.islower() for value in col_type.enums), f"{name} binds names, not values"
```

**Step 3: Run it and watch it fail**

```bash
cd backend/shared && uv run python -m pytest tests/test_map_veto_config_map_model.py -q
```
Expected: FAIL on the import of `MapVetoConfigSlot`.

**Step 4: Add the models**

In `backend/shared/models/tournament/encounter_map.py`:

- Add the enum wrappers beside the existing ones, following their exact shape:

```python
MAP_VETO_MODE_ENUM = Enum(
    enums.MapVetoMode,
    values_callable=lambda e: [x.value for x in e],
    name="mapvetomode",
    schema="tournament",
    create_type=False,
)

FIRST_BAN_ROTATION_ENUM = Enum(
    enums.FirstBanRotation,
    values_callable=lambda e: [x.value for x in e],
    name="firstbanrotation",
    schema="tournament",
    create_type=False,
)
```

- On `MapVetoConfig`, add the two columns and the `slots` relationship (ordered by `position`, `cascade="all, delete-orphan"`, mirroring how `map_pool` is declared).
- On `EncounterMapPool`, add `slot: Mapped[int | None]`.
- On `EncounterVetoSession`, add `slot_reserves_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)`.
- Add `MapVetoConfigSlot` and `MapVetoConfigSlotMap` classes matching the migration exactly, with `MapVetoConfigSlot.maps` ordered by `sort_order` and `cascade="all, delete-orphan"`.
- Add both new names to `__all__`.

**Step 5: Run the test**

```bash
uv run python -m pytest tests/test_map_veto_config_map_model.py -q
```
Expected: PASS.

**Step 6: Commit**

```bash
git add backend/shared/models/tournament/encounter_map.py backend/shared/core/enums.py backend/shared/tests/test_map_veto_config_map_model.py
git commit -m "feat(veto): add slot models, mode and rotation columns"
```

---

## Task 4: The slot sequence generator

Pure function, no DB. This is the heart of the feature — do it properly with TDD.

**Files:**
- Modify: `backend/tournament-service/src/services/encounter/veto_session.py`
- Test: `backend/tournament-service/tests/test_veto_session.py`

**Read first:** design §4.3.

**Step 1: Write the failing tests**

Append to `backend/tournament-service/tests/test_veto_session.py`:

```python
class BuildSlotSequenceTests(TestCase):
    """One slot = (candidates - 1) alternating bans, then a decider.
    Steps must total the pool size, because `get_current_step` indexes the flat
    token list by how many pool entries are no longer AVAILABLE."""

    def test_two_slots_of_three_alternating_from_the_higher_seed(self) -> None:
        self.assertEqual(
            [
                "ban_first", "ban_second", "decider",
                "ban_first", "ban_second", "decider",
            ],
            build_slot_sequence([3, 3], rotation="fixed"),
        )

    def test_alternate_rotation_flips_who_opens_each_slot(self) -> None:
        self.assertEqual(
            [
                "ban_first", "ban_second", "decider",
                "ban_second", "ban_first", "decider",
            ],
            build_slot_sequence([3, 3], rotation="alternate"),
        )

    def test_step_count_equals_total_candidates(self) -> None:
        for counts in ([3, 3], [3, 3, 3], [2, 4], [3, 3, 3, 3, 3]):
            sequence = build_slot_sequence(counts, rotation="fixed")
            self.assertEqual(sum(counts), len(sequence), f"counts={counts}")
            self.assertEqual(len(counts), sequence.count("decider"), f"counts={counts}")

    def test_one_decider_per_slot_and_each_closes_its_slot(self) -> None:
        sequence = build_slot_sequence([2, 3], rotation="fixed")
        self.assertEqual(["ban_first", "decider", "ban_first", "ban_second", "decider"], sequence)

    def test_empty_slot_list_yields_no_steps(self) -> None:
        self.assertEqual([], build_slot_sequence([], rotation="fixed"))
```

Add `build_slot_sequence` to the import block at the top of the file.

**Step 2: Run and watch it fail**

```bash
cd backend/tournament-service && uv run python -m pytest tests/test_veto_session.py -q
```
Expected: FAIL — cannot import `build_slot_sequence`.

**Step 3: Implement**

In `veto_session.py`, beside `build_sequence_for_best_of`:

```python
def build_slot_sequence(candidate_counts: list[int], *, rotation: str) -> list[str]:
    """Generate the side-agnostic sequence for a slot-mode config.

    Each slot contributes ``(candidates - 1)`` alternating bans and one
    ``decider`` that closes it, so the step total equals the pool size and
    ``get_current_step``'s arithmetic keeps working unchanged.

    ``rotation``: ``fixed`` opens every slot with the higher seed; ``alternate``
    opens odd-numbered slots with the higher seed and even ones with the lower
    (design Decision 3).

    NOTE: the result carries one decider per slot, mid-sequence. It is a SESSION
    sequence and must never be passed to ``validate_veto_config``, which rejects
    more than one decider and requires it last. That validator guards config
    upserts only (design Decision 16).
    """
    tokens: list[str] = []
    for index, count in enumerate(candidate_counts):
        opens_first = rotation != FirstBanRotation.ALTERNATE or index % 2 == 0
        for ban in range(count - 1):
            first_turn = (ban % 2 == 0) == opens_first
            tokens.append("ban_first" if first_turn else "ban_second")
        tokens.append("decider")
    return tokens
```

Import `FirstBanRotation` from `shared.core.enums`.

**Step 4: Run the test**

```bash
uv run python -m pytest tests/test_veto_session.py -q
```
Expected: PASS, all of them.

**Step 5: Prove the tests are not vacuous**

Break the source and confirm the tests catch it:

```bash
# make rotation a no-op
sed -i 's/opens_first = rotation != FirstBanRotation.ALTERNATE or index % 2 == 0/opens_first = True/' \
  src/services/encounter/veto_session.py
uv run python -m pytest tests/test_veto_session.py -q   # expect the alternate test to FAIL
git checkout src/services/encounter/veto_session.py
uv run python -m pytest tests/test_veto_session.py -q   # expect PASS again
```

Do this for every guard you add in this plan. A test that passes both with and against the source is worse than no test.

**Step 6: Commit**

```bash
git add backend/tournament-service/src/services/encounter/veto_session.py backend/tournament-service/tests/test_veto_session.py
git commit -m "feat(veto): generate slot-mode step sequences"
```

---

## Task 5: Mode-aware config validation

**Files:**
- Modify: `backend/tournament-service/src/services/encounter/veto_session.py:48-67` (`validate_veto_config`)
- Test: `backend/tournament-service/tests/test_veto_session.py`

**Read first:** design Decision 16, Decision 15, Decision 17.

**The existing validator must keep its flat branch byte-identical** — `test_veto_session.py`'s existing `ValidateVetoConfigTests` pin it and must pass unmodified (design test property 7).

**Step 1: Write the failing tests**

```python
class ValidateSlotConfigTests(TestCase):
    def test_rejects_a_slot_with_fewer_than_two_candidates(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_slot_config([[1, 2, 3], [4]], reserves=[None, None])
        self.assertIn("at least two candidate maps", ctx.exception.detail)

    def test_rejects_an_empty_slot_list(self) -> None:
        with self.assertRaises(HTTPException):
            validate_slot_config([], reserves=[])

    def test_rejects_duplicate_candidates_within_one_slot(self) -> None:
        with self.assertRaises(HTTPException):
            validate_slot_config([[1, 1, 2]], reserves=[None])

    def test_allows_the_same_map_in_two_different_slots(self) -> None:
        """A map may be a candidate of one slot and of another; only within-slot
        duplication is meaningless (design Decision 9/11)."""
        validate_slot_config([[1, 2], [1, 3]], reserves=[None, None])

    def test_allows_a_reserve_that_is_also_a_candidate_elsewhere(self) -> None:
        validate_slot_config([[1, 2], [3, 4]], reserves=[3, None])
```

**Step 2: Run, watch fail, implement**

```python
def validate_slot_config(slots: list[list[int]], *, reserves: list[int | None]) -> None:
    """Validate a slot-mode config upsert.

    Slots need >= 2 candidates: a single-candidate slot emits back-to-back
    deciders, and `auto_complete_decider` resolves only one per call while no
    captain may act on a decider step — the veto would stall (design Decision 15).
    """
    if not slots:
        raise HTTPException(status_code=422, detail="slots must not be empty")
    if len(reserves) != len(slots):
        raise HTTPException(status_code=422, detail="one reserve entry per slot is required")
    for index, candidates in enumerate(slots, start=1):
        if len(candidates) < 2:
            raise HTTPException(
                status_code=422,
                detail=f"slot {index} needs at least two candidate maps",
            )
        if len(set(candidates)) != len(candidates):
            raise HTTPException(status_code=422, detail=f"slot {index} has duplicate maps")
```

**Step 3: Verify the flat tests still pass unmodified**

```bash
uv run python -m pytest tests/test_veto_session.py -q
```
Expected: PASS including every pre-existing `ValidateVetoConfigTests` case, with no edits to them.

**Step 4: Mutation-check, then commit**

```bash
git add -u && git commit -m "feat(veto): validate slot-mode configs"
```

---

## Task 6: `current_slot` and the slot-scoped decider

**Files:**
- Modify: `backend/tournament-service/src/services/encounter/map_veto.py` — add `current_slot`; change `auto_complete_decider_entry:117-141`
- Test: `backend/tournament-service/tests/test_map_veto_state.py`

**Read first:** design §4.2. Note the corrected derivation: `min` is **guarded**, and `None` means flat mode *or* completed — nothing needs to tell those apart, because `get_current_step` returns `None` first in the completed case.

**Step 1: Write the failing tests**

```python
def _entry(map_id, *, slot=None, status=MapPoolEntryStatus.AVAILABLE):
    return SimpleNamespace(map_id=map_id, slot=slot, status=status, action_index=None,
                           picked_by=None, order=0, team_id=None)


class CurrentSlotTests(TestCase):
    def test_returns_the_lowest_slot_with_an_available_map(self):
        pool = [
            _entry(1, slot=1, status=MapPoolEntryStatus.BANNED),
            _entry(2, slot=1),
            _entry(3, slot=2),
        ]
        self.assertEqual(1, current_slot(pool))

    def test_returns_none_when_every_entry_is_consumed(self):
        """The terminal state of every finished slot-mode veto. An unguarded
        `min()` raised here, on the read path that serves the room."""
        pool = [_entry(1, slot=1, status=MapPoolEntryStatus.PICKED)]
        self.assertIsNone(current_slot(pool))

    def test_returns_none_for_a_flat_pool(self):
        self.assertIsNone(current_slot([_entry(1), _entry(2)]))


class SlotScopedDeciderTests(TestCase):
    def test_resolves_slot_one_while_slot_two_still_has_maps(self):
        """Pre-fix this raised 400: the check counted AVAILABLE across the whole
        pool, and slot 2's untouched candidates made it != 1."""
        pool = [
            _entry(1, slot=1, status=MapPoolEntryStatus.BANNED),
            _entry(2, slot=1, status=MapPoolEntryStatus.BANNED),
            _entry(3, slot=1),
            _entry(4, slot=2), _entry(5, slot=2), _entry(6, slot=2),
        ]
        sequence = ["ban_home", "ban_away", "decider", "ban_home", "ban_away", "decider"]
        entry = auto_complete_decider_entry(sequence, pool)
        self.assertEqual(3, entry.map_id)
        self.assertEqual(MapPoolEntryStatus.PICKED, entry.status)
```

**Step 2: Run, watch fail, implement**

```python
def current_slot(pool: list[models.EncounterMapPool]) -> int | None:
    """The slot the veto is resolving, or None in flat mode and when complete.

    Slots are consumed in ascending order because the generator lays steps out
    slot by slot and each step consumes exactly one entry. `None` is unambiguous
    for callers: flat mode has no slots, and a completed veto has no pending
    step, which `get_current_step` reports first.
    """
    slots = [
        entry.slot
        for entry in pool
        if entry.status == MapPoolEntryStatus.AVAILABLE and entry.slot is not None
    ]
    return min(slots) if slots else None
```

Then in `auto_complete_decider_entry`, scope the availability check:

```python
    active_slot = current_slot(pool)
    available = [
        entry
        for entry in pool
        if entry.status == MapPoolEntryStatus.AVAILABLE
        and (active_slot is None or entry.slot == active_slot)
    ]
    if len(available) != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Decider step requires exactly one available map",
        )
```

`entry.order = count(PICKED)` below stays as-is: slot 1's survivor is picked first and gets `order = 1`.

**Step 3: Run both suites, mutation-check, commit**

```bash
uv run python -m pytest tests/test_map_veto_state.py tests/test_veto_session.py -q
git add -u && git commit -m "fix(veto): scope the decider step to the current slot"
```

---

## Task 7: Slot restriction in `apply_veto_action`

**Files:**
- Modify: `backend/tournament-service/src/services/encounter/map_veto.py:306-316`
- Test: `backend/tournament-service/tests/test_map_veto_state.py`

**Step 1: Write the failing tests**

```python
class SlotRestrictionTests(TestCase):
    def test_rejects_banning_a_map_from a_future_slot(self):
        ...  # expect HTTPException mentioning the slot
    def test_the_same_map_in_two_slots_resolves_to_the_current_slot_entry(self):
        """Banning map 1 while slot 1 is active must leave slot 2's entry for
        the same map AVAILABLE — the lookup keys on (map_id, slot), not map_id."""
```

Write both fully, following the fixture style above.

**Step 2: Implement**

Replace the entry lookup:

```python
    active_slot = current_slot(pool)
    entry = next(
        (
            candidate
            for candidate in pool
            if candidate.map_id == map_id
            and (active_slot is None or candidate.slot == active_slot)
        ),
        None,
    )
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Map is not in the pool for this encounter"
                if active_slot is None
                else f"Map is not a candidate of slot {active_slot}"
            ),
        )
```

**Step 3: Run, mutation-check, commit.**

---

## Task 8: Expose `current_slot` in the state payload

**Files:**
- Modify: `backend/tournament-service/src/services/encounter/map_veto.py` — `build_map_pool_state:192-230`, `serialize_map_pool_entry:91-100`
- Test: `backend/tournament-service/tests/test_map_veto_state.py`

Add `"current_slot": current_slot(pool)` to the state dict and `"slot": entry.slot` to the entry serializer. Add a test asserting a completed slot-mode pool serializes with `current_slot: None` **without raising** — that is design test property 8 and the second FATAL the review caught.

Run, mutation-check, commit.

---

## Task 9: `effective_sequence` takes slot structure

**Files:**
- Modify: `backend/tournament-service/src/services/encounter/veto_session.py:122-143`
- Test: `backend/tournament-service/tests/test_veto_session.py`

`effective_sequence` currently receives a scalar `pool_size`. Slot mode needs per-slot candidate counts. Change the signature to accept the config's slots and dispatch on `config.mode`:

- `mode == slots` -> `build_slot_sequence([len(s.maps) for s in config.slots], rotation=config.first_ban_rotation)`
- `mode == pool` -> unchanged behaviour, including the `preset == "custom"` passthrough and the `best_of < 1` fallback.

Existing `EffectiveSequenceTests` must pass unmodified. Add slot-mode cases. Run, mutation-check, commit.

---

## Task 10: Session creation — slots, reserves, reconciliation

The largest backend task. Read design §4.7 in full first.

**Files:**
- Modify: `backend/tournament-service/src/services/encounter/veto_session.py` — `ensure_veto_session:326-392`, `resolve_config:170-190`, `unavailable_reason:249-253`
- Test: `backend/tournament-service/tests/test_veto_session.py`

**Required behaviour:**

1. `resolve_config` eager-loads the slot relations as well as `map_pool`, or every slot access lazy-loads outside the greenlet and 500s.
2. Pool rows carry `slot` from the config slot's `position`.
3. `slot_reserves_json` is snapshotted as `{position: reserve_map_id}` for slots that have one. The room reads the snapshot, never the live config (Decision 18).
4. **Reconciliation** (Decision 14): `best_of < slot_count` -> use the first `best_of` slots. `best_of > slot_count` -> do not create the session; return a new reason.
5. **Candidate re-check** (Decision 21): any slot in play with `< 2` candidates -> do not create the session; return a reason. A catalogue delete can cascade a slot below the floor without any upsert running.
6. Add the new reason(s) to `unavailable_reason` and to the frontend `VetoUnavailableReason` union (Task 15).

**Name the reasons explicitly** — Task 19 needs distinct copy per cause, and the Advocate's blocker recurs at the copy level if two causes share one string:
- `slot_count_mismatch` — the bracket wants more maps than the config has slots.
- `slot_underfilled` — a slot in play has fewer than two candidates.

Write tests for each of 2-5 before implementing. Run, mutation-check, commit.

---

## Task 11: Block `initialize_map_pool` against a slot-mode session

**Files:**
- Modify: `backend/tournament-service/src/rpc/admin_misc.py:172-175`
- Test: `backend/tournament-service/tests/` (new or existing RPC test module)

Return 409 when the encounter has a slot-mode veto session. **The reason is not a type error** — `current_slot` filters `slot is not None`, so no `None`/`int` comparison can occur. It is that NULL-slot rows belong to no slot, can never be banned or picked, stay AVAILABLE forever, and `get_current_step` then points at a step no entry can satisfy: the veto stalls with no recovery but a reset. Put that in the code comment so a future reader does not delete the guard.

Run, commit.

---

## Task 12: `_map_veto_signature` in both services

**Files:**
- Modify: `backend/tournament-service/src/services/admin/stage.py:213-221`
- Modify: `backend/parser-service/src/services/admin/stage.py:179-187`
- Test: `backend/tournament-service/tests/test_admin_stage_merge.py`

Both copies must include `mode` and the slot structure. `_merge_map_veto_configs` raises 409 only when signatures **differ**, so equal signatures merge silently and the survivor's structure wins arbitrarily.

The signature must distinguish `slot1=[A,B]/slot2=[C,D]` from `slot1=[A,B,C]/slot2=[D]` — both share the same flat union, so a union-based signature merges them. Include the partition, not the union, plus reserves.

**The two copies must move together.** `dbarch05`'s docstring warns about exactly this coupling. Write the test in tournament-service, then port the identical change to parser-service and verify by reading both.

Run both services' suites, commit.

---

## Task 13: RPC upsert accepts slots

**Files:**
- Modify: `backend/tournament-service/src/rpc/veto_admin.py:36-43` (`VetoConfigUpsert`), `:84-147` (handler)
- Modify: `backend/tournament-service/src/services/encounter/map_veto.py:79-90` (`serialize_veto_config`)

**Contract (design Decision 17, and the arbitration ruling on `map_ids`):**
- `mode` is **required, no default**. A client that omits it gets 422. The endpoint replaces the pool wholesale, so a default would let a stale admin tab silently convert a slot config to flat and orphan its slot rows.
- In slot mode, `map_ids` and `sequence` must be `[]`; any other value is 422.
- `slots: list[{candidates: list[int], reserve_map_id: int | None}]` in slot mode.
- The handler clears the other mode's rows in the same transaction: switching to slots empties `map_pool`, switching to pool empties `slots`.
- **`map_veto_config_map` stays empty in slot mode.** Revision 3 proposed mirroring the union there for rollout safety; arbitration struck it — the mirror turns a visibly dead room into a plausible flat veto over every slot's candidates that captains can act on. Deploy ordering is the only real lever.
- `serialize_veto_config` emits `mode`, `first_ban_rotation` and `slots`.

Write tests for the 422s and the round-trip first. Run, commit.

---

## Task 14: The eight eager-load sites plus the refresh

**Files:** every site listed in design §4.2's edit table:
- `backend/tournament-service/src/rpc/veto_admin.py:73`, `:113`, `:144` (refresh)
- `backend/tournament-service/src/rpc/reads.py:291`
- `backend/tournament-service/src/services/encounter/veto_session.py:183`
- `backend/tournament-service/src/services/admin/stage.py:235`, `:250`
- `backend/parser-service/src/services/admin/stage.py:201`, `:216`

Each currently does `selectinload(models.MapVetoConfig.map_pool)`. Each must also load `slots` and `slots.maps`. **A miss is a `MissingGreenlet` 500, not a wrong answer** — lazy loading outside the async greenlet.

```bash
cd backend && rg -n "selectinload\(models\.MapVetoConfig\.map_pool\)" --glob '*.py'
```
Expect zero results that do not also load `slots` when you are done. Run both services' suites, commit.

---

## Task 15: Frontend types and service

**Files:**
- Modify: `frontend/src/types/tournament.types.ts` — `MapVetoConfig`, `MapVetoConfigUpsertInput`, `EncounterMapPoolState`, `EncounterMapPoolEntry`, `VetoUnavailableReason`
- Modify: `frontend/src/services/admin.service.ts`

Add `mode`, `first_ban_rotation`, `slots` to the config types; `current_slot` to the state; `slot` to the entry; and `"slot_count_mismatch" | "slot_underfilled"` to `VetoUnavailableReason`.

Widening `VetoUnavailableReason` will make Task 19's exhaustive switch fail to compile until its copy exists. That is the intended order.

`npx tsc --noEmit`, commit.

---

## Task 16: i18n keys and glossary

**Files:**
- Modify: `frontend/src/i18n/messages/en.json`, `frontend/src/i18n/messages/ru.json`
- Modify: `frontend/src/i18n/GLOSSARY.md`
- Test: `bun test src/i18n`

**Glossary rows first** (design Decision 30) — the terminology must be fixed before any string lands:

| EN | RU | Notes |
|---|---|---|
| Slot | Слот | одна карта серии |
| Candidate | Кандидат | «карты-кандидаты» |
| Reserve map | Резервная карта | резерв при ничьей |

**Do not translate "rotation" as a noun.** «Ротация» already means map/hero rotation in this community, so «ротация первого бана» reads as something about which maps are in play. The control is labelled «Кто банит первым» with options «Всегда высший сид» / «По очереди».

New keys, EN and RU at strict parity, all counts with full `one/few/many/other` Russian plurals. Every key must be reachable, and `src/i18n/mapVeto.messages.test.ts` will fail the build if a plural is malformed or a Russian category is missing — that guard is already mutation-verified.

```bash
bun test src/i18n
```
Commit.

---

## Task 17: Admin editor — pool-shape control

**Files:**
- Modify: `frontend/src/app/admin/tournaments/[id]/components/TournamentMapVetoTab.tsx`
- Test: `frontend/src/app/admin/tournaments/[id]/components/mapVetoTab.behavior.test.tsx`

**Read first:** design Decision 23. Slots are **not** a third kind of step order — they change what the pool *is*, and `slots` + `custom` is forbidden by CHECK, so a single three-way group would contradict the constraint.

- New control above the pool grid: "Map pool shape" — one pool for the match / a different pool per map in the series.
- The existing two-option "Veto step order" group stays, rendered only in flat mode.
- Switching pool shape **preserves the slot draft**, exactly as the form already preserves a hand-authored sequence across an order-mode toggle (`:230-241`). One mis-click must not discard 15 selections.
- **Do not introduce render-phase `setState` and do not add a `useEffect`.** The form is seeded by `useState` initializers in a child the parent remounts by `key`, gated on both queries succeeding. That shape is deliberate and is pinned by existing tests.

Write the behaviour test first: a `mode: "slots"` config opens in slot shape; toggling to flat and back restores the draft.

Run `npx vitest run` on that file, commit.

---

## Task 18: Admin editor — slot cards and the gate

**Files:** same as Task 17.

**Read first:** design §4.4 in full, Decisions 24-26 and 28.

- **N slot cards**, N derived from the bracket, not editable.
- **Inside each card**: the existing gamemode filter (`:546-580`) and select-visible action (`:297-307`). Every group-round slot is gamemode-homogeneous, so "filter to Control, select 3" is two gestures instead of six clicks, and a cross-mode mistake becomes structurally impossible.
- **Composition chips** per slot via the existing `mapVeto.filterOption` ("Slot 1: Control (3)").
- **Name filter** over the tile grid, matching on a normalized comparison: case-folded, diacritics stripped, U+2019 folded to U+0027. The regulation's four spellings are near-misses (`Peninsular`/`Peninsula`, `Shambali`/`Shambali Monastery`, `Paraiso`/`Paraíso`, `King’s`/`King's`).
- **Reserve map** picker per slot, optional.
- **The gate** must test the admin `BracketFormat`'s `scope` discriminator — `scope === "round"`, or `scope === "stage"` with `perRound === null && finalBestOf === null`. It must **not** test "is `bestOf` a number": `{ scope: "tournament" }` carries a concrete `DEFAULT_BEST_OF` and would wrongly pass. `BracketFormat` is at `:99-109`.
- When the gate fails, render slot mode **disabled with its reason**, never absent — the tab already does this for `mapVetoAdmin.formatUnknownScope` (`:473-477`).
- **Stage-scope warning**: at stage scope with slots selected, render `mapVetoAdmin.slotsStageScopeWarning`. The five group rounds are all Bo2 so stage scope *passes* the gate and invites one shared config, which is wrong for a regulation specifying a pool per round. Warning, not a block.
- **Client-side validation**: extend `validateVetoConfigForm` (`mapVeto.helpers.ts`) to slots so Save disables with a keyed message naming the offending slot. The tab's contract is that Save never enables into a known-invalid state.

Write behaviour tests for the gate (all three scopes), the `>= 2` client rejection, and select-visible inside a card. Run, commit.

---

## Task 19: Veto room — the blocker, slots, and mobile

**Files:**
- Modify: `frontend/src/app/(site)/tournaments/[id]/veto/[encounterId]/_components/VetoRoom.tsx:128-144`, `VetoMapGrid.tsx`, `VetoStepTimeline.tsx`
- Modify: `frontend/src/app/(site)/tournaments/[id]/veto/[encounterId]/_components/veto-model.ts`
- Test: `.../veto-model.test.ts` and a room behaviour test

**This contains the User Advocate's BLOCKER. Do it carefully.**

`VetoRoom.tsx:129` collapses the reason set into a boolean:

```ts
const teamsUnknown = state.reason === "teams_unknown";
```

Three ternaries then branch on it, so **any** new reason renders "Veto is not configured / check back later" — false for a config that exists but disagrees with the bracket, and it tells the captain to wait for something that will never happen.

Replace it with an **exhaustive map over `VetoUnavailableReason`**, so widening the union in Task 15 forces a copy decision at compile time. Both new reasons need their own text:
- `slot_count_mismatch` — the series needs more maps than the configured slots provide; the organizer must fix the config. Not "check back later".
- `slot_underfilled` — a slot has fewer than two candidate maps.

Also:
- **Status word.** Every slot survivor is a decider, so the grid would badge it "Picked" (`en.json:2078`) for a team that picked nothing — wrong on every map in slot mode. Slot mode needs "Remaining" / «Осталась».
- **Timeline** steps carry slot numbers; a flat timeline shows an undifferentiated "Decider" two to five times. Group the grid and the timeline together or not at all — `VetoRoom.tsx:186-194` stacks them in one viewport.
- **Narrow screens.** Below `lg` the timeline stacks above the grid; a Bo5 slot veto is 15 steps above five groups at two columns. Scroll the current slot into view when `current_slot` changes, and collapse the timeline to the current slot. A future slot's map is `available` yet unclickable — a state that does not exist today, where `canSelect` and `status === "available"` coincide — so it must look inert.

Write the reason-mapping test first and confirm it fails to compile before the copy exists. Run, commit.

---

## Task 20: Verification sweep

```bash
cd backend/tournament-service && uv run python -m pytest tests/ -q
cd ../parser-service && uv run python -m pytest tests/ -q
cd ../shared && uv run python -m pytest tests/ -q
cd ../../frontend && npx tsc --noEmit && npx eslint . && npx vitest run && bun test src/i18n src/lib
```

All green. Then **mutation-verify every new guard**: revert the source under it, confirm the test fails with the right diagnosis, restore, confirm it passes. A guard that passes both ways is noise.

Smoke test the real flow: configure a Bo2 slot config on stage 188 round 1 (Hybrid slot + Push slot, three candidates each), open the room for one of its ten encounters, ban through both slots, and confirm two maps are picked in slot order.

---

## Task 21: Stage-one honesty guard on the public page

**Files:**
- Modify: `frontend/src/app/(site)/tournaments/[id]/_views/TournamentMapsPage.tsx`

The public page is slot-unaware until stage two. It must **state that the pool is not shown for this round** rather than render a slot config as a flat pool — a slot config has an empty `map_veto_config_map`, so without this it would show "0 maps in the pool" or an empty grid for a round that is fully configured.

This is design §4.5's own honesty standard applied to the intermediate state, and it is a hard condition on stage one, not optional.

Commit.

---

## Stage two (separate deliverable, not in this plan)

Design §4.5's public-page half: slot rendering in play order, the four honesty corrections (`mapsPlayed` EN wording, attributed reserve caption, candidates-versus-distinct-maps, truncation disclosure), and Decision 29 — the public round selector reaching negative rounds, which currently makes all four LB configs publicly invisible.

## Accepted risk, carried forward

No cross-config read-back view ships. The composition chips and in-card filter make each selection easier and surface a within-slot error, but nothing verifies what was **saved**, across configs, against the paper regulation — "slot 3 of Round 4 received Round 5's maps" and "Round 2 was never saved" both survive careful entry. `admin_veto_config_list` already returns every config in one call, so the overview is a pure frontend render over data already on the client: cheap to omit now, cheap to add later. Owner: the organizer. Trigger: the first transcription error found in production.

## Deploy ordering

Both backend services first, then the admin UI. An old admin tab saving against the new schema is caught by the required `mode` 422, but an old backend reading a slot config sees an empty flat pool and would build a dead veto. There is no code-level fix for that direction; ordering is the control.
