from pydantic import RedisDsn

from shared.core.config import BaseServiceSettings


class Settings(BaseServiceSettings):
    project_name: str = "OWT Stream Service"

    redis_url: RedisDsn
    rabbitmq_url: str = "amqp://guest:guest@rabbitmq:5672"

    # Twitch Helix under an **app** access token (client_credentials), not a user
    # token: the poller asks "who is live" about channels it does not own, which
    # needs no user consent. `shared/services/subscriptions/providers/twitch_helix.py` is
    # the user-token client for subscription checks and is deliberately NOT reused.
    #
    # This is the SAME Twitch application identity-service uses for OAuth login,
    # so the 800-points/min app bucket is shared between the two services.
    #
    # Both credentials unset is a supported state: the Helix client raises
    # HelixNotConfigured and the poll tick no-ops, rather than the worker refusing
    # to start. Operational knobs (enabled/interval/batch size) live in the admin
    # `stream.collection` setting, not here — they are runtime-editable.
    twitch_client_id: str | None = None
    twitch_client_secret: str | None = None
    twitch_helix_url: str = "https://api.twitch.tv/helix"
    twitch_token_url: str = "https://id.twitch.tv/oauth2/token"


settings = Settings()
