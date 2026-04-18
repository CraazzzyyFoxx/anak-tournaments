FROM python:3.13-slim

WORKDIR /app

RUN set -eux; \
    echo 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/80-retries; \
    echo 'Acquire::http::Timeout "60";' >> /etc/apt/apt.conf.d/80-retries; \
    echo 'Acquire::https::Timeout "60";' >> /etc/apt/apt.conf.d/80-retries; \
    for i in 1 2 3 4 5; do \
        apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
         && rm -rf /var/lib/apt/lists/*; \
        break || { echo "apt attempt $i failed, retrying in 10s..."; sleep 10; }; \
    done; \
COPY . .

RUN pip install --upgrade pip
RUN pip install uv
RUN uv pip install --system --editable .

ENV PYTHONUNBUFFERED=1

CMD ["faststream", "run", "mixtura_balancer_tournament:app"]
