from faststream import FastStream
from faststream.redis import RedisBroker

from src.core import config

broker = RedisBroker(config.settings.broker_url)
app = FastStream(broker)
