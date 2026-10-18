"""Typed-RPC handlers for stats-service.

Each module exposes ``register(broker, logger)`` and is wired in ``serve_rpc.py``.
Handlers decode the gateway request and emit the ``{ok,data,error}`` envelope via
``src.rpc._common``. Only stats-unique domains live here (match-log, OverFast
rank, achievement engine + rules admin, catalog sync, settings,
discord-channel); everything else is owned by app-service / tournament-service.
"""
