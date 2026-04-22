from shared.core import db as db_module


def test_create_database_passes_pool_tuning_options(monkeypatch):
    captured: dict[str, object] = {}

    async_engine = object()
    sync_engine = object()
    async_session_factory = object()
    sync_session_factory = object()

    def fake_create_async_engine(*, url, **kwargs):
        captured["async_url"] = url
        captured["async_kwargs"] = kwargs
        return async_engine

    def fake_create_engine(*, url, **kwargs):
        captured["sync_url"] = url
        captured["sync_kwargs"] = kwargs
        return sync_engine

    def fake_async_sessionmaker(*args, **kwargs):
        captured["async_sessionmaker_args"] = args
        captured["async_sessionmaker_kwargs"] = kwargs
        return async_session_factory

    def fake_sessionmaker(*args, **kwargs):
        captured["sessionmaker_args"] = args
        captured["sessionmaker_kwargs"] = kwargs
        return sync_session_factory

    monkeypatch.setattr(db_module, "create_async_engine", fake_create_async_engine)
    monkeypatch.setattr(db_module, "create_engine", fake_create_engine)
    monkeypatch.setattr(db_module, "async_sessionmaker", fake_async_sessionmaker)
    monkeypatch.setattr(db_module, "sessionmaker", fake_sessionmaker)

    db = db_module.create_database(
        async_url="postgresql+asyncpg://user:pass@localhost:5432/testdb",
        sync_url="postgresql+psycopg://user:pass@localhost:5432/testdb",
        pool_size=15,
        max_overflow=25,
        pool_timeout=7,
        pool_recycle=180,
        pool_pre_ping=True,
        pool_use_lifo=True,
        statement_timeout=1234,
    )

    assert captured["async_url"] == "postgresql+asyncpg://user:pass@localhost:5432/testdb"
    assert captured["async_kwargs"] == {
        "pool_size": 15,
        "max_overflow": 25,
        "pool_timeout": 7,
        "pool_recycle": 180,
        "pool_pre_ping": True,
        "pool_use_lifo": True,
        "connect_args": {"server_settings": {"statement_timeout": "1234"}},
    }
    assert captured["sync_url"] == "postgresql+psycopg://user:pass@localhost:5432/testdb"
    assert captured["sync_kwargs"] == {
        "pool_size": 15,
        "max_overflow": 25,
        "pool_timeout": 7,
        "pool_recycle": 180,
        "pool_pre_ping": True,
        "pool_use_lifo": True,
        "connect_args": {"options": "-c statement_timeout=1234"},
    }
    assert captured["async_sessionmaker_args"] == (async_engine,)
    assert captured["async_sessionmaker_kwargs"] == {
        "class_": db_module.AsyncSession,
        "expire_on_commit": False,
    }
    assert captured["sessionmaker_args"] == (sync_engine,)
    assert captured["sessionmaker_kwargs"] == {
        "class_": db_module.Session,
        "expire_on_commit": False,
    }
    assert db.async_engine is async_engine
    assert db.sync_engine is sync_engine
    assert db.async_session_maker is async_session_factory
    assert db.sync_session_maker is sync_session_factory


def test_create_database_omits_statement_timeout_when_disabled(monkeypatch):
    captured: dict[str, object] = {}

    def fake_create_async_engine(*, url, **kwargs):
        captured["async_kwargs"] = kwargs
        return object()

    monkeypatch.setattr(db_module, "create_async_engine", fake_create_async_engine)
    monkeypatch.setattr(db_module, "async_sessionmaker", lambda *args, **kwargs: object())

    db = db_module.create_database(
        async_url="postgresql+asyncpg://user:pass@localhost:5432/testdb",
        statement_timeout=0,
    )

    assert captured["async_kwargs"] == {
        "pool_size": 10,
        "max_overflow": 20,
        "pool_timeout": 30,
        "pool_recycle": 1800,
        "pool_pre_ping": True,
        "pool_use_lifo": True,
        "connect_args": {},
    }
    assert db.sync_engine is None
    assert db.sync_session_maker is None
