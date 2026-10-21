import asyncio
from types import SimpleNamespace

from sqlalchemy.dialects import postgresql

from shared.repository.ranks import RankFetchLogRepository, compute_per_tick


class _Session:
    def __init__(self) -> None:
        self.statements: list = []

    async def execute(self, statement):
        self.statements.append(statement)
        return SimpleNamespace(all=lambda: [])


def test_the_fetch_log_list_reads_only_its_games_rows_of_its_provider() -> None:
    session = _Session()
    assert (
        asyncio.run(RankFetchLogRepository().list_recent(session, discipline="lol", provider="riot", workspace_id=7))
        == []
    )
    compiled = session.statements[0].compile(dialect=postgresql.dialect())
    assert "rank.fetch_log.discipline = %(discipline_1)s" in str(compiled)
    assert (compiled.params["discipline_1"], compiled.params["provider_1"]) == ("lol", "riot")


def test_pacing_is_a_core_helper() -> None:
    assert (
        compute_per_tick(
            1000, interval_seconds=21600, tick_seconds=60, rate_limit_per_minute=50, batch_size=50, max_per_tick=None
        )
        == 3
    )
