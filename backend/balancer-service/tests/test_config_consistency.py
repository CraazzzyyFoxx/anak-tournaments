"""Single-source-of-truth guard tests for balancer algorithm configuration.

These assertions lock the consistency invariants between the canonical
``AlgorithmConfig`` defaults, the preset deltas, the editable-field catalog,
the limit table, the public ``/config`` payload, the public write allowlist
(``PUBLIC_CONFIG_KEYS``), the hand-written native request
(``moo_backend._serialize_native_request``) and the Rust ``ConfigSpec``.
They are deliberately offline/deterministic (no DB/Redis/network) and exist to
catch future drift between these parallel sources of truth, not to fail on the
current code.

Ten places enumerate the same parameter set. The ring closed here covers the
dangerous links: a field added to ``AlgorithmConfig`` but missed in
``PUBLIC_CONFIG_KEYS`` is silently dropped on write, and one missed in
``_serialize_native_request`` silently falls back to a Rust ``serde`` default —
the UI shows and saves the value while the solver ignores it, with no error
anywhere.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")
os.environ["DEBUG"] = "false"

from src.services.balancer.algorithm.moo_backend import _serialize_native_request  # noqa: E402
from src.services.balancer.config.defaults import AlgorithmConfig  # noqa: E402
from src.services.balancer.config.presets import ConfigPresets  # noqa: E402
from src.services.balancer.config.provider import (  # noqa: E402
    CONFIG_FIELD_DEFINITIONS,
    CONFIG_LIMITS,
    EDITABLE_CONFIG_FIELD_KEYS,
    get_balancer_config_payload,
)
from src.services.balancer.config.public_contract import PUBLIC_CONFIG_KEYS  # noqa: E402


def _algorithm_field_names() -> set[str]:
    return set(AlgorithmConfig().model_dump().keys())


def test_default_preset_matches_algorithm_config_defaults() -> None:
    """Every ``ConfigPresets.DEFAULT`` entry that is also an ``AlgorithmConfig``
    field must equal that field's default — the preset and the settings class
    must not drift apart."""
    defaults = AlgorithmConfig().model_dump()

    mismatches = {
        key: (preset_value, defaults[key])
        for key, preset_value in ConfigPresets.DEFAULT.items()
        if key in defaults and preset_value != defaults[key]
    }

    assert mismatches == {}, f"DEFAULT preset drifted from AlgorithmConfig defaults: {mismatches}"


def test_default_preset_keys_are_all_algorithm_config_fields() -> None:
    """``ConfigPresets.DEFAULT`` must not reference keys that are not real
    ``AlgorithmConfig`` fields."""
    field_names = _algorithm_field_names()

    unknown_default_keys = set(ConfigPresets.DEFAULT) - field_names

    assert unknown_default_keys == set(), f"DEFAULT preset has non-field keys: {sorted(unknown_default_keys)}"


def test_config_limits_keys_are_valid_algorithm_config_fields() -> None:
    """Every key in ``CONFIG_LIMITS`` must be a valid ``AlgorithmConfig``
    field name."""
    field_names = _algorithm_field_names()

    invalid_limit_keys = set(CONFIG_LIMITS) - field_names

    assert invalid_limit_keys == set(), f"CONFIG_LIMITS references unknown fields: {sorted(invalid_limit_keys)}"


def test_field_definitions_keys_are_editable() -> None:
    """Every ``CONFIG_FIELD_DEFINITIONS`` entry's ``key`` must be an editable
    config field key."""
    definition_keys = {definition["key"] for definition in CONFIG_FIELD_DEFINITIONS}

    non_editable = definition_keys - EDITABLE_CONFIG_FIELD_KEYS

    assert non_editable == set(), f"Field definitions reference non-editable keys: {sorted(non_editable)}"


def test_config_payload_exposes_expected_top_level_keys() -> None:
    """``get_balancer_config_payload`` returns the stable public envelope."""
    payload = get_balancer_config_payload()

    assert isinstance(payload, dict)
    assert set(payload.keys()) == {"defaults", "limits", "presets", "fields"}


# ---------------------------------------------------------------------------
# Python ring: AlgorithmConfig <-> PUBLIC_CONFIG_KEYS
# ---------------------------------------------------------------------------

# ``rating_scale_ceiling`` is a rating-normalisation constant applied Python-side
# by RatingNormalizer, not a solver knob: it is intentionally absent from the
# public write allowlist and from the native payload.
NON_PUBLIC_ALGORITHM_FIELDS = {"rating_scale_ceiling"}

# ``algorithm`` is accepted for backwards compatibility and then unconditionally
# dropped: ``ConfigOverrides`` has ``extra="forbid"`` and no ``algorithm`` field,
# so the validate-or-pop at public_contract.py:78-82 always pops it.
PUBLIC_KEYS_WITHOUT_ALGORITHM_FIELD = {"algorithm"}


def test_public_config_keys_cover_every_algorithm_field() -> None:
    """A field missing from ``PUBLIC_CONFIG_KEYS`` is silently dropped on write.

    ``normalize_persisted_config_payload`` filters the incoming payload by this
    set, so an override for an unlisted field "saves" and disappears.
    """
    missing = _algorithm_field_names() - PUBLIC_CONFIG_KEYS - NON_PUBLIC_ALGORITHM_FIELDS

    assert missing == set(), (
        f"AlgorithmConfig fields absent from PUBLIC_CONFIG_KEYS: {sorted(missing)}. "
        "Overrides for them are dropped on write. Add them to PUBLIC_CONFIG_KEYS "
        "or to NON_PUBLIC_ALGORITHM_FIELDS with a reason."
    )


def test_public_config_keys_are_algorithm_fields() -> None:
    """``PUBLIC_CONFIG_KEYS`` must not advertise keys that do not exist."""
    unknown = PUBLIC_CONFIG_KEYS - _algorithm_field_names() - PUBLIC_KEYS_WITHOUT_ALGORITHM_FIELD

    assert unknown == set(), f"PUBLIC_CONFIG_KEYS references non-fields: {sorted(unknown)}"


# ---------------------------------------------------------------------------
# Python <-> Rust ring: native payload <-> ConfigSpec
# ---------------------------------------------------------------------------

MOO_CORE_LIB_RS = BALANCER_SERVICE_ROOT / "native" / "moo_core" / "src" / "lib.rs"

# Present in ConfigSpec, deliberately never sent: the Rust doc-comment says
# "Принимается по wire опционально; в Python UI пока не выставляется".
RUST_ONLY_CONFIG_FIELDS = {"team_crossover_share"}


def _rust_config_spec_fields() -> tuple[set[str], set[str]]:
    """``(all_fields, fields_with_a_serde_default)`` parsed from ``ConfigSpec``.

    Textual parsing is the only option from Python, and it is the same genre as
    ``shared/tests/test_gateway_raw_sql_matches_models.py``: compare a
    hand-written artefact against its canon.
    """
    source = MOO_CORE_LIB_RS.read_text(encoding="utf-8")
    assert "struct ConfigSpec {" in source, f"ConfigSpec not found in {MOO_CORE_LIB_RS}"
    body = source.split("struct ConfigSpec {", 1)[1].split("\n}", 1)[0]

    all_fields: set[str] = set()
    defaulted: set[str] = set()
    pending_default = False
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if line.startswith("#[serde(default"):
            pending_default = True
            continue
        if not line or line.startswith("#[") or line.startswith("///"):
            continue
        match = re.match(r"([a-z_0-9]+)\s*:", line)
        if match is None:
            continue
        all_fields.add(match.group(1))
        if pending_default:
            defaulted.add(match.group(1))
        pending_default = False

    assert all_fields, "parsed no fields out of ConfigSpec — the parser or the struct changed"
    return all_fields, defaulted


def _native_payload_config_keys() -> set[str]:
    """Config keys the solver actually receives, read off a real payload."""
    request = json.loads(
        _serialize_native_request(
            players=[],
            num_teams=2,
            config=AlgorithmConfig(),
            role_assignment=None,
            seed=1,
        )
    )
    return set(request["config"].keys())


def test_every_non_defaulted_rust_config_field_is_sent() -> None:
    """A ConfigSpec field without ``#[serde(default)]`` MUST be in the payload.

    Omitting one is not a silent fallback but a hard deserialization failure of
    every balance job.
    """
    rust_fields, defaulted = _rust_config_spec_fields()
    required = rust_fields - defaulted
    missing = required - _native_payload_config_keys()

    assert missing == set(), (
        f"ConfigSpec requires {sorted(missing)} but _serialize_native_request "
        "does not send them — every balance job would fail to deserialize."
    )


def test_every_shared_python_rust_field_is_sent() -> None:
    """Every knob that exists on BOTH sides must actually cross the wire.

    This is the silent class: the field has a Rust ``serde`` default, so the job
    runs, the UI saves the value, and the solver optimizes against the default.
    """
    rust_fields, _ = _rust_config_spec_fields()
    shared = rust_fields & _algorithm_field_names()
    missing = shared - _native_payload_config_keys()

    assert missing == set(), (
        f"{sorted(missing)} exist in both AlgorithmConfig and Rust ConfigSpec but are "
        "not sent by _serialize_native_request: the UI would save a value the solver ignores."
    )


def test_native_payload_sends_no_unknown_config_keys() -> None:
    """Everything sent must exist in ConfigSpec (Rust denies unknown fields)."""
    rust_fields, _ = _rust_config_spec_fields()
    unknown = _native_payload_config_keys() - rust_fields

    assert unknown == set(), f"_serialize_native_request sends keys absent from ConfigSpec: {sorted(unknown)}"


def test_rust_only_config_fields_are_documented() -> None:
    """Guard the allowlist itself: a Rust-only field must be a known exception."""
    rust_fields, _ = _rust_config_spec_fields()
    undocumented = rust_fields - _native_payload_config_keys() - RUST_ONLY_CONFIG_FIELDS

    assert undocumented == set(), (
        f"ConfigSpec fields neither sent nor documented as Rust-only: {sorted(undocumented)}. "
        "Send them from _serialize_native_request or add them to RUST_ONLY_CONFIG_FIELDS with a reason."
    )


def test_rust_only_allowlist_has_no_stale_entries() -> None:
    """A field removed from ConfigSpec must leave the allowlist too."""
    rust_fields, _ = _rust_config_spec_fields()
    stale = RUST_ONLY_CONFIG_FIELDS - rust_fields

    assert stale == set(), f"RUST_ONLY_CONFIG_FIELDS lists fields no longer in ConfigSpec: {sorted(stale)}"
