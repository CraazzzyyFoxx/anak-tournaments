from __future__ import annotations

import math


def _sample_stdev_from_sums(sum_x: float, sum_x2: float, n: int) -> float:
    """Fast sample stdev (like statistics.stdev) from sum(x), sum(x^2)."""
    if n < 2:
        return 0.0

    variance = (sum_x2 - (sum_x * sum_x) / n) / (n - 1)
    if variance <= 0.0:
        return 0.0

    return math.sqrt(variance)

