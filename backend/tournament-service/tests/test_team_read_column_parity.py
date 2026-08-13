"""``team_flows.to_pydantic`` must carry every column ``TeamRead`` declares.

The team read model is built by hand, keyword by keyword, rather than by
``model_validate(from_attributes=True)``. That is deliberate — nested entities
are conditional and the aggregates are ``column_property`` — but it means adding
a column to ``Team`` AND a field to ``TeamRead`` still leaves the value stranded
at the schema default, with nothing failing: no type checker sees it, and the
endpoint keeps answering 200 with ``null``.

That is exactly how ``image_url`` shipped broken: the upload wrote the column,
the read never spoke it, and the only visible symptom was an image that would
not appear.

So this asserts the invariant instead of the one field: every ``TeamRead`` field
whose name is a real ``Team`` column (or one of the two roster aggregates) must
come out equal to what went in. Each input value is distinct, so a copy-paste
that wires a field to the wrong column fails too.
"""

from __future__ import annotations

import importlib
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase

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

team_flows = importlib.import_module("src.services.team.flows")
schemas = importlib.import_module("src.schemas")
shared_models = importlib.import_module("shared.models")

#: Roster aggregates are ``column_property``, not table columns, so they are not
#: in ``__table__.columns`` — but they are part of the read model all the same.
_AGGREGATES = frozenset({"avg_sr", "total_sr"})

#: Every distinct on purpose: a field wired to the wrong column fails too.
_TEAM = SimpleNamespace(
    id=41,
    created_at=datetime(2026, 1, 2, 3, 4, tzinfo=UTC),
    updated_at=datetime(2026, 5, 6, 7, 8, tzinfo=UTC),
    name="Void Syndicate",
    balancer_name="void-syndicate",
    image_url="https://cdn.example.test/avatars/teams/41/abc123.webp",
    avg_sr=2731.5,
    total_sr=16389,
    captain_id=907,
    tournament_id=13,
)


def _model_backed_fields() -> set[str]:
    """``TeamRead`` fields that name a ``Team`` column or roster aggregate.

    Nested reads (``tournament``, ``players``, ``captain``, ``group``) and derived
    values (``placement``) are excluded: they are entity-gated and carry no
    same-named column.
    """
    columns = {column.key for column in shared_models.Team.__table__.columns}
    return {field for field in schemas.TeamRead.model_fields if field in columns | _AGGREGATES}


class TestTeamReadColumnParity(IsolatedAsyncioTestCase):
    async def test_every_declared_column_survives_serialization(self):
        # ``entities=[]`` asks for no nested read, so the session is never touched.
        read = await team_flows.to_pydantic(None, _TEAM, [])

        for field in sorted(_model_backed_fields()):
            with self.subTest(field=field):
                self.assertEqual(getattr(read, field), getattr(_TEAM, field))

    async def test_the_parity_set_is_not_silently_empty(self):
        # A refactor that renames columns or fields could reduce the intersection
        # to nothing, leaving the test above green while checking absolutely
        # nothing. Pin the fields that exist today. No timestamps: this service's
        # ``BaseRead`` carries only ``id``.
        self.assertEqual(
            _model_backed_fields(),
            {"id", "name", "image_url", "avg_sr", "total_sr", "captain_id", "tournament_id"},
        )

    async def test_balancer_name_stays_out_of_the_read_model(self):
        # Not an oversight: the balancer's internal team name is admin-only and
        # deliberately absent from the public read.
        self.assertNotIn("balancer_name", schemas.TeamRead.model_fields)
