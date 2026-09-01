"""The balancer's dict-detail errors reach clients as structure, not as a string.

``api_key_policy`` rejections carry the cap that was hit (``max``) and the field
that hit it. Those used to be ``json.dumps``-ed into ``error.message``, so a
client had to parse JSON back out of a human-readable field to act on them.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from shared.core.errors import ApiExc, ApiHTTPException
from shared.core.errors import BaseAPIException as HTTPException

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ["DEBUG"] = "false"

from src.core.security.api_key_policy import validate_api_key_config_policy  # noqa: E402
from src.rpc import _common as rpc_common  # noqa: E402


class _Logger:
    def exception(self, *args, **kwargs) -> None:
        raise AssertionError("mapped errors must not reach the defensive guard")


def _map(exc: Exception) -> dict:
    return rpc_common._map_error(_Logger(), "test", exc)["error"]


def _api_key_user():
    class _User:
        _credential_type = "api_key"
        _api_key_config_policy = None

    return _User()


def test_module_no_longer_stringifies_details() -> None:
    # The old dict branch did a local ``import json`` purely to dump the detail
    # into the message; nothing here should need a JSON encoder any more.
    assert not hasattr(rpc_common, "json")


def test_policy_rejection_reaches_the_client_as_structure() -> None:
    with pytest.raises(HTTPException) as exc_info:
        validate_api_key_config_policy(_api_key_user(), {"population_size": 10_000})

    error = _map(exc_info.value)
    assert error["code"] == "bad_request"
    # The specific code and the cap the request blew past survive as a fields
    # entry. NOT merged at the top of details: the gateway lets the envelope's
    # own `code` win there, so a merged specific code would be dropped.
    assert error["details"]["fields"] == [
        {
            "field": "population_size",
            "msg": "api key config value too high",
            "code": "api_key_config_value_too_high",
            "max": 150,
        }
    ]
    assert error["message"] == "api key config value too high"
    assert "{" not in error["message"]


def test_disallowed_field_rejection_keeps_its_allowed_list() -> None:
    with pytest.raises(HTTPException) as exc_info:
        validate_api_key_config_policy(_api_key_user(), {"solver": "brute-force"})

    entry = _map(exc_info.value)["details"]["fields"][0]
    assert entry["code"] == "api_key_config_field_not_allowed"
    assert "population_size" in entry["allowed_fields"]


def test_item_shaped_dict_detail_becomes_a_fields_entry() -> None:
    exc = HTTPException(status_code=409, detail={"msg": "team is full", "code": "team_full", "field": "roster"})
    error = _map(exc)
    assert error["message"] == "team is full"
    assert error["details"]["fields"] == [{"field": "roster", "msg": "team is full", "code": "team_full"}]


def test_rate_limit_headers_become_retry_after() -> None:
    exc = HTTPException(
        status_code=429,
        detail="Balancer rate limit exceeded: requests_per_minute",
        headers={"Retry-After": "30"},
    )
    error = _map(exc)
    assert error["code"] == "rate_limited"
    assert error["details"] == {"retry_after": 30}


def test_list_detail_still_carries_item_codes() -> None:
    exc = ApiHTTPException(status_code=422, detail=[ApiExc(msg="bad roster", code="roster_invalid")])
    error = _map(exc)
    assert error["message"] == "bad roster"
    assert error["details"]["fields"][0]["code"] == "roster_invalid"


def test_plain_string_detail_carries_no_details_key() -> None:
    assert "details" not in _map(HTTPException(status_code=404, detail="Job not found"))
