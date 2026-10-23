"""Overwatch rank collection (OverFast): client, scheduler, consumers and the rank RPC handlers.

Nothing here imports a service: sessions, Redis and the broker come in through the module's jobs hooks. Loaded only by
the registry's lazy wrappers (``shared.disciplines.overwatch``).
"""
