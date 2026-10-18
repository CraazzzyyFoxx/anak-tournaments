"""Service-side feature loading for the v2 ML pipeline.

The extractors, role KPI lists and column construction belong to the discipline's analytics module
(``shared.disciplines.<slug>.analytics``, reached through ``src.core.analytics_exports``). What stays here is the
cache, the OpenSkill snapshot replay and the per-frame dispatch:

- :mod:`aggregations` — match/tournament frames enriched with the pre-encounter mu snapshot.
- :mod:`opponent_strength` — pre-encounter / pre-tournament OpenSkill replays.
- :mod:`shift_features` / :mod:`standings_features` — Shift v2 and Standings v2 frame loading.
- :mod:`cache` — file/memory feature-frame cache.
"""
