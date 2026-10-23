"""Cross-service encounter primitives.

Lives in ``shared`` because tournament-service, stats-service and the bracket
engine all move encounter results and seats. There is one participation writer
(:mod:`.participants`) and one result writer (:mod:`.result`); everything else
here feeds them.
"""
