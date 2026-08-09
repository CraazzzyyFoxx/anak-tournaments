"""Assert that a SQLAlchemy statement eager-loads a relationship chain.

For unit tests that drive a service function with a mocked ``AsyncSession``: the
mock returns whatever rows it is given, so a forgotten ``selectinload`` is
invisible there and only shows up in production as ``MissingGreenlet`` on the
first attribute touch after the await. Inspecting the statement the code handed
to ``session.execute`` is the only handle such a test has.

``Select._with_options`` is private SQLAlchemy API, which is exactly why it lives
in one place: every eager-loading assertion in every service's suite goes through
here, so a SQLAlchemy upgrade that moves it is one fix rather than one per call
site.
"""

from __future__ import annotations

from typing import Any


def eager_loaded_chains(statement: Any) -> list[tuple[str, ...]]:
    """Every relationship chain ``statement`` eager-loads.

    Each chain is dotted ``Class.attribute`` names from the root entity outwards,
    so ``selectinload(A.bs).selectinload(B.cs)`` reads as
    ``("A.bs", "B.cs")``. Loader options carrying no relationship path (column
    loaders, execution options) are skipped.
    """
    chains: list[tuple[str, ...]] = []
    for option in getattr(statement, "_with_options", ()):
        path = getattr(option, "path", None)
        if path is None:
            continue
        chains.append(
            tuple(
                f"{element.parent.class_.__name__}.{element.key}"
                for element in path.path
                # The path alternates mappers and relationship properties; only
                # the latter carry a parent mapper to name them from.
                if getattr(element, "parent", None) is not None and getattr(element, "key", None) is not None
            )
        )
    return chains


def assert_eager_loads(case: Any, statement: Any, *chain: str) -> None:
    """Fail ``case`` unless ``statement`` eager-loads all of ``chain``.

    A loaded chain satisfies any of its PREFIXES: asking for ``("A.bs",)`` passes
    against ``selectinload(A.bs).selectinload(B.cs)``, because that option does
    load ``A.bs`` on the way. Asking for the deeper chain against the shallower
    option fails, which is the case worth catching.
    """
    wanted = tuple(chain)
    loaded = eager_loaded_chains(statement)
    case.assertTrue(
        any(actual[: len(wanted)] == wanted for actual in loaded),
        f"statement does not eager-load {wanted}; it loads {loaded}",
    )
