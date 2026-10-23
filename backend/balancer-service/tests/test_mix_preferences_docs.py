"""The mix-preferences API description names only fields the response carries.

It used to promise a ``roster_shape`` the read never returned: the team format is
frozen on each mix, not a host preference.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
for candidate in (str(REPO_BACKEND_ROOT), str(REPO_BACKEND_ROOT / "balancer-service")):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

from src import schemas  # noqa: E402
from src.openapi_docs import DOCS  # noqa: E402


def test_every_field_the_description_names_is_in_the_response() -> None:
    # A game's formation default is an object of its own; its keys are response fields too.
    from src.schemas.user_prefs import MixFormationDefault

    fields = set(schemas.UserMixPreferencesRead.model_fields) | set(MixFormationDefault.model_fields)
    for subject in ("rpc.balancer.prefs.get", "rpc.balancer.prefs.upsert"):
        named = set(re.findall(r"\b[a-z]+(?:_[a-z]+)+\b", DOCS[subject]["description"]))
        assert named <= fields, (subject, named - fields)
