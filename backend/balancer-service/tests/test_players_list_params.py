from __future__ import annotations

import sys
from pathlib import Path
from unittest import TestCase

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"
for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)


from src.rpc.players import _list_params  # noqa: E402


class PlayersListParamsTests(TestCase):
    def test_defaults_and_clamps(self) -> None:
        params = _list_params({})
        self.assertEqual(params.page, 1)
        self.assertEqual(params.per_page, 30)
        self.assertEqual(params.query, "")
        self.assertEqual(params.fields, [])

        params = _list_params({"query": {"page": "2", "per_page": "999", "query": "  Ana#1  "}})
        self.assertEqual(params.page, 2)
        self.assertEqual(params.per_page, 100)
        self.assertEqual(params.query, "Ana#1")
        self.assertIn("battle_tag", params.fields)

        params = _list_params({"query": {"page": "nope", "per_page": -5}})
        self.assertEqual(params.page, 1)
        self.assertEqual(params.per_page, 1)

    def test_unwraps_gateway_query_lists(self) -> None:
        params = _list_params({"query": {"page": ["3"], "per_page": ["20"], "query": ["Mei"]}})
        self.assertEqual(params.page, 3)
        self.assertEqual(params.per_page, 20)
        self.assertEqual(params.query, "Mei")
