"""API-key scopes, expressed in the RBAC permission vocabulary.

A scope is not a parallel taxonomy: it IS a permission name from
``PERMISSION_CATALOG`` (``"team.create"``, ``"registration.approve"``,
``"admin.*"``). That choice is load-bearing. Because a key's granted scopes are
intersected with its owner's real RBAC and written into the token payload as
ordinary ``rbac_permissions``, every existing gate in every service authorizes an
API key correctly with no scope-specific code: ``has_workspace_permission`` is
still the only thing that decides. A second vocabulary would have needed a
mapping table per endpoint -- 425 RPC queues' worth of duplicated truth.

``admin.*`` is the sole wildcard (the catalog's ``("*", "*")`` entry). There is
deliberately no ``resource.*`` form: the catalog is the allowlist, and a scope
that cannot be spelled as a catalog name cannot be granted.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from types import MappingProxyType

from shared.rbac.catalog import PERMISSION_CATALOG

__all__ = (
    "ALL_SCOPE_NAMES",
    "LEGACY_SCOPE_ALIASES",
    "SCOPE_PAIRS",
    "normalize_scopes",
    "scope_grants",
    "scope_pairs",
    "unknown_scopes",
)

_PAIR_BY_NAME: dict[str, tuple[str, str]] = {p.name: (p.resource, p.action) for p in PERMISSION_CATALOG}

#: Scope name -> ``(resource, action)``, the whole grantable vocabulary. Exposed
#: so callers can enumerate scopes without reconstructing the catalog.
SCOPE_PAIRS: Mapping[str, tuple[str, str]] = MappingProxyType(_PAIR_BY_NAME)

ALL_SCOPE_NAMES: frozenset[str] = frozenset(_PAIR_BY_NAME)

# Keys minted before scopes were real carry the single opaque scope
# ``balancer.jobs``. It stood for exactly one grant -- ``team.create``, the
# permission every balancer job path checks -- so mapping it preserves those
# keys' effective authority to the letter and no data migration is needed.
LEGACY_SCOPE_ALIASES: dict[str, tuple[str, ...]] = {"balancer.jobs": ("team.create",)}


def normalize_scopes(raw: Iterable[str]) -> tuple[str, ...]:
    """Canonical scope list: aliases expanded, unknown names dropped, deduped.

    Unknown names are dropped rather than raising because this runs on the token
    path, where a catalog entry retired after a key was issued must degrade that
    key's authority, never break every request it makes. Creation-time input is
    validated separately by ``unknown_scopes``.
    """
    out: list[str] = []
    seen: set[str] = set()
    for name in raw:
        for expanded in LEGACY_SCOPE_ALIASES.get(name, (name,)):
            if expanded in _PAIR_BY_NAME and expanded not in seen:
                seen.add(expanded)
                out.append(expanded)
    return tuple(out)


def unknown_scopes(raw: Iterable[str]) -> tuple[str, ...]:
    """Names that are neither a catalog permission nor a legacy alias.

    For rejecting bad input at creation time, where silence would hand the
    caller a key that quietly does less than they asked for.
    """
    return tuple(name for name in raw if name not in _PAIR_BY_NAME and name not in LEGACY_SCOPE_ALIASES)


def scope_pairs(scopes: Iterable[str]) -> tuple[tuple[str, str], ...]:
    """``(resource, action)`` for each known scope name; ``admin.*`` -> ``("*", "*")``."""
    return tuple(_PAIR_BY_NAME[name] for name in scopes if name in _PAIR_BY_NAME)


def scope_grants(scopes: Iterable[str], resource: str, action: str) -> bool:
    """Whether these scopes cover ``resource.action``.

    Wildcard matching mirrors the permission payload check in
    ``AuthUser.has_workspace_permission`` so a scope test and an RBAC test can
    never disagree about what ``admin.*`` covers.
    """
    for scope_resource, scope_action in scope_pairs(scopes):
        if (scope_resource in ("*", resource)) and (scope_action in ("*", action)):
            return True
    return False
