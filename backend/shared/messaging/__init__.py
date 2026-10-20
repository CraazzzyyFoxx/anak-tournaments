"""RabbitMQ messaging: queue/exchange names live in ``shared.messaging.config``, RPC helpers in ``.rpc``."""

from .rpc import request_dict, request_rpc

__all__ = ["request_dict", "request_rpc"]
