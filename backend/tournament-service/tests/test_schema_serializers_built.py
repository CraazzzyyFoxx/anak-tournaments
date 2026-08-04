"""Regression: every RPC-returned schema must have a real core serializer.

``src/rpc/_helpers.py::_dump`` serializes read results with
``obj.model_dump(mode="json", ...)``. A model whose forward references were never
resolved keeps a ``MockValSer`` placeholder instead of a ``SchemaSerializer``, and
``model_dump`` on it raises::

    TypeError: 'MockValSer' object cannot be converted to 'SchemaSerializer'

That is exactly what happened to ``PlayerRead`` (``team: Optional["TeamRead"]``)
and ``EncounterRead`` (``matches: list["MatchRead"]``): both forward-reference a
class defined *below* them, and nothing called ``model_rebuild()``. Pydantic's
lazy rebuild masked it for validation paths but not for the read RPCs, so match
and encounter reads failed in production while the schemas imported cleanly.

This walks every schema module and asserts none of them is still carrying a mock
serializer, so a future forward reference cannot reintroduce the bug silently.
``BaseModel`` itself is excluded: the abstract base legitimately has no schema.
"""

from __future__ import annotations

import importlib
import os
import pkgutil
import sys
from unittest import TestCase

os.environ.setdefault("DEBUG", "true")
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

from pydantic import BaseModel  # noqa: E402
from pydantic_core import SchemaSerializer  # noqa: E402


class SchemaSerializersBuiltTests(TestCase):
    def test_every_schema_has_a_real_serializer(self) -> None:
        import src.schemas as schemas_pkg

        for module in pkgutil.walk_packages(schemas_pkg.__path__, schemas_pkg.__name__ + "."):
            importlib.import_module(module.name)

        unbuilt: list[str] = []
        seen: set[type] = set()
        for name, module in list(sys.modules.items()):
            if not name.startswith(("src.schemas", "shared.schemas")):
                continue
            for value in vars(module).values():
                if not isinstance(value, type) or not issubclass(value, BaseModel):
                    continue
                if value is BaseModel or value in seen:
                    continue
                seen.add(value)
                if not isinstance(getattr(value, "__pydantic_serializer__", None), SchemaSerializer):
                    unbuilt.append(f"{value.__module__}.{value.__qualname__}")

        self.assertTrue(seen, msg="no schema classes discovered — the walk above is broken")
        self.assertEqual(
            sorted(set(unbuilt)),
            [],
            msg="these models still hold a MockValSer; add an explicit model_rebuild() at the tail "
            "of their module (see schemas/team.py and schemas/encounter.py)",
        )
