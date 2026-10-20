"""Typed-RPC transport layer for identity-svc: one module per domain,
each exposing ``register(broker, logger)``.

Transport only: parse the RPC payload, resolve the caller when the method needs
one, hand off to a service object, serialise the result. Every authorization
decision, query and error message belongs to ``src/services/**``.
"""
