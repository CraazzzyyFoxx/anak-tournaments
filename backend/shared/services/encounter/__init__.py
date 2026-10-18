"""Cross-service encounter primitives.

Lives in ``shared`` because tournament-service, stats-service and the bracket
engine all move encounter results and seats, and two copies of that logic
drifted apart: one had lost the audit trail the other wrote. There is one
participation writer (:mod:`.participants`) and one result writer
(:mod:`.result`); everything else here feeds them.
"""
