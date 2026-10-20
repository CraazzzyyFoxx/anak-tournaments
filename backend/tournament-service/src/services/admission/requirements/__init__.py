"""One module per requirement: raw signal -> :class:`RequirementVerdict`.

Nothing is re-exported: the registry imports each evaluator by module path, so a
new requirement is a new file plus one registry entry.

Every evaluator obeys the same contract:

- Synchronous, and takes no session: signals are resolved once per LIST
  (Discord rate-limits per guild).
- A ``None`` signal means the resolver was never ASKED -- the requirement is off,
  or this registration was not in the batch. It reads as ``undetermined``, never
  as a failure.
- Only a CONFIRMED refusal returns ``blocked``. Everything else fails open.
"""
