"""``rpc.tournament.encounter_assign_map_pool`` must refuse a slot-mode veto.

The admin pool escape hatch creates entries with a NULL ``slot``, and neither
ordering survives that: appended onto a live slot-mode session they become rows
no step can ever select, and assigned before the session exists they become the
pool a slot-sized sequence is then run over. So the guard has two authorities,
and which one answers depends on the ordering: a live session's own snapshot,
and — with no session to snapshot — the cascaded config's ``mode``.

Why each ordering is unrecoverable is spelled out once, on
``admin_misc._require_flat_veto``. This module deliberately does not restate it:
an earlier copy here drifted from the guard's and went stale, so the mechanism
has exactly one home and the tests below name only what they assert.

Everything below drives the real subscriber through the real permission path with
a session fake that answers by the entity each query actually targets, so a guard
that asked for the wrong thing gets an ``AssertionError`` rather than a
conveniently correct answer.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import sqlalchemy as sa

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")

admin_misc = importlib.import_module("src.rpc.admin_misc")
helpers = importlib.import_module("src.rpc._helpers")
models = importlib.import_module("src.models")
enums = importlib.import_module("shared.core.enums")

SUBJECT = "rpc.tournament.encounter_assign_map_pool"

#: The three ids are deliberately all different, so a guard that passed the
#: wrong one along cannot land on the right row by coincidence.
ENCOUNTER_ID = 42
TOURNAMENT_ID = 7
STAGE_ID = 8
#: Also unequal to ``STAGE_ID``: a round is not a stage, and a cascade that
#: compared the two would still match if they shared a value.
ROUND = 3

MAP_IDS = [11, 12, 13, 14]

#: Grants exactly the gate this subject checks (``match.update``) and nothing
#: else, and is not a superuser, so the real permission path runs.
IDENTITY = {
    "user_id": 7,
    "is_superuser": False,
    "is_active": True,
    "roles": [],
    "permissions": [],
    "workspaces": [
        {
            "workspace_id": 1,
            "rbac_roles": [],
            "rbac_permissions": [{"resource": "match", "action": "update"}],
        }
    ],
}


def _session(*, slot_reserves: object) -> SimpleNamespace:
    """A veto session row. ``slot_reserves`` is the whole mode signal."""
    return SimpleNamespace(id=900, encounter_id=ENCOUNTER_ID, slot_reserves_json=slot_reserves)


def _config(mode: str, *, stage_id: int | None = None, round: int | None = None) -> SimpleNamespace:
    return SimpleNamespace(id=500 + (stage_id or 0), stage_id=stage_id, round=round, mode=mode)


SLOTS = enums.MapVetoMode.SLOTS
POOL = enums.MapVetoMode.POOL


class _Result:
    def __init__(self, rows: list) -> None:
        self._rows = rows

    def scalar_one_or_none(self):
        if len(self._rows) > 1:  # pragma: no cover - fake-integrity guard
            raise AssertionError("more than one row for a one-or-none query")
        return self._rows[0] if self._rows else None

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _CapturingBroker:
    """Records the handler behind each subject instead of binding a queue."""

    def __init__(self) -> None:
        self.handlers: dict[str, object] = {}

    def subscriber(self, subject, *args, **kwargs):
        def register(fn):
            self.handlers[subject] = fn
            return fn

        return register


def _bound_values(query) -> list:
    """Every literal bound into ``query``'s criteria."""
    return [
        element.value
        for element in sa.sql.visitors.iterate(query)
        if isinstance(element, sa.sql.elements.BindParameter)
    ]


class _FakeSession:
    """Answers each query by the entity it targets, and records the targets.

    Dispatching on ``column_descriptions`` rather than on call order is what
    makes the fixture unable to flatter a wrong query: asking for anything the
    guard has no business asking for raises instead of returning a row. The
    bound-id assertions close the other half of that hole -- a fake that handed
    back its row no matter what was filtered on would accept a guard that looked
    up somebody else's encounter.
    """

    def __init__(self, *, veto: object | None, configs: list) -> None:
        self._veto = veto
        self._configs = configs
        self.encounter = SimpleNamespace(
            id=ENCOUNTER_ID,
            tournament_id=TOURNAMENT_ID,
            stage_id=STAGE_ID,
            round=ROUND,
        )
        self.targets: list[str] = []

    async def execute(self, query):
        entity = query.column_descriptions[0]["entity"]
        self.targets.append(entity.__name__)
        bound = _bound_values(query)
        if entity is models.EncounterVetoSession:
            if ENCOUNTER_ID not in bound:
                raise AssertionError(f"the session lookup filtered on {bound}, not encounter {ENCOUNTER_ID}")
            return _Result([self._veto] if self._veto is not None else [])
        if entity is models.MapVetoConfig:
            # ``resolve_config`` binds the encounter's tournament and stage, so
            # this also proves the encounter it was handed is the right one.
            if TOURNAMENT_ID not in bound:
                raise AssertionError(f"the config cascade filtered on {bound}, not tournament {TOURNAMENT_ID}")
            return _Result(self._configs)
        raise AssertionError(f"the guard queried an unexpected entity: {entity!r}")

    async def get(self, entity, ident):
        if entity is not models.Encounter:
            raise AssertionError(f"the guard loaded an unexpected entity: {entity!r}")
        if ident != ENCOUNTER_ID:
            raise AssertionError(f"the guard loaded encounter {ident}, not the one it was called for")
        self.targets.append("get:Encounter")
        return self.encounter

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class AssignMapPoolSlotGuard(IsolatedAsyncioTestCase):
    async def _invoke(self, *, veto: object | None = None, configs: list | None = None) -> tuple[dict, list, list]:
        """Drive the subject. Returns (envelope, initialize_map_pool calls, query targets)."""
        broker = _CapturingBroker()
        admin_misc.register(broker, SimpleNamespace(exception=lambda *a, **k: None))
        self.assertIn(SUBJECT, broker.handlers, "subject is not registered")

        session = _FakeSession(veto=veto, configs=configs or [])
        calls: list[tuple[int, list[int]]] = []

        async def _initialize_map_pool(_session, encounter_id, map_ids):
            calls.append((encounter_id, list(map_ids)))
            return [object() for _ in map_ids]

        async def _workspace_id(_session, _encounter_id):
            return 1

        self.enterContext(patch.object(helpers.db, "async_session_maker", session))
        self.enterContext(patch.object(admin_misc.auth, "get_encounter_workspace_id", _workspace_id))
        self.enterContext(patch.object(admin_misc.map_veto_service, "initialize_map_pool", _initialize_map_pool))

        envelope = await broker.handlers[SUBJECT](
            {"identity": IDENTITY, "id": ENCOUNTER_ID, "payload": {"map_ids": MAP_IDS}}, None
        )
        return envelope, calls, session.targets

    def _assert_refused(self, envelope: dict, calls: list) -> None:
        self.assertFalse(envelope["ok"], envelope)
        self.assertEqual("conflict", envelope["error"]["code"], envelope)
        self.assertIn("slot_mode_veto", envelope["error"]["message"])
        self.assertEqual([], calls, "the pool was written despite the refusal")

    def _assert_assigned(self, envelope: dict, calls: list) -> None:
        self.assertTrue(envelope["ok"], envelope)
        self.assertEqual({"assigned": len(MAP_IDS)}, envelope["data"])
        self.assertEqual([(ENCOUNTER_ID, MAP_IDS)], calls)

    # ── a live session decides for itself ──────────────────────────────────

    async def test_a_slot_mode_session_is_a_conflict(self) -> None:
        envelope, calls, _ = await self._invoke(veto=_session(slot_reserves={"3": 77}))

        self._assert_refused(envelope, calls)

    async def test_a_slot_mode_session_with_no_reserves_at_all_is_still_a_conflict(self) -> None:
        # ``reserve_map_id`` is optional on every slot, so ``slot_reserves``
        # snapshots ``{}`` for a config that names none -- falsy, and the one
        # fixture that separates ``is not None`` from a truthiness test.
        envelope, calls, _ = await self._invoke(veto=_session(slot_reserves={}))

        self._assert_refused(envelope, calls)

    async def test_a_flat_mode_session_is_still_assignable(self) -> None:
        envelope, calls, _ = await self._invoke(veto=_session(slot_reserves=None))

        self._assert_assigned(envelope, calls)

    async def test_a_flat_mode_session_wins_over_a_slot_mode_config(self) -> None:
        # ``config_id`` is ON DELETE SET NULL and the config stays editable, so a
        # running veto's shape is its snapshot's business and not the config's.
        # This is also what proves the config is not consulted as a second
        # opinion: a guard that OR-ed the two would refuse here.
        envelope, calls, targets = await self._invoke(
            veto=_session(slot_reserves=None), configs=[_config(SLOTS, stage_id=STAGE_ID)]
        )

        self._assert_assigned(envelope, calls)
        self.assertEqual(["EncounterVetoSession"], targets)

    async def test_a_slot_mode_session_wins_over_a_flat_config(self) -> None:
        envelope, calls, targets = await self._invoke(
            veto=_session(slot_reserves={"1": 77}), configs=[_config(POOL, stage_id=STAGE_ID)]
        )

        self._assert_refused(envelope, calls)
        self.assertEqual(["EncounterVetoSession"], targets)

    # ── with no session, the cascaded config decides ───────────────────────

    async def test_a_slot_mode_config_refuses_the_pool_that_would_strand_the_session(self) -> None:
        # The ordering that actually stalls, and the replacement for
        # ``test_veto_session.py::test_a_pre_existing_pool_is_left_alone``, which
        # pinned the resulting broken state as a starting point for this guard and
        # was retired with it: ``ensure_veto_session`` keeps a pool that already
        # exists (``if not pool_count``, pinned by
        # ``test_veto_session.py::test_an_existing_pool_is_never_overwritten_by_the_config``)
        # and sizes its sequence from the slots anyway, so the pool this call
        # would write is the pool the room is then stuck with. Refusing the write
        # is what makes that state unreachable.
        envelope, calls, targets = await self._invoke(configs=[_config(SLOTS)])

        self._assert_refused(envelope, calls)
        self.assertEqual(["EncounterVetoSession", "get:Encounter", "MapVetoConfig"], targets)

    async def test_a_flat_config_is_assignable_before_any_session_exists(self) -> None:
        envelope, calls, _ = await self._invoke(configs=[_config(POOL)])

        self._assert_assigned(envelope, calls)

    async def test_no_session_and_no_config_at_all_is_assignable(self) -> None:
        # The historical use of this route: seed a pool for an encounter whose
        # tournament has no veto config. Nothing to conflict with.
        envelope, calls, _ = await self._invoke()

        self._assert_assigned(envelope, calls)

    async def test_the_cascade_picks_the_config_that_applies_not_any_slot_config(self) -> None:
        # A stage-level flat config overrides the tournament-level slot one, so
        # this encounter's veto is flat and the assignment is legitimate. A guard
        # that scanned the candidate rows for ``slots`` would refuse it.
        envelope, calls, _ = await self._invoke(
            configs=[_config(SLOTS), _config(POOL, stage_id=STAGE_ID)],
        )

        self._assert_assigned(envelope, calls)

    async def test_the_cascade_refuses_when_the_applicable_config_is_the_slot_one(self) -> None:
        # The mirror image: same two levels, modes swapped. A guard that read the
        # first row, or the least specific one, would allow this.
        envelope, calls, _ = await self._invoke(
            configs=[_config(POOL), _config(SLOTS, stage_id=STAGE_ID)],
        )

        self._assert_refused(envelope, calls)

    async def test_a_round_scoped_slot_config_for_another_round_does_not_refuse(self) -> None:
        # ``round`` is the most specific cascade level; a config pinned to a
        # round this encounter does not play is not this encounter's config.
        envelope, calls, _ = await self._invoke(
            configs=[_config(POOL, stage_id=STAGE_ID), _config(SLOTS, stage_id=STAGE_ID, round=ROUND + 1)],
        )

        self._assert_assigned(envelope, calls)
