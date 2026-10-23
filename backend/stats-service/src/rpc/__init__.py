"""Typed-RPC handlers for stats-service.

Each module exposes ``register(broker, logger)`` (the public reads also take their ``channel``) and is wired in
``serve_rpc.py``.
Handlers decode the gateway request and emit the ``{ok,data,error}`` envelope via
``src.rpc._common``. Stats owns match logs, canonical ingest, OverFast rank, the
achievement engine + rules admin, MVP impact, subscription collection, catalog
sync, settings and the public statistics, /users/* and achievement reads; everything else is owned by
app-service / tournament-service
(and the Discord channel binding by discord-service).
"""
