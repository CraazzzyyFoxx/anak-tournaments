FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1

# Install system dependencies for health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/

# Install uv
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#installing-uv
COPY --from=ghcr.io/astral-sh/uv:0.9.24 /uv /uvx /bin/

# Place executables in the environment at the front of the path
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#using-the-environment
ENV PATH="/app/.venv/bin:$PATH"

# Compile bytecode
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#compiling-bytecode
ENV UV_COMPILE_BYTECODE=1

# uv Cache
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#caching
ENV UV_LINK_MODE=copy

# Copy workspace root configuration and lockfile
COPY pyproject.toml uv.lock /app/

# Copy all workspace member pyproject.toml files (required for workspace resolution)
COPY app-service/pyproject.toml /app/app-service/pyproject.toml
COPY auth-service/pyproject.toml /app/auth-service/pyproject.toml
COPY parser-service/pyproject.toml /app/parser-service/pyproject.toml
COPY discord-service/pyproject.toml /app/discord-service/pyproject.toml
COPY twitch-service/pyproject.toml /app/twitch-service/pyproject.toml
COPY balancer-service/pyproject.toml /app/balancer-service/pyproject.toml

ARG APP_PATH

# Install dependencies for the target service only
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#intermediate-layers
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev --package ${APP_PATH}-service

ENV PYTHONPATH=/app/${APP_PATH}-service:/app

# Copy shared dependencies first (for model sharing across services)
COPY ./shared /app/shared

# Copy scripts and configuration
COPY ./scripts /app/scripts

# Copy the specific service code
COPY ./${APP_PATH}-service /app/${APP_PATH}-service

# Sync the project (install the package itself)
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#intermediate-layers
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --package ${APP_PATH}-service

# Set working directory to the service
WORKDIR /app/${APP_PATH}-service

# Create logs directory
RUN mkdir -p /logs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import sys; sys.exit(0)"
