import sys
from pathlib import Path

# ``uv run pytest tests`` (unlike ``python -m pytest``) leaves the backend root off sys.path; ``scripts`` and ``shared``
# live there.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_stats01_upgrade import (  # noqa: E402, F401 -- shared migration fixtures
    stats01_database,
    stats01_legacy_database,
    stats01_legacy_template,
    stats01_native_template,
)
