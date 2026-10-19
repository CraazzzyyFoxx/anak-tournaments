"""One module per requirement: raw signal -> :class:`RequirementVerdict`.

Nothing is re-exported here on purpose. The registry imports each evaluator by
its own module path, so adding a requirement is a new file plus one registry
entry -- never an edit to a shared aggregator that every other requirement also
imports through. The package stays a namespace, not a bottleneck.

Every evaluator obeys the same contract, stated once here because it is the
whole reason this package is separate from ``resolve.py``:

- Synchronous, and takes no session. The batch guarantee (one resolution pass per
  LIST, because Discord rate-limits per guild) is enforced by the signature.
- A ``None`` signal means the resolver was never ASKED -- the requirement is off,
  or this registration was not in the batch. It reads as ``undetermined``, never
  as a failure.
- Only a CONFIRMED refusal returns ``blocked``. Everything else fails open.
"""
