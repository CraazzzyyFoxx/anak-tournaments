"""Typed RPC handlers served by the gateway (``rpc.stream.*``).

Each module exposes ``register(broker, logger)``, wired from ``serve.py``.

| subject | auth | HTTP route |
|---|---|---|
| ``rpc.stream.tournament_streams`` | none | ``GET /api/streams/tournament/{tournament_id}`` |
| ``rpc.stream.repoll`` | ``stream.update`` | ``POST /api/streams/tournament/{tournament_id}/repoll`` |

Queue ownership rule: every ``rpc.stream.*`` queue has exactly one owning
process (``stream-svc``).
"""
