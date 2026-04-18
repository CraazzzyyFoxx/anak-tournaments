"""RabbitMQ queue and exchange configurations with dead letter support.

All queues are configured with:
- Dead letter exchange for failed messages
- 5-minute message TTL
- Durable persistence
"""

from faststream.rabbit import ExchangeType, RabbitExchange, RabbitQueue

# Dead Letter Exchange (DLX)
# All failed messages from any queue will be routed here
DLX_EXCHANGE = RabbitExchange(
    "dlx",
    type=ExchangeType.DIRECT,
    durable=True,
)

# ============================================================================
# Discord Commands Queue
# ============================================================================

DISCORD_COMMANDS_QUEUE = RabbitQueue(
    "discord_commands",
    durable=True,
    arguments={
        "x-dead-letter-exchange": "dlx",
        "x-dead-letter-routing-key": "discord_commands.dlq",
        "x-message-ttl": 300000,  # 5 minutes
    },
)

DISCORD_COMMANDS_DLQ = RabbitQueue(
    "discord_commands.dlq",
    durable=True,
)

# ============================================================================
# Process Match Log Queue
# ============================================================================

PROCESS_MATCH_LOG_QUEUE = RabbitQueue(
    "process_match_log",
    durable=True,
    arguments={
        "x-dead-letter-exchange": "dlx",
        "x-dead-letter-routing-key": "process_match_log.dlq",
        "x-message-ttl": 300000,  # 5 minutes
    },
)

PROCESS_MATCH_LOG_DLQ = RabbitQueue(
    "process_match_log.dlq",
    durable=True,
)

# ============================================================================
# Process Tournament Logs Queue
# ============================================================================

PROCESS_TOURNAMENT_LOGS_QUEUE = RabbitQueue(
    "process_tournament_logs",
    durable=True,
    arguments={
        "x-dead-letter-exchange": "dlx",
        "x-dead-letter-routing-key": "process_tournament_logs.dlq",
        "x-message-ttl": 600000,  # 10 minutes (longer for bulk processing)
    },
)

PROCESS_TOURNAMENT_LOGS_DLQ = RabbitQueue(
    "process_tournament_logs.dlq",
    durable=True,
)

# ============================================================================
# Balancer Jobs Queue
# ============================================================================

BALANCER_JOBS_QUEUE = RabbitQueue(
    "balancer_jobs",
    durable=True,
    arguments={
        "x-dead-letter-exchange": "dlx",
        "x-dead-letter-routing-key": "balancer_jobs.dlq",
        "x-message-ttl": 900000,  # 15 minutes
    },
)

BALANCER_JOBS_DLQ = RabbitQueue(
    "balancer_jobs.dlq",
    durable=True,
)

# ============================================================================
# Tournament Recalculation Events
# ============================================================================

TOURNAMENT_RECALC_EXCHANGE = RabbitExchange(
    "tournament.recalc",
    type=ExchangeType.TOPIC,
    durable=True,
)

TOURNAMENT_RECALC_QUEUE = RabbitQueue(
    "tournament_recalc",
    durable=True,
    routing_key="tournament.recalc.*",
    arguments={
        "x-dead-letter-exchange": "dlx",
        "x-dead-letter-routing-key": "tournament_recalc.dlq",
        "x-message-ttl": 900000,  # 15 minutes
    },
)

TOURNAMENT_RECALC_DLQ = RabbitQueue(
    "tournament_recalc.dlq",
    durable=True,
)

TOURNAMENT_RECALCULATED_QUEUE = RabbitQueue(
    "tournament_recalculated",
    durable=True,
    routing_key="tournament.recalculated.*",
    arguments={
        "x-dead-letter-exchange": "dlx",
        "x-dead-letter-routing-key": "tournament_recalculated.dlq",
        "x-message-ttl": 300000,  # 5 minutes
    },
)

TOURNAMENT_RECALCULATED_DLQ = RabbitQueue(
    "tournament_recalculated.dlq",
    durable=True,
)

# ============================================================================
# Swiss Next Round Queue
# ============================================================================

SWISS_NEXT_ROUND_QUEUE = RabbitQueue(
    "swiss_next_round",
    durable=True,
    arguments={
        "x-dead-letter-exchange": "dlx",
        "x-dead-letter-routing-key": "swiss_next_round.dlq",
        "x-message-ttl": 300000,  # 5 minutes
    },
)

SWISS_NEXT_ROUND_DLQ = RabbitQueue(
    "swiss_next_round.dlq",
    durable=True,
)

# ============================================================================
# Achievement Evaluate Queue
# ============================================================================

ACHIEVEMENT_EVALUATE_QUEUE = RabbitQueue(
    "achievement_evaluate",
    durable=True,
    arguments={
        "x-dead-letter-exchange": "dlx",
        "x-dead-letter-routing-key": "achievement_evaluate.dlq",
        "x-message-ttl": 600000,  # 10 minutes
    },
)

ACHIEVEMENT_EVALUATE_DLQ = RabbitQueue(
    "achievement_evaluate.dlq",
    durable=True,
)
