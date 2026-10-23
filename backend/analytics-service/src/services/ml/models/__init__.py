"""Artifact storage for v2 models.

The model implementations (Performance v2, Shift v2, Standings v2, match quality, anomaly detectors) belong to the
discipline's analytics module; the neutral ``MLModel`` contract is ``shared.domain.analytics``. :mod:`base` stores and
loads artifacts; :mod:`anomaly_tuning` is the generic threshold tuner.
"""
