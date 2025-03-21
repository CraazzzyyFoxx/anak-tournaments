from faststream import FastStream
from faststream.redis import RedisBroker

from src.core import config

broker = RedisBroker(config.app.celery_broker_url)
app = FastStream(broker)
