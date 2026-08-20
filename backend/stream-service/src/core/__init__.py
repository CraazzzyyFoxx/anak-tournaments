"""Process-global wiring: settings, database engine, worker broker accessor.

Deliberately does NOT re-export ``shared.core.errors``/``utils``/``pagination``
the way the older services' ``src.core`` packages do — that alias exists there
only for backward compatibility with pre-split imports. New code imports from
``shared.core`` directly.
"""
