"""Cross-service encounter primitives.

Lives in ``shared`` because both tournament-service and parser-service finalize
encounter scores, and two copies of that logic drifted apart: the parser copy
had lost the elimination draw guard and the veto-session sync, so a drawn
bracket match finalized through it left the bracket silently stuck.
"""
