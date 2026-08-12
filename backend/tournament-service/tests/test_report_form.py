"""The per-tournament match-report form config, and what it makes captains fill in.

Two halves. The config half pins that an absent row reads as the documented
defaults without writing one, and that the organizer's payload cannot smuggle in
a key that would collide with a built-in field or be unreachable from the UI. The
submit half pins the validation table from
``docs/plans/2026-08-04-configurable-match-report-form.md``: a disabled field's
value is DROPPED rather than rejected (a client holding a stale config must not
fail a submit it could not have known about), and ``map_codes.required`` counts
maps actually played, not best-of slots.
"""

from __future__ import annotations

import importlib
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, Mock

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

pydantic = importlib.import_module("pydantic")
report_form = importlib.import_module("src.services.encounter.report_form")
schemas = importlib.import_module("src.schemas.encounter_report_form")


@contextmanager
def assert_detail(test_case: TestCase, expected_detail: str):
    """A 422 whose human ``detail`` is exactly the documented message."""
    try:
        yield
    except Exception as exc:  # noqa: BLE001 - inspect status_code/detail attributes
        test_case.assertEqual(getattr(exc, "status_code", None), 422)
        test_case.assertEqual(getattr(exc, "detail", None), expected_detail)
        return
    test_case.fail(f"expected a 422 with detail {expected_detail!r}")


def _mk_session(stored=None):
    added: list[object] = []

    async def fake_execute(_query):
        result = Mock()
        result.scalar_one_or_none.return_value = stored
        return result

    return SimpleNamespace(
        execute=AsyncMock(side_effect=fake_execute),
        commit=AsyncMock(),
        add=lambda obj: added.append(obj),
        _added=added,
    )


def _mk_stored(built_in: dict | None = None, custom: list | None = None) -> SimpleNamespace:
    """A stand-in for a persisted ``EncounterReportForm`` row."""
    return SimpleNamespace(
        tournament_id=1,
        built_in_fields_json=built_in if built_in is not None else {},
        custom_fields_json=custom if custom is not None else [],
    )


def _mk_form(
    *,
    closeness: tuple[bool, bool] = (True, True),
    map_codes: tuple[bool, bool] = (True, False),
    comment: tuple[bool, bool] = (True, False),
    custom: list[dict] | None = None,
) -> schemas.MatchReportFormRead:
    """A resolved config; each built-in is given as ``(enabled, required)``."""
    return schemas.MatchReportFormRead(
        tournament_id=1,
        built_in_fields={
            name: schemas.ReportBuiltInFieldConfig(enabled=enabled, required=required)
            for name, (enabled, required) in (
                ("closeness", closeness),
                ("map_codes", map_codes),
                ("comment", comment),
            )
        },
        custom_fields=[schemas.ReportCustomFieldDefinition.model_validate(c) for c in (custom or [])],
    )


def _validate(form: schemas.MatchReportFormRead, **overrides):
    kwargs = {
        "home_score": 2,
        "away_score": 1,
        "closeness": None,
        "map_codes": (),
        "comment": None,
        "custom_fields": None,
        # A plain Bo3's slot set, as `series_map_indices` would build it.
        "available_map_indices": (1, 2, 3),
    }
    kwargs.update(overrides)
    return report_form.validate_submission(form, **kwargs)


class ResolveReportForm(IsolatedAsyncioTestCase):
    async def test_no_row_reads_as_defaults_and_writes_nothing(self) -> None:
        session = _mk_session(stored=None)
        form = await report_form.resolve_report_form(session, 1)

        self.assertEqual(1, form.tournament_id)
        self.assertEqual({"closeness", "map_codes", "comment"}, set(form.built_in_fields))
        self.assertEqual((True, True), _pair(form, "closeness"))
        self.assertEqual((True, False), _pair(form, "map_codes"))
        self.assertEqual((True, False), _pair(form, "comment"))
        self.assertEqual([], form.custom_fields)
        # Reads never materialize the row.
        self.assertEqual([], session._added)
        session.commit.assert_not_awaited()

    async def test_stored_keys_win_and_missing_keys_fall_back(self) -> None:
        session = _mk_session(
            _mk_stored(
                built_in={"closeness": {"enabled": False, "required": False}},
                custom=[{"key": "vod", "label": "VOD link", "type": "text", "required": True, "placeholder": None}],
            )
        )
        form = await report_form.resolve_report_form(session, 1)

        self.assertEqual((False, False), _pair(form, "closeness"))
        self.assertEqual((True, False), _pair(form, "map_codes"))  # untouched default
        self.assertEqual(["vod"], [c.key for c in form.custom_fields])
        self.assertTrue(form.custom_fields[0].required)


def _pair(form: schemas.MatchReportFormRead, name: str) -> tuple[bool, bool]:
    config = form.built_in_fields[name]
    return (config.enabled, config.required)


class UpsertReportForm(IsolatedAsyncioTestCase):
    BODY = {
        "built_in_fields": {
            "closeness": {"enabled": False, "required": False},
            "map_codes": {"enabled": True, "required": True},
        },
        "custom_fields": [{"key": "vod", "label": "VOD link", "required": True}],
    }

    async def test_inserts_when_absent_and_round_trips(self) -> None:
        session = _mk_session(stored=None)
        out = await report_form.upsert_report_form(session, 7, schemas.MatchReportFormUpsert.model_validate(self.BODY))

        self.assertEqual(1, len(session._added))
        row = session._added[0]
        self.assertEqual(7, row.tournament_id)
        self.assertEqual({"enabled": False, "required": False}, row.built_in_fields_json["closeness"])
        self.assertEqual(["vod"], [c["key"] for c in row.custom_fields_json])
        session.commit.assert_awaited_once()

        self.assertEqual(7, out.tournament_id)
        self.assertEqual((False, False), _pair(out, "closeness"))
        self.assertEqual((True, True), _pair(out, "map_codes"))
        # Absent from the payload, so it reads back as the default.
        self.assertEqual((True, False), _pair(out, "comment"))
        self.assertEqual(["vod"], [c.key for c in out.custom_fields])

    async def test_updates_the_existing_row_in_place(self) -> None:
        stored = _mk_stored(built_in={"comment": {"enabled": False, "required": False}}, custom=[])
        session = _mk_session(stored)
        out = await report_form.upsert_report_form(session, 7, schemas.MatchReportFormUpsert.model_validate(self.BODY))

        self.assertEqual([], session._added)
        self.assertNotIn("comment", stored.built_in_fields_json)
        self.assertEqual(["vod"], [c["key"] for c in stored.custom_fields_json])
        self.assertEqual((True, False), _pair(out, "comment"))
        session.commit.assert_awaited_once()


class UpsertPayloadRejections(TestCase):
    def _reject(self, body: dict) -> str:
        with self.assertRaises(pydantic.ValidationError) as ctx:
            schemas.MatchReportFormUpsert.model_validate(body)
        return str(ctx.exception)

    def _custom(self, *fields: dict) -> dict:
        return {"built_in_fields": {}, "custom_fields": list(fields)}

    def test_rejects_unknown_built_in_field(self) -> None:
        message = self._reject({"built_in_fields": {"vibes": {"enabled": True, "required": True}}})
        self.assertIn("unknown built-in report fields", message)

    def test_rejects_duplicate_custom_key(self) -> None:
        message = self._reject(self._custom({"key": "vod", "label": "VOD"}, {"key": "vod", "label": "VOD again"}))
        self.assertIn("duplicate custom field key", message)

    def test_rejects_reserved_custom_key(self) -> None:
        for key in sorted(schemas.RESERVED_CUSTOM_FIELD_KEYS):
            with self.subTest(key=key):
                message = self._reject(self._custom({"key": key, "label": "Nope"}))
                self.assertIn("is reserved", message)

    def test_rejects_badly_shaped_custom_key(self) -> None:
        for key in ("Vod", "1vod", "vod-link", "vod link", "", "v" * 33, "_vod"):
            with self.subTest(key=key):
                self.assertIn("must match", self._reject(self._custom({"key": key, "label": "X"})))

    def test_rejects_one_field_too_many(self) -> None:
        fields = [{"key": f"f{i}", "label": f"Field {i}"} for i in range(schemas.MAX_CUSTOM_FIELDS + 1)]
        self.assertIn("at most 20 custom fields", self._reject(self._custom(*fields)))

    def test_accepts_exactly_the_maximum(self) -> None:
        fields = [{"key": f"f{i}", "label": f"Field {i}"} for i in range(schemas.MAX_CUSTOM_FIELDS)]
        parsed = schemas.MatchReportFormUpsert.model_validate(self._custom(*fields))
        self.assertEqual(schemas.MAX_CUSTOM_FIELDS, len(parsed.custom_fields))

    def test_rejects_blank_or_oversized_label(self) -> None:
        self.assertIn("must have a label", self._reject(self._custom({"key": "vod", "label": "   "})))
        self.assertIn(
            "label must be at most 64 characters",
            self._reject(self._custom({"key": "vod", "label": "L" * 65})),
        )

    def test_rejects_a_non_text_custom_field(self) -> None:
        """Only ``text`` exists; a select would need options the UI cannot render."""
        self._reject(self._custom({"key": "vod", "label": "VOD", "type": "select"}))


class ValidateCloseness(TestCase):
    def test_disabled_drops_the_submitted_value(self) -> None:
        out = _validate(_mk_form(closeness=(False, True)), closeness=9)
        self.assertIsNone(out.closeness)

    def test_required_and_missing_is_rejected(self) -> None:
        with assert_detail(self, "closeness is required"):
            _validate(_mk_form(closeness=(True, True)), closeness=None)

    def test_optional_and_missing_is_accepted(self) -> None:
        self.assertIsNone(_validate(_mk_form(closeness=(True, False)), closeness=None).closeness)

    def test_out_of_range_is_rejected(self) -> None:
        for value in (0, 11, -1):
            with self.subTest(value=value), assert_detail(self, "closeness must be between 1 and 10"):
                _validate(_mk_form(), closeness=value)

    def test_in_range_is_kept(self) -> None:
        self.assertEqual(7, _validate(_mk_form(), closeness=7).closeness)


class ValidateMapCodes(TestCase):
    def test_disabled_drops_every_code(self) -> None:
        out = _validate(_mk_form(map_codes=(False, True)), closeness=5, map_codes=[(1, "AAA")])
        self.assertEqual([], out.map_codes)

    def test_required_demands_one_code_per_played_map(self) -> None:
        form = _mk_form(map_codes=(True, True))
        with assert_detail(self, "a match code is required for every played map"):
            # 2-1 is three played maps; only two codes supplied.
            _validate(form, closeness=5, home_score=2, away_score=1, map_codes=[(1, "A"), (2, "B")])

    def test_required_accepts_exactly_the_played_maps(self) -> None:
        form = _mk_form(map_codes=(True, True))
        out = _validate(form, closeness=5, home_score=2, away_score=1, map_codes=[(1, "A"), (2, "B"), (3, "C")])
        self.assertEqual([(1, "A"), (2, "B"), (3, "C")], out.map_codes)

    def test_a_blank_code_does_not_satisfy_the_requirement(self) -> None:
        form = _mk_form(map_codes=(True, True))
        with assert_detail(self, "a match code is required for every played map"):
            _validate(form, closeness=5, home_score=1, away_score=0, map_codes=[(1, "   ")])

    def test_a_forfeit_demands_no_codes(self) -> None:
        """0-0 means no map was played, so "one per played map" is vacuous."""
        out = _validate(_mk_form(map_codes=(True, True)), closeness=5, home_score=0, away_score=0)
        self.assertEqual([], out.map_codes)

    def test_optional_drops_blanks_and_keeps_the_rest(self) -> None:
        out = _validate(
            _mk_form(map_codes=(True, False)),
            closeness=5,
            map_codes=[(1, " AAA "), (2, ""), (3, "  ")],
        )
        self.assertEqual([(1, "AAA")], out.map_codes)

    def test_required_never_demands_more_codes_than_the_series_has_slots(self) -> None:
        """A nonsense 3-2 in a Bo3 must not become an unfixable 422.

        The client only ever offers `series_map_indices` slots, so the rule is
        clamped to them — otherwise the captain is asked for a code for a map the
        bracket does not have and can never submit.
        """
        out = _validate(
            _mk_form(map_codes=(True, True)),
            closeness=5,
            home_score=3,
            away_score=2,
            map_codes=[(1, "A"), (2, "B"), (3, "C")],
            available_map_indices=(1, 2, 3),
        )
        self.assertEqual([(1, "A"), (2, "B"), (3, "C")], out.map_codes)

    def test_required_follows_veto_pick_orders_not_one_based_counting(self) -> None:
        """With a veto pool the slots are pick orders, which need not start at 1."""
        form = _mk_form(map_codes=(True, True))
        with assert_detail(self, "a match code is required for every played map"):
            _validate(
                form,
                closeness=5,
                home_score=1,
                away_score=1,
                map_codes=[(4, "A")],
                available_map_indices=(4, 5, 6),
            )
        out = _validate(
            form,
            closeness=5,
            home_score=1,
            away_score=1,
            map_codes=[(4, "A"), (5, "B")],
            available_map_indices=(4, 5, 6),
        )
        self.assertEqual([(4, "A"), (5, "B")], out.map_codes)


class SeriesMapIndices(TestCase):
    def test_settled_indices_win_over_best_of(self) -> None:
        # `_picked_map_ids` already keys by the 1-based series position.
        self.assertEqual([1, 2, 3], report_form.series_map_indices({2: 1, 1: 3, 3: 9}, 5))

    def test_falls_back_to_best_of_slots(self) -> None:
        self.assertEqual([1, 2, 3, 4, 5], report_form.series_map_indices({}, 5))

    def test_unknown_best_of_falls_back_to_three(self) -> None:
        self.assertEqual([1, 2, 3], report_form.series_map_indices({}, None))
        self.assertEqual([1, 2, 3], report_form.series_map_indices({}, 0))


class ValidateComment(TestCase):
    def test_disabled_drops_the_text(self) -> None:
        out = _validate(_mk_form(comment=(False, True)), closeness=5, comment="hello")
        self.assertIsNone(out.comment)

    def test_required_and_blank_is_rejected(self) -> None:
        for value in (None, "", "   "):
            with self.subTest(value=value), assert_detail(self, "comment is required"):
                _validate(_mk_form(comment=(True, True)), closeness=5, comment=value)

    def test_optional_and_blank_stores_null_not_empty_string(self) -> None:
        self.assertIsNone(_validate(_mk_form(), closeness=5, comment="   ").comment)

    def test_over_length_is_rejected(self) -> None:
        with assert_detail(self, "comment must be at most 1000 characters"):
            _validate(_mk_form(), closeness=5, comment="x" * (schemas.COMMENT_MAX_LENGTH + 1))

    def test_at_the_limit_is_accepted_and_stripped(self) -> None:
        text = "x" * schemas.COMMENT_MAX_LENGTH
        self.assertEqual(text, _validate(_mk_form(), closeness=5, comment=f"  {text}  ").comment)


class ValidateCustomFields(TestCase):
    VOD = {"key": "vod", "label": "VOD link", "required": True}
    NOTE = {"key": "note", "label": "Notes", "required": False}

    def test_required_and_blank_is_rejected_by_label(self) -> None:
        with assert_detail(self, '"VOD link" is required'):
            _validate(_mk_form(custom=[self.VOD]), closeness=5, custom_fields={"vod": "  "})

    def test_absent_required_field_is_rejected(self) -> None:
        with assert_detail(self, '"VOD link" is required'):
            _validate(_mk_form(custom=[self.VOD]), closeness=5, custom_fields=None)

    def test_over_length_is_rejected_by_label(self) -> None:
        with assert_detail(self, '"Notes" must be at most 500 characters'):
            _validate(
                _mk_form(custom=[self.NOTE]),
                closeness=5,
                custom_fields={"note": "x" * (schemas.CUSTOM_TEXT_MAX_LENGTH + 1)},
            )

    def test_unknown_key_is_dropped_not_rejected(self) -> None:
        out = _validate(
            _mk_form(custom=[self.NOTE]),
            closeness=5,
            custom_fields={"note": "kept", "removed_by_organizer": "dropped"},
        )
        self.assertEqual({"note": "kept"}, out.custom_fields)

    def test_values_are_stripped_and_blank_optionals_omitted(self) -> None:
        out = _validate(
            _mk_form(custom=[self.NOTE, {"key": "extra", "label": "Extra"}]),
            closeness=5,
            custom_fields={"note": "  hi  ", "extra": "   "},
        )
        self.assertEqual({"note": "hi"}, out.custom_fields)
